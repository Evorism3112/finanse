#!/usr/bin/env bash
# Установщик сервера синхронизации «Финансов» для Linux.
#
#   ./install.sh                установить и запустить как службу пользователя (systemd)
#   ./install.sh --no-service   только скопировать файлы, без службы
#   ./install.sh --uninstall    остановить и убрать службу (база остаётся на месте)
#
# Настройки: FINANSE_HOME — куда ставить (по умолчанию ~/.local/share/finanse-server),
#            FINANSE_PORT — порт (по умолчанию 8787).
set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${FINANSE_HOME:-$HOME/.local/share/finanse-server}"
PORT="${FINANSE_PORT:-8787}"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/finanse-server.service"
MODE="${1:-}"

if [[ "$MODE" == "--uninstall" ]]; then
  systemctl --user disable --now finanse-server.service 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload 2>/dev/null || true
  echo "Служба убрана. База и ключ остались в $TARGET/data — удалите папку вручную, если они больше не нужны."
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Не найден Node.js. Установите Node.js 24 или новее: https://nodejs.org" >&2
  exit 1
fi
NODE="$(command -v node)"
# Серверу нужен встроенный в Node.js модуль SQLite.
if ! "$NODE" -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "Нужен Node.js 24 или новее, а установлен $("$NODE" --version)." >&2
  exit 1
fi

mkdir -p "$TARGET/data"
cp "$SOURCE/server.mjs" "$SOURCE/sync.mjs" "$TARGET/"

# Само приложение кладём рядом: тогда его можно открыть в браузере с любого устройства в сети.
WEB=""
[[ -f "$SOURCE/web/index.html" ]] && WEB="$SOURCE/web"
[[ -z "$WEB" && -f "$SOURCE/../dist/index.html" ]] && WEB="$SOURCE/../dist"
if [[ -n "$WEB" ]]; then
  mkdir -p "$TARGET/web"
  cp -r "$WEB/." "$TARGET/web/"
else
  echo "Сборка приложения не найдена (выполните npm run build) — сервер будет только синхронизировать."
fi

TOKEN="$(FINANSE_DATA="$TARGET/data" "$NODE" "$TARGET/server.mjs" --token)"

if [[ "$MODE" != "--no-service" ]]; then
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemd не найден. Файлы установлены, запускайте сервер сами:" >&2
    echo "  FINANSE_PORT=$PORT node $TARGET/server.mjs" >&2
    exit 1
  fi
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT" <<UNIT_FILE
[Unit]
Description=Сервер синхронизации «Финансы»
After=network-online.target

[Service]
ExecStart=$NODE $TARGET/server.mjs
Environment=FINANSE_PORT=$PORT
Environment=FINANSE_DATA=$TARGET/data
Environment=FINANSE_WEB=$TARGET/web
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT_FILE
  systemctl --user daemon-reload
  systemctl --user enable --now finanse-server.service
  # Без этого служба пользователя останавливается при выходе из системы и не стартует до входа.
  loginctl enable-linger "$USER" 2>/dev/null || echo "Чтобы сервер работал и без входа в систему, выполните: sudo loginctl enable-linger $USER"
fi

echo
echo "Сервер «Финансов» установлен в $TARGET"
echo
echo "  Ключ доступа: $TOKEN"
echo "  Адрес для других устройств в этой сети:"
ip -4 -o addr show scope global 2>/dev/null | awk -v port="$PORT" '{ split($4, a, "/"); print "    http://" a[1] ":" port }' || true
echo "  На этом компьютере: http://localhost:$PORT"
echo
echo "В приложении: «Ещё» → «Синхронизация между устройствами» → введите адрес и ключ."
if [[ "$MODE" == "--no-service" ]]; then
  echo "Служба не создавалась. Запуск вручную: FINANSE_PORT=$PORT node $TARGET/server.mjs"
else
  echo "Состояние службы: systemctl --user status finanse-server"
  echo "Если другие устройства не видят сервер, откройте порт $PORT в брандмауэре."
fi

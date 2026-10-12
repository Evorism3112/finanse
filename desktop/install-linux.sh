#!/usr/bin/env bash
# Ставит настольную программу «Финансы» для текущего пользователя, без прав администратора.
#
#   desktop/install-linux.sh [папка-с-программой]   установить (по умолчанию release/linux-unpacked)
#   desktop/install-linux.sh --uninstall            убрать программу (данные остаются в ~/.config/finanse)
#
# Нужна потому, что файл AppImage запускается не везде: ему требуется библиотека FUSE 2,
# которой в свежих дистрибутивах (Arch, CachyOS, Fedora) по умолчанию нет.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$HOME/.local/opt/finanse"
ENTRY="$HOME/.local/share/applications/finanse.desktop"
ICON="$HOME/.local/share/icons/hicolor/512x512/apps/finanse.png"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -rf "$TARGET"
  rm -f "$ENTRY" "$ICON"
  echo "Программа убрана. Данные остались в ~/.config/finanse."
  exit 0
fi

SOURCE="${1:-$ROOT/release/linux-unpacked}"
if [[ ! -x "$SOURCE/finanse" ]]; then
  echo "Не найдена собранная программа в $SOURCE. Сначала выполните: npm run dist:linux" >&2
  exit 1
fi

rm -rf "$TARGET"
mkdir -p "$TARGET" "$(dirname "$ENTRY")" "$(dirname "$ICON")"
cp -r "$SOURCE/." "$TARGET/"

# Значок берём из самой программы, если рядом нет исходников проекта.
if [[ -f "$ROOT/public/icon-512.png" ]]; then
  cp "$ROOT/public/icon-512.png" "$ICON"
fi

cat > "$ENTRY" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Финансы
Comment=Учёт личных финансов
Exec=$TARGET/finanse %U
Icon=finanse
Terminal=false
Categories=Office;Finance;
StartupWMClass=finanse
DESKTOP

update-desktop-database "$(dirname "$ENTRY")" 2>/dev/null || true

echo "Программа установлена: $TARGET"
echo "Она появилась в меню приложений под названием «Финансы». Запуск из терминала: $TARGET/finanse"

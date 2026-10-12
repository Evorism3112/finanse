import { useMemo, useState, type CSSProperties } from 'react'
import { assignSlots } from '../chartColors'
import { Avatar } from '../components/Avatar'
import { Donut, type Slice } from '../components/Donut'
import { MonthNav } from '../components/MonthNav'
import { Trend } from '../components/Trend'
import { currentMonth, shiftMonth } from '../dates'
import type { Category, CategoryKind, Data } from '../db'
import { formatAmount } from '../money'
import { budgetRows, mainCurrency, monthlySeries, monthReport, type CategoryTotal, type CurrencyReport } from '../stats'

/** На диаграмме не больше шести секторов: пять крупнейших категорий и «Другое». */
const MAX_SLICES = 6
const OTHER = '__other'
const NEUTRAL = 'var(--muted)'
/** Сколько месяцев показывает график динамики. */
const TREND_MONTHS = 6

const keyOf = (c: CategoryTotal) => c.categoryId ?? ''

export function ReportPage({ accounts, categories, transactions }: Data) {
  const [month, setMonth] = useState(currentMonth)

  const sections = useMemo(() => {
    const report = monthReport(accounts, transactions, month)
    const months = Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(month, i - (TREND_MONTHS - 1)))
    const currencies = [...new Set(accounts.map((a) => a.currency))]
    return currencies
      .map((currency) => {
        const empty: CurrencyReport = { currency, income: 0, expense: 0, incomeByCategory: [], expenseByCategory: [] }
        return {
          report: report.find((r) => r.currency === currency) ?? empty,
          series: monthlySeries(accounts, transactions, currency, months),
        }
      })
      // Валюта без движения за все эти месяцы в отчёте не нужна.
      .filter(({ series }) => series.some((p) => p.income > 0 || p.expense > 0))
  }, [accounts, transactions, month])

  const budgetCurrency = mainCurrency(accounts)

  return (
    <>
      <MonthNav month={month} onChange={setMonth} />

      {sections.length === 0 && <p className="empty">За последние месяцы нет доходов и расходов.</p>}

      {sections.map(({ report: r, series }) => {
        const money = (value: number) => formatAmount(value, r.currency)
        const budgets = r.currency === budgetCurrency ? budgetRows(categories, r.expenseByCategory) : []
        return (
          <section key={r.currency}>
            <div className="summary-row">
              <div className="hero">
                <span>Итог за месяц</span>
                <strong>{money(r.income - r.expense)}</strong>
              </div>
              <div className="tiles">
                <div className="tile">
                  <span className="muted">Доходы</span>
                  <strong className="amount income">+{money(r.income)}</strong>
                </div>
                <div className="tile">
                  <span className="muted">Расходы</span>
                  <strong className="amount expense">−{money(r.expense)}</strong>
                </div>
              </div>
            </div>

            <div className="columns">
              <section>
                <h3 className="group-title">Динамика за {TREND_MONTHS} месяцев</h3>
                <div className="card">
                  <Trend points={series} month={month} format={money} onPick={setMonth} />
                </div>
              </section>

              {budgets.length > 0 && (
                <section>
                  <h3 className="group-title">Лимиты на месяц</h3>
                  <ul className="card breakdown budgets">
                    {budgets.map((b) => {
                      const category = categories.find((c) => c.id === b.categoryId)!
                      const ratio = b.spent / b.budget
                      const over = b.spent > b.budget
                      return (
                        <li key={b.categoryId}>
                          <Avatar id={category.id} label={category.name} />
                          <div className="breakdown-body">
                            <div className="breakdown-row">
                              <span>{category.name}</span>
                              <span className="amount">
                                {money(b.spent)} <span className="muted">из {money(b.budget)}</span>
                              </span>
                            </div>
                            <div className="bar">
                              <span
                                className="usage"
                                style={
                                  {
                                    width: `${Math.min(1, ratio) * 100}%`,
                                    '--full': `${100 / Math.min(1, Math.max(ratio, 0.01))}%`,
                                  } as CSSProperties
                                }
                              />
                            </div>
                            <span className={over ? 'muted over' : 'muted'}>
                              {over ? `Лимит превышен на ${money(b.spent - b.budget)}` : `Осталось ${money(b.budget - b.spent)}`}
                            </span>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}
            </div>

            <div className="columns">
              <Breakdown kind="expense" items={r.expenseByCategory} total={r.expense} currency={r.currency} categories={categories} />
              <Breakdown kind="income" items={r.incomeByCategory} total={r.income} currency={r.currency} categories={categories} />
            </div>
          </section>
        )
      })}
    </>
  )
}

/** Разбивка по категориям: кольцевая диаграмма и под ней список с точными суммами. */
function Breakdown({
  kind,
  items,
  total,
  currency,
  categories,
}: {
  kind: CategoryKind
  items: CategoryTotal[]
  total: number
  currency: string
  categories: Category[]
}) {
  const [active, setActive] = useState<string | null>(null)

  const names = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])
  const nameOf = (key: string) => names.get(key) ?? 'Без категории'

  // Цвет закреплён за категорией: порядок по времени создания не меняется от месяца к месяцу.
  const colors = useMemo(() => {
    const order = categories
      .filter((c) => c.kind === kind)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((c) => c.id)
    const shown = items.length > MAX_SLICES ? items.slice(0, MAX_SLICES - 1) : items
    return new Map(assignSlots(order, shown.map(keyOf)).map(([key, slot]) => [key, `var(--series-${slot + 1})`]))
  }, [categories, kind, items])

  if (items.length === 0) return null

  const slices: Slice[] = [...colors].map(([key, color]) => ({
    key,
    label: nameOf(key),
    value: items.find((c) => keyOf(c) === key)!.amount,
    color,
  }))
  const otherValue = total - slices.reduce((sum, s) => sum + s.value, 0)
  if (otherValue > 0) slices.push({ key: OTHER, label: 'Другое', value: otherValue, color: NEUTRAL })

  // Диаграмма из одного-двух секторов ничего не добавляет к цифрам.
  const showDonut = slices.length >= 3
  const sliceKey = (c: CategoryTotal) => (colors.has(keyOf(c)) ? keyOf(c) : OTHER)
  const title = kind === 'expense' ? 'Расходы' : 'Доходы'

  return (
    <section>
      <h3 className="group-title">{title} по категориям</h3>
      <div className="card">
        {showDonut && (
          <Donut
            slices={slices}
            total={total}
            title={title}
            format={(value) => formatAmount(value, currency)}
            active={active}
            onActive={setActive}
          />
        )}
        <ul className="breakdown">
          {items.map((c) => {
            const key = sliceKey(c)
            const color = colors.get(keyOf(c)) ?? NEUTRAL
            const share = c.amount / total
            return (
              <li
                key={keyOf(c)}
                className={showDonut && active !== null && active !== key ? 'dim' : ''}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(key)}
                onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
                onClick={() => setActive(active === key ? null : key)}
              >
                <Avatar id={c.categoryId} label={nameOf(keyOf(c))} />
                <div className="breakdown-body">
                  <div className="breakdown-row">
                    <span>
                      <span className="swatch" style={{ background: color }} />
                      {nameOf(keyOf(c))}
                    </span>
                    <span className="amount">{formatAmount(c.amount, currency)}</span>
                  </div>
                  <div className="bar">
                    <div style={{ background: color, width: `${share * 100}%` }} />
                  </div>
                </div>
                <span className="percent">{Math.round(share * 100)}%</span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

"use client"

import { useMemo, useState } from "react"
import { MATCHED_STATUSES, type MatchStatus } from "@/lib/matching"
import type { RowResult } from "@/workers/match.worker"

export type Decision = "yes" | "no"

interface ResultsPanelProps {
  results: RowResult[]
  dbCount: number
  passportEnabled: boolean
  decisions: Record<number, Decision>
  onDecide: (excelRow: number, d: Decision | null) => void
}

/* человекочитаемые ярлыки и тон для каждого статуса сверки */
const STATUS_META: Record<MatchStatus, { label: string; tone: "green" | "amber" | "red" }> = {
  exact: { label: "точное совпадение", tone: "green" },
  typo: { label: "опечатка", tone: "green" },
  namechange: { label: "смена фамилии", tone: "green" },
  phone: { label: "по телефону", tone: "green" },
  "passport-conflict": { label: "паспорт совпал, ФИО другое", tone: "amber" },
  disputed: { label: "спорное", tone: "amber" },
  notfound: { label: "не найдено", tone: "red" },
  empty: { label: "пусто", tone: "amber" },
}

const TONE_TEXT = { green: "text-primary", amber: "text-accent-foreground", red: "text-destructive", plain: "text-foreground" } as const
const TONE_BADGE = {
  green: "border-primary/40 bg-primary/10 text-primary",
  amber: "border-accent-foreground/40 bg-accent/50 text-accent-foreground",
  red: "border-destructive/40 bg-destructive/10 text-destructive",
} as const

/* фактический статус строки с учётом ручного решения по спорным */
function effectiveStatus(r: RowResult, decisions: Record<number, Decision>): MatchStatus {
  if (r.res.status === "disputed") {
    const d = decisions[r.excelRow]
    if (d === "yes") return "typo"
    if (d === "no") return "notfound"
  }
  return r.res.status
}

function Stat({
  value,
  total,
  label,
  tone,
}: {
  value: number
  total?: number
  label: string
  tone: "green" | "amber" | "red" | "plain"
}) {
  const pct = total && total > 0 ? Math.round((value / total) * 100) : null
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card px-4 py-3">
      <span className="flex items-baseline gap-1.5">
        <span className={`font-mono text-2xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
          {value.toLocaleString("ru-RU")}
        </span>
        {pct !== null && <span className="font-mono text-xs text-muted-foreground">{pct}%</span>}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

type FilterKey = "all" | "found" | "passport-conflict" | "disputed" | "notfound"
type SortKey = "row" | "sim-desc" | "sim-asc"

export function ResultsPanel({ results, dbCount, passportEnabled, decisions, onDecide }: ResultsPanelProps) {
  const [filter, setFilter] = useState<FilterKey>("all")
  const [sort, setSort] = useState<SortKey>("row")
  const [query, setQuery] = useState("")

  let found = 0
  let notfound = 0
  let disputedLeft = 0
  const disputed: RowResult[] = []
  const passportConflicts: RowResult[] = []
  for (const r of results) {
    if (r.res.status === "disputed") {
      disputed.push(r)
      const d = decisions[r.excelRow]
      if (d === "yes") found++
      else if (d === "no") notfound++
      else disputedLeft++
    } else if (r.res.status === "passport-conflict") passportConflicts.push(r)
    else if (MATCHED_STATUSES.has(r.res.status)) found++
    else if (r.res.status === "notfound") notfound++
  }

  /* производный список для таблицы: поиск + фильтр + сортировка */
  const view = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = results.filter((r) => {
      const st = effectiveStatus(r, decisions)
      if (filter === "found" && !MATCHED_STATUSES.has(st)) return false
      if (filter === "notfound" && st !== "notfound") return false
      if (filter === "passport-conflict" && st !== "passport-conflict") return false
      if (filter === "disputed" && !(r.res.status === "disputed" && !decisions[r.excelRow])) return false
      if (q) {
        const hay = `${r.fio} ${r.phone} ${r.dob} ${r.passport} ${r.res.matchedName ?? ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const sorted = [...filtered]
    if (sort === "sim-desc" || sort === "sim-asc") {
      sorted.sort((a, b) => {
        const sa = a.res.sim ?? -1
        const sb = b.res.sim ?? -1
        return sort === "sim-desc" ? sb - sa : sa - sb
      })
    } else {
      sorted.sort((a, b) => a.excelRow - b.excelRow)
    }
    return sorted
  }, [results, decisions, filter, sort, query])

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "Все", count: results.length },
    { key: "found", label: "Найдены", count: found },
    ...(passportEnabled
      ? [{ key: "passport-conflict" as const, label: "Конфликт паспорта", count: passportConflicts.length }]
      : []),
    { key: "disputed", label: "Спорные", count: disputedLeft },
    { key: "notfound", label: "Не найдены", count: notfound },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className={`grid grid-cols-2 gap-3 ${passportEnabled ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
        <Stat value={results.length} label="строк проверено" tone="plain" />
        <Stat value={found} total={results.length} label="найдено в базе" tone="green" />
        {passportEnabled && <Stat value={passportConflicts.length} total={results.length} label="конфликтов паспорта" tone="amber" />}
        <Stat value={disputedLeft} total={results.length} label="спорных без решения" tone="amber" />
        <Stat value={notfound} total={results.length} label="не найдено" tone="red" />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        база: {dbCount.toLocaleString("ru-RU")} записей
      </p>

      {passportEnabled && passportConflicts.length > 0 && (
        <div className="rounded-lg border border-accent-foreground/25 bg-accent/40">
          <header className="border-b border-accent-foreground/20 px-4 py-3">
            <h4 className="text-sm font-semibold text-accent-foreground">
              Паспорт совпал, ФИО другое — проверьте ({passportConflicts.length})
            </h4>
          </header>
          <ul className="divide-y divide-accent-foreground/15">
            {passportConflicts.map((r) => (
              <li key={r.excelRow} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-[11px] text-muted-foreground">стр. {r.excelRow}</span>
                  <span className="text-sm font-medium">{r.fio || "(без ФИО)"}</span>
                  {r.passport && <span className="font-mono text-xs text-muted-foreground">паспорт {r.passport}</span>}
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <span>в базе:</span>
                  <span className="font-medium text-foreground">{r.res.matchedName || "—"}</span>
                  {typeof r.res.sim === "number" && <span className="font-mono">{Math.round(r.res.sim * 100)}%</span>}
                  <span>· {r.res.reason || "требует проверки"}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {disputed.length > 0 && (
        <div className="rounded-lg border border-accent-foreground/25 bg-accent/40">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-accent-foreground/20 px-4 py-3">
            <h4 className="text-sm font-semibold text-accent-foreground">
              Спорные случаи — решите вручную ({disputed.length})
            </h4>
            <p className="text-xs text-muted-foreground">Решения попадут в итоговый файл</p>
          </header>
          <ul className="divide-y divide-accent-foreground/15">
            {disputed.map((r) => {
              const d = decisions[r.excelRow]
              return (
                <li key={r.excelRow} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[11px] text-muted-foreground">стр. {r.excelRow}</span>
                      <span className="text-sm font-medium">{r.fio || "(без ФИО)"}</span>
                      {r.phone && <span className="font-mono text-xs text-muted-foreground">{r.phone}</span>}
                      {r.dob && <span className="font-mono text-xs text-muted-foreground">ДР {r.dob}</span>}
                      {passportEnabled && r.passport && <span className="font-mono text-xs text-muted-foreground">паспорт {r.passport}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                      <span>в базе:</span>
                      <span className="font-medium text-foreground">{r.res.matchedName || "—"}</span>
                      {r.res.matchedDob && <span className="font-mono">ДР {r.res.matchedDob}</span>}
                      {typeof r.res.sim === "number" && r.res.sim > 0 && (
                        <span className="font-mono">{Math.round(r.res.sim * 100)}%</span>
                      )}
                      {r.res.reason && <span>· {r.res.reason}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5" role="group" aria-label={`Решение для строки ${r.excelRow}`}>
                    <button
                      type="button"
                      onClick={() => onDecide(r.excelRow, d === "yes" ? null : "yes")}
                      aria-pressed={d === "yes"}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                        d === "yes"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-card text-foreground hover:border-primary/60"
                      }`}
                    >
                      Один человек
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecide(r.excelRow, d === "no" ? null : "no")}
                      aria-pressed={d === "no"}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                        d === "no"
                          ? "border-destructive bg-destructive text-background"
                          : "border-input bg-card text-foreground hover:border-destructive/60"
                      }`}
                    >
                      Разные
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Просмотр всех результатов: поиск, фильтр по статусу, сортировка */}
      <div className="rounded-lg border border-border bg-card">
        <header className="flex flex-col gap-3 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Все результаты</h4>
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              показано: {view.length.toLocaleString("ru-RU")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-md border border-input bg-muted p-0.5" role="group" aria-label="Фильтр по статусу">
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    filter === f.key
                      ? "bg-primary font-bold text-primary-foreground"
                      : "text-muted-foreground hover:bg-primary/10 hover:text-foreground"
                  }`}
                >
                  {f.label} <span className="font-mono tabular-nums opacity-70">{f.count}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={passportEnabled ? "Поиск по ФИО, телефону, ДР, паспорту…" : "Поиск по ФИО, телефону, ДР…"}
              aria-label="Поиск по результатам"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/60"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Сортировка"
              className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary/60"
            >
              <option value="row">По строке</option>
              <option value="sim-desc">Сходство ↓</option>
              <option value="sim-asc">Сходство ↑</option>
            </select>
          </div>
        </header>

        {view.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Ничего не найдено под этот фильтр.</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <ul className="divide-y divide-border">
              {view.map((r) => {
                const st = effectiveStatus(r, decisions)
                const meta = STATUS_META[st]
                const overridden = r.res.status === "disputed" && !!decisions[r.excelRow]
                return (
                  <li key={r.excelRow} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-mono text-[11px] text-muted-foreground">стр. {r.excelRow}</span>
                        <span className="truncate text-sm font-medium">{r.fio || "(без ФИО)"}</span>
                        {r.phone && <span className="font-mono text-xs text-muted-foreground">{r.phone}</span>}
                        {r.dob && <span className="font-mono text-xs text-muted-foreground">ДР {r.dob}</span>}
                        {passportEnabled && r.passport && <span className="font-mono text-xs text-muted-foreground">паспорт {r.passport}</span>}
                      </div>
                      {r.res.matchedName && (
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                          <span>в базе:</span>
                          <span className="font-medium text-foreground">{r.res.matchedName}</span>
                          {r.res.matchedDob && <span className="font-mono">ДР {r.res.matchedDob}</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {typeof r.res.sim === "number" && r.res.sim > 0 && (
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{Math.round(r.res.sim * 100)}%</span>
                      )}
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_BADGE[meta.tone]}`}
                        title={overridden ? "статус изменён вручную" : undefined}
                      >
                        {meta.label}
                        {overridden ? " ·вручную" : ""}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

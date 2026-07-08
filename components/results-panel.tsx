"use client"

import { MATCHED_STATUSES } from "@/lib/matching"
import type { RowResult } from "@/workers/match.worker"

export type Decision = "yes" | "no"

interface ResultsPanelProps {
  results: RowResult[]
  dbCount: number
  decisions: Record<number, Decision>
  onDecide: (excelRow: number, d: Decision | null) => void
}

function Stat({ value, label, tone }: { value: number; label: string; tone: "green" | "amber" | "red" | "plain" }) {
  const toneCls =
    tone === "green"
      ? "text-primary"
      : tone === "amber"
        ? "text-accent-foreground"
        : tone === "red"
          ? "text-destructive"
          : "text-foreground"
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card px-4 py-3">
      <span className={`font-mono text-2xl font-semibold tabular-nums ${toneCls}`}>{value.toLocaleString("ru-RU")}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

export function ResultsPanel({ results, dbCount, decisions, onDecide }: ResultsPanelProps) {
  let found = 0
  let notfound = 0
  let disputedLeft = 0
  const disputed: RowResult[] = []
  for (const r of results) {
    if (r.res.status === "disputed") {
      disputed.push(r)
      const d = decisions[r.excelRow]
      if (d === "yes") found++
      else if (d === "no") notfound++
      else disputedLeft++
    } else if (MATCHED_STATUSES.has(r.res.status)) found++
    else if (r.res.status === "notfound") notfound++
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={results.length} label="строк проверено" tone="plain" />
        <Stat value={found} label="найдено в базе" tone="green" />
        <Stat value={disputedLeft} label="спорных без решения" tone="amber" />
        <Stat value={notfound} label="не найдено" tone="red" />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        база: {dbCount.toLocaleString("ru-RU")} записей
      </p>

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
                          ? "border-destructive bg-destructive text-white"
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
    </div>
  )
}

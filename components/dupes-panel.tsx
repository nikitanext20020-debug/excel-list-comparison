"use client"

import type { DupMember } from "@/workers/match.worker"
import {
  DUP_MANUAL_NAMESAKE_TYPE,
  filterAutoDuplicateMembers,
  countWillDelete,
  manualDuplicateRows,
  namesakePairKey,
  type DupNamesakeDecision,
} from "@/lib/dupes"

interface DupesPanelProps {
  groups: DupMember[][]
  disputed?: DupMember[][]
  total: number
  dupDelPhone: boolean
  decisions: Record<string, DupNamesakeDecision>
  onDecide: (pairKey: string, decision: DupNamesakeDecision | null) => void
}

export function DupesPanel({ groups, disputed = [], total, dupDelPhone, decisions, onDecide }: DupesPanelProps) {
  const manualRows = manualDuplicateRows(disputed, decisions)
  // строк в дублях = все участники групп без первых упоминаний
  const duplicateRows = new Set<number>()
  for (const group of groups) {
    for (const member of filterAutoDuplicateMembers(group).slice(1)) duplicateRows.add(member.excelRow)
  }
  for (const row of manualRows) duplicateRows.add(row)
  const dupRows = duplicateRows.size
  // будет удалено = та же логика что в buildCleanFile
  const willDelete = countWillDelete(groups, dupDelPhone, manualRows)
  const visibleDisputed = disputed.filter((pair) => decisions[namesakePairKey(pair)] !== "no")
  const hiddenDifferent = disputed.length - visibleDisputed.length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-3">
        <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card px-4 py-3">
          <span className="font-mono text-2xl font-semibold tabular-nums">{total.toLocaleString("ru-RU")}</span>
          <span className="text-xs text-muted-foreground">всего строк</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card px-4 py-3">
          <span className="font-mono text-2xl font-semibold tabular-nums text-accent-foreground">{groups.length}</span>
          <span className="text-xs text-muted-foreground">групп дублей</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card px-4 py-3">
          <span className="font-mono text-2xl font-semibold tabular-nums text-destructive">{dupRows}</span>
          <span className="text-xs text-muted-foreground">строк в дублях</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="font-mono text-2xl font-semibold tabular-nums text-primary">{willDelete}</span>
          <span className="text-xs text-muted-foreground">будет удалено</span>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Найденные группы дублей</caption>
            <thead>
              <tr className="border-b border-border bg-muted">
                {["Группа", "Строка", "ФИО", "Телефон", "Совпадение"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.slice(0, 20).map((grp, gi) =>
                grp.map((m, mi) => (
                  <tr
                    key={`${gi}-${m.excelRow}`}
                    className={`${mi === 0 ? "border-t-2 border-border" : ""} ${gi % 2 === 1 ? "bg-muted/60" : ""}`}
                  >
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{gi + 1}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{m.excelRow}</td>
                    <td className="px-3 py-1.5">{m.fio || "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{m.phone || ""}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{m.type}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          {groups.length > 20 && (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Показаны первые 20 групп — полный список будет в скачанном файле.
            </p>
          )}
        </div>
      )}

      {(visibleDisputed.length > 0 || hiddenDifferent > 0) && (
        <div className="overflow-x-auto rounded-lg border border-accent/40 bg-accent/5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/30 px-3 py-2">
            <span className="text-sm font-semibold text-accent-foreground">
              Спорные тёзки — ручная проверка ({visibleDisputed.length} пар)
            </span>
            {hiddenDifferent > 0 && (
              <button
                type="button"
                onClick={() => {
                  for (const pair of disputed) {
                    const key = namesakePairKey(pair)
                    if (decisions[key] === "no") onDecide(key, null)
                  }
                }}
                className="rounded-md border border-input bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Вернуть скрытые пары ({hiddenDifferent})
              </button>
            )}
          </div>
          {visibleDisputed.length > 0 && (
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Спорные тёзки с разными датами рождения</caption>
              <thead>
                <tr className="border-b border-accent/20 bg-muted/50">
                  {["Конфликт", "Строка", "ФИО", "Телефон", "Совпадение", "Решение"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleDisputed.slice(0, 50).map((pair, pi) => {
                  const pairKey = namesakePairKey(pair)
                  const decision = decisions[pairKey]
                  return pair.map((m, mi) => (
                    <tr
                      key={`${pairKey}-${m.excelRow}`}
                      className={`border-b border-accent/10 last:border-0 ${mi === 0 ? "border-t border-accent/30" : ""}`}
                    >
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{mi === 0 ? `#${pi + 1}` : ""}</td>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{m.excelRow}</td>
                      <td className="px-3 py-1.5">{m.fio || "—"}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{m.phone || ""}</td>
                      <td className="px-3 py-1.5 text-xs font-medium text-accent-foreground">
                        {mi === 1 && decision === "yes" ? DUP_MANUAL_NAMESAKE_TYPE : m.type}
                      </td>
                      <td className="px-3 py-1.5">
                        {mi === 1 && (
                          <div className="flex shrink-0 gap-1.5" role="group" aria-label={`Решение для строк ${pair[0]?.excelRow} и ${pair[1]?.excelRow}`}>
                            <button
                              type="button"
                              onClick={() => onDecide(pairKey, decision === "yes" ? null : "yes")}
                              aria-pressed={decision === "yes"}
                              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                                decision === "yes"
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-input bg-card text-foreground hover:border-primary/60"
                              }`}
                            >
                              Один человек
                            </button>
                            <button
                              type="button"
                              onClick={() => onDecide(pairKey, "no")}
                              aria-pressed={false}
                              className="rounded-md border border-input bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-destructive/60"
                            >
                              Разные люди
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          )}
          {visibleDisputed.length > 50 && <p className="border-t border-accent/20 px-3 py-2 text-xs text-muted-foreground">Показаны первые 50 пар — полный список будет в отчёте.</p>}
        </div>
      )}
    </div>
  )
}

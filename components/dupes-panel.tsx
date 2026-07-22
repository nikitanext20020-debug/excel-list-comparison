"use client"

import { Fragment, useState } from "react"
import type { DupMember } from "@/workers/match.worker"
import {
  DUP_MANUAL_NAMESAKE_TYPE,
  filterAutoDuplicateMembers,
  countWillDelete,
  manualDuplicateRows,
  namesakePairKey,
  type DupAiResult,
  type DupNamesakeDecision,
} from "@/lib/dupes"

interface DupesPanelProps {
  groups: DupMember[][]
  disputed?: DupMember[][]
  total: number
  dupDelPhone: boolean
  decisions: Record<number, DupNamesakeDecision>
  aiVerdicts: Record<number, DupAiResult>
  aiEnabled: boolean
  aiRunning: boolean
  aiProgress: { done: number; total: number } | null
  aiError: string | null
  onDecide: (pairIndex: number, decision: DupNamesakeDecision | null) => void
  onJudgeAll: () => void
  onJudgePair: (pairIndex: number) => void
  onAcceptConfident: () => void
}

export function DupesPanel({
  groups,
  disputed = [],
  total,
  dupDelPhone,
  decisions,
  aiVerdicts,
  aiEnabled,
  aiRunning,
  aiProgress,
  aiError,
  onDecide,
  onJudgeAll,
  onJudgePair,
  onAcceptConfident,
}: DupesPanelProps) {
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
  const [showResolved, setShowResolved] = useState(false)
  const visibleDisputed = disputed.filter((_, pairIndex) => showResolved || !decisions[pairIndex])
  const resolvedCount = disputed.length - visibleDisputed.length
  const aiCount = Object.keys(aiVerdicts).length

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

      {(disputed.length > 0 || resolvedCount > 0) && (
        <div className="overflow-x-auto rounded-lg border border-accent/40 bg-accent/5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/30 px-3 py-2">
            <span className="text-sm font-semibold text-accent-foreground">
              Спорные тёзки — ручная проверка ({visibleDisputed.length} пар)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {aiEnabled && (
                <button
                  type="button"
                  onClick={onJudgeAll}
                  disabled={aiRunning}
                  className="rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
                >
                  {aiRunning ? "ИИ проверяет…" : "Проверить все пары через ИИ"}
                </button>
              )}
              {aiEnabled && aiCount > 0 && (
                <button
                  type="button"
                  onClick={onAcceptConfident}
                  disabled={aiRunning}
                  className="rounded-md border border-primary/50 bg-card px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  Принять все вердикты ИИ ≥ 90%
                </button>
              )}
              {resolvedCount > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                  показать решённые ({resolvedCount})
                </label>
              )}
            </div>
          </div>
          {aiRunning && aiProgress && (
            <div className="border-b border-accent/20 px-3 py-2">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>Проверено {aiProgress.done} из {aiProgress.total} пар</span>
                <span>{Math.round((aiProgress.done / Math.max(aiProgress.total, 1)) * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(aiProgress.done / Math.max(aiProgress.total, 1)) * 100}%` }} />
              </div>
            </div>
          )}
          {aiError && <p className="border-b border-destructive/20 px-3 py-2 text-xs text-destructive">{aiError}</p>}
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
                {disputed
                  .map((pair, pairIndex) => ({ pair, pairIndex }))
                  .filter(({ pairIndex }) => showResolved || !decisions[pairIndex])
                  .slice(0, 50)
                  .map(({ pair, pairIndex }) => {
                    const pairKey = namesakePairKey(pair)
                    const decision = decisions[pairIndex]
                    const ai = aiVerdicts[pairIndex]
                    const aiLabel = ai?.verdict === "same" ? "Один человек" : ai?.verdict === "different" ? "Разные люди" : "Не уверен"
                    const aiStyle = ai?.verdict === "same" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : ai?.verdict === "different" ? "border-red-500/40 bg-red-500/10 text-red-700" : "border-muted-foreground/30 bg-muted text-muted-foreground"
                    return (
                      <Fragment key={pairKey}>
                        {pair.map((m, memberIndex) => (
                          <tr
                            key={`${pairKey}-${m.excelRow}`}
                            className={`border-b border-accent/10 ${memberIndex === 0 ? "border-t border-accent/30" : ""}`}
                          >
                            <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{memberIndex === 0 ? `#${pairIndex + 1}` : ""}</td>
                            <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{m.excelRow}</td>
                            <td className="px-3 py-1.5">{m.fio || "—"}</td>
                            <td className="px-3 py-1.5 font-mono text-xs">{m.phone || ""}</td>
                            <td className="px-3 py-1.5 text-xs font-medium text-accent-foreground">
                              {memberIndex === 1 && decision === "yes" ? DUP_MANUAL_NAMESAKE_TYPE : m.type}
                            </td>
                            <td className="px-3 py-1.5">
                              {memberIndex === 1 && (
                                <div className="flex shrink-0 gap-1.5" role="group" aria-label={`Решение для пары ${pairIndex + 1}`}>
                                  <button
                                    type="button"
                                    onClick={() => onDecide(pairIndex, decision === "yes" ? null : "yes")}
                                    aria-pressed={decision === "yes"}
                                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${decision === "yes" ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-foreground hover:border-primary/60"}`}
                                  >
                                    ✓ Подтвердить: один человек
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onDecide(pairIndex, decision === "no" ? null : "no")}
                                    aria-pressed={decision === "no"}
                                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${decision === "no" ? "border-destructive bg-destructive text-background" : "border-input bg-card text-foreground hover:border-destructive/60"}`}
                                  >
                                    ✗ Разные люди
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                        {aiEnabled && (
                          <tr className="border-b border-accent/20 bg-background/30">
                            <td colSpan={6} className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                {ai && <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${aiStyle}`}>{aiLabel} ({ai.confidence}%)</span>}
                                {!ai && <span className="rounded-full border border-muted-foreground/30 bg-muted px-2.5 py-1 text-xs text-muted-foreground">ИИ ещё не проверял</span>}
                                {ai?.reason && <span className="text-xs text-muted-foreground">{ai.reason}</span>}
                                <button type="button" onClick={() => onJudgePair(pairIndex)} disabled={aiRunning} className="ml-auto rounded-md border border-input bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">Проверить эту пару снова</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
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

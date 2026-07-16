"use client"

import type { DupMember } from "@/workers/match.worker"
import { filterAutoDuplicateMembers } from "@/lib/dupes"

interface DupesPanelProps {
  groups: DupMember[][]
  disputed?: DupMember[][]
  total: number
}

export function DupesPanel({ groups, disputed = [], total }: DupesPanelProps) {
  const dupRows = groups.reduce((s, g) => s + filterAutoDuplicateMembers(g).length, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
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

      {disputed.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-accent/40 bg-accent/5">
          <div className="border-b border-accent/30 px-3 py-2 text-sm font-semibold text-accent-foreground">
            Спорные тёзки — ручная проверка ({disputed.length})
          </div>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Спорные тёзки с разными датами рождения</caption>
            <thead>
              <tr className="border-b border-accent/20 bg-muted/50">
                {["Строка", "ФИО", "Телефон", "Совпадение"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {disputed.slice(0, 50).map(([m]) => (
                <tr key={m.excelRow} className="border-b border-accent/10 last:border-0">
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{m.excelRow}</td>
                  <td className="px-3 py-1.5">{m.fio || "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{m.phone || ""}</td>
                  <td className="px-3 py-1.5 text-xs font-medium text-accent-foreground">{m.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {disputed.length > 50 && <p className="border-t border-accent/20 px-3 py-2 text-xs text-muted-foreground">Показаны первые 50 случаев — полный список будет в отчёте.</p>}
        </div>
      )}
    </div>
  )
}

"use client"

import type { DupMember } from "@/workers/match.worker"

interface DupesPanelProps {
  groups: DupMember[][]
  total: number
}

export function DupesPanel({ groups, total }: DupesPanelProps) {
  const dupRows = groups.reduce((s, g) => s + g.length, 0)

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
    </div>
  )
}

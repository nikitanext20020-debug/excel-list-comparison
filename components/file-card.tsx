"use client"

import { useRef, useState } from "react"
import type { LoadedFile } from "@/lib/xlsx-io"
import { colLetter, loadExcelFile, switchSheet } from "@/lib/xlsx-io"
import type { ColumnConfig } from "@/workers/match.worker"
import { ExcelIcon } from "@/components/excel-icon"

interface FileCardProps {
  index: 1 | 2
  title: string
  subtitle: string
  file: LoadedFile | null
  dimmed?: boolean
  onLoaded: (f: LoadedFile) => void
}

const selectCls =
  "w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"

function sampleValue(rows: string[][], c: number): string {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const v = String((rows[r] || [])[c] || "").trim()
    if (v) return v.length > 20 ? v.slice(0, 20) + "…" : v
  }
  return ""
}

function ColumnSelect({
  label,
  value,
  maxCols,
  rows,
  onChange,
}: {
  label: string
  value: number
  maxCols: number
  rows: string[][]
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <select className={selectCls} value={value} onChange={(e) => onChange(+e.target.value)}>
        <option value={-1}>— не выбран —</option>
        {Array.from({ length: maxCols }, (_, c) => {
          const smp = sampleValue(rows, c)
          return (
            <option key={c} value={c}>
              {colLetter(c)}
              {smp ? ` — «${smp}»` : ""}
            </option>
          )
        })}
      </select>
    </label>
  )
}

export function FileCard({ index, title, subtitle, file, dimmed, onLoaded }: FileCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  async function handleFile(f: File) {
    setLoading(true)
    setLoadError(null)
    try {
      const loaded = await loadExcelFile(f)
      // применяем сохранённые настройки столбцов для этого файла, если есть
      try {
        const saved = localStorage.getItem("sverka-cfg:" + f.name)
        if (saved) loaded.cfg = { ...loaded.cfg, ...(JSON.parse(saved) as ColumnConfig) }
      } catch {
        /* настройки не критичны */
      }
      onLoaded(loaded)
    } catch (e) {
      setLoadError("Не удалось прочитать файл: " + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
    }
  }

  function updateCfg(patch: Partial<ColumnConfig>) {
    if (!file) return
    const cfg = { ...file.cfg, ...patch }
    try {
      localStorage.setItem("sverka-cfg:" + file.name, JSON.stringify(cfg))
    } catch {
      /* настройки не критичны */
    }
    onLoaded({ ...file, cfg })
  }

  const maxCols = file ? Math.min(Math.max(...file.rows.slice(0, 20).map((r) => r.length), 1), 30) : 0
  const fioCols = file
    ? file.cfg.fioMode === "single"
      ? [file.cfg.fio]
      : [file.cfg.fam, file.cfg.im, file.cfg.ot]
    : []

  return (
    <section
      aria-label={title}
      className={`flex flex-col rounded-lg border border-border bg-card transition-opacity ${dimmed ? "opacity-40 pointer-events-none" : ""}`}
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-xs font-semibold text-primary">Ф{index}</span>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">{subtitle}</p>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm,.csv"
        aria-label={`Файл ${index}: ${title} — выбрать файл Excel или CSV`}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = ""
        }}
      />

      {!file ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            const f = e.dataTransfer.files?.[0]
            if (f) handleFile(f)
          }}
          className={`m-4 flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors ${
            drag ? "border-primary bg-primary/5" : "border-input hover:border-primary/60 hover:bg-muted"
          }`}
        >
          <ExcelIcon size={56} />
          <span className="text-sm font-medium">{loading ? "Читаю файл…" : "Перетащите файл или нажмите"}</span>
          <span className="text-xs text-muted-foreground">Excel или CSV, обрабатывается локально</span>
          {loadError && <span className="text-xs text-destructive">{loadError}</span>}
        </button>
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="max-w-full truncate rounded bg-secondary px-2 py-1 font-mono text-xs text-secondary-foreground">
              {file.name}
            </span>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-xs text-primary underline underline-offset-2 hover:no-underline"
            >
              выбрать другой
            </button>
            {file.sheetNames.length > 1 && (
              <select
                aria-label="Лист книги"
                className="rounded-md border border-input bg-card px-2 py-1 text-xs"
                value={file.sheet}
                onChange={(e) => onLoaded(switchSheet(file, e.target.value))}
              >
                {file.sheetNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Предпросмотр */}
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse font-mono text-[11px] leading-relaxed">
              <thead>
                <tr>
                  <th className="border-b border-border bg-muted px-1.5 py-1 text-left text-muted-foreground" />
                  {Array.from({ length: maxCols }, (_, c) => {
                    const isFio = fioCols.includes(c)
                    const isPhone = c === file.cfg.phone
                    const isDob = c === file.cfg.dob
                    return (
                      <th
                        key={c}
                        className={`whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-semibold ${
                          isFio
                            ? "bg-primary text-primary-foreground"
                            : isPhone || isDob
                              ? "bg-accent text-accent-foreground"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {colLetter(c)}
                        {isFio ? " ФИО" : isPhone ? " тел" : isDob ? " ДР" : ""}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {file.rows.slice(0, 6).map((row, r) => (
                  <tr key={r} className={r + 1 >= file.cfg.start ? "" : "opacity-45"}>
                    <td className="border-b border-border bg-muted px-1.5 py-1 text-muted-foreground">{r + 1}</td>
                    {Array.from({ length: maxCols }, (_, c) => {
                      let v = String((row || [])[c] ?? "")
                      if (v.length > 24) v = v.slice(0, 24) + "…"
                      return (
                        <td key={c} className="max-w-40 truncate border-b border-border px-1.5 py-1">
                          {v}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Настройка столбцов */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Данные со строки</span>
              <input
                type="number"
                min={1}
                value={file.cfg.start}
                onChange={(e) => updateCfg({ start: Math.max(1, +e.target.value || 1) })}
                className={selectCls}
              />
            </label>
            <div className="col-span-2 flex flex-col gap-1 sm:col-span-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">ФИО записано</span>
              <div className="flex gap-1 rounded-md border border-input bg-muted p-0.5" role="radiogroup" aria-label="Формат ФИО">
                {(
                  [
                    ["single", "одним столбцом"],
                    ["three", "тремя (Ф/И/О)"],
                  ] as const
                ).map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    role="radio"
                    aria-checked={file.cfg.fioMode === val}
                    onClick={() => updateCfg({ fioMode: val })}
                    className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                      file.cfg.fioMode === val ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {file.cfg.fioMode === "single" ? (
              <ColumnSelect label="Столбец ФИО" value={file.cfg.fio} maxCols={maxCols} rows={file.rows} onChange={(v) => updateCfg({ fio: v })} />
            ) : (
              <>
                <ColumnSelect label="Фамилия" value={file.cfg.fam} maxCols={maxCols} rows={file.rows} onChange={(v) => updateCfg({ fam: v })} />
                <ColumnSelect label="Имя" value={file.cfg.im} maxCols={maxCols} rows={file.rows} onChange={(v) => updateCfg({ im: v })} />
                <ColumnSelect label="Отчество" value={file.cfg.ot} maxCols={maxCols} rows={file.rows} onChange={(v) => updateCfg({ ot: v })} />
              </>
            )}
            <ColumnSelect label="Телефон (необязательно)" value={file.cfg.phone} maxCols={maxCols} rows={file.rows} onChange={(v) => updateCfg({ phone: v })} />
            <ColumnSelect label="Дата рождения (необязательно)" value={file.cfg.dob} maxCols={maxCols} rows={file.rows} onChange={(v) => updateCfg({ dob: v })} />
          </div>
        </div>
      )}
    </section>
  )
}

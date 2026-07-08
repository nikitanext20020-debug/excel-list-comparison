"use client"

import { useEffect, useRef, useState } from "react"
import { FileCard } from "@/components/file-card"
import { ResultsPanel, type Decision } from "@/components/results-panel"
import { DupesPanel } from "@/components/dupes-panel"
import type { LoadedFile } from "@/lib/xlsx-io"
import { buildColored, buildExport, buildDupesFile, buildCleanFile, downloadBlob } from "@/lib/xlsx-io"
import type { Strictness } from "@/lib/matching"
import type { RowResult, DupMember, WorkerResponse, WorkerRequest, ColumnConfig } from "@/workers/match.worker"

type Mode = "color" | "export" | "dupes"

const MODES: { id: Mode; title: string; desc: string }[] = [
  { id: "color", title: "Покраска файла", desc: "Найденные строки заливаются цветом прямо в копии файла 1" },
  { id: "export", title: "Выгрузка листами", desc: "Отдельный файл с листами «Найдены», «Не найдены», «Спорные»" },
  { id: "dupes", title: "Поиск дублей", desc: "Ищет повторы внутри файла 1 и собирает файл без дублей" },
]

const SWATCHES = ["92D050", "FFFF00", "00B0F0", "FFC000", "F4B6C2"]

const STRICTNESS: { id: Strictness; label: string; desc: string }[] = [
  { id: "strict", label: "Строгая", desc: "меньше ложных совпадений" },
  { id: "normal", label: "Обычная", desc: "проверенные пороги" },
  { id: "soft", label: "Мягкая", desc: "ловит больше опечаток" },
]

function Step({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-4 md:grid-cols-[72px_1fr]">
      <div className="flex items-baseline gap-3 md:flex-col md:items-end md:gap-1">
        <span className="font-mono text-2xl font-semibold text-primary tabular-nums" aria-hidden="true">
          {num}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-3 border-border pb-10 md:border-l md:pl-6">
        <h2 className="text-base font-semibold text-balance">{title}</h2>
        {children}
      </div>
    </section>
  )
}

function validateCfg(f: LoadedFile | null, label: string): string | null {
  if (!f) return `${label}: файл не выбран.`
  const c = f.cfg
  if (c.fioMode === "single") {
    if (c.fio < 0) return `${label}: выберите столбец с ФИО.`
  } else if (c.fam < 0 || c.im < 0) {
    return `${label}: выберите столбцы «Фамилия» и «Имя».`
  }
  return null
}

export default function Page() {
  const [fileA, setFileA] = useState<LoadedFile | null>(null)
  const [fileB, setFileB] = useState<LoadedFile | null>(null)
  const [mode, setMode] = useState<Mode>("color")
  const [strictness, setStrictness] = useState<Strictness>("normal")
  const [matchColor, setMatchColor] = useState(SWATCHES[0])
  const [expWhat, setExpWhat] = useState<"found" | "notfound" | "both">("both")
  const [addLabel, setAddLabel] = useState(true)
  const [paintRed, setPaintRed] = useState(false)
  const [dupWithLog, setDupWithLog] = useState(true)
  const [dupDelPhone, setDupDelPhone] = useState(false)

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ pct: number; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [compareRes, setCompareRes] = useState<{ results: RowResult[]; dbCount: number } | null>(null)
  const [dupes, setDupes] = useState<{ groups: DupMember[][]; total: number } | null>(null)
  const [decisions, setDecisions] = useState<Record<number, Decision>>({})
  const [downloadNote, setDownloadNote] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)
  useEffect(() => () => workerRef.current?.terminate(), [])

  const needB = mode !== "dupes"
  const ready = !!fileA && (!needB || !!fileB) && !running

  function run() {
    setError(null)
    setCompareRes(null)
    setDupes(null)
    setDecisions({})
    setDownloadNote(null)

    const err = validateCfg(fileA, "Файл 1") || (needB ? validateCfg(fileB, "Файл 2") : null)
    if (err) {
      setError(err)
      return
    }
    setRunning(true)
    setProgress({ pct: 0, text: "Запуск…" })

    workerRef.current?.terminate()
    const worker = new Worker(new URL("../workers/match.worker.ts", import.meta.url))
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      if (msg.kind === "progress") setProgress({ pct: msg.pct, text: msg.text })
      else if (msg.kind === "compare-done") {
        setCompareRes({ results: msg.results, dbCount: msg.dbCount })
        setRunning(false)
      } else if (msg.kind === "dupes-done") {
        setDupes({ groups: msg.groups, total: msg.total })
        setRunning(false)
      } else if (msg.kind === "error") {
        setError("Ошибка: " + msg.message + ". Если файл сложный (защита, макросы) — пересохраните его как обычный .xlsx.")
        setRunning(false)
      }
    }
    worker.onerror = (e) => {
      setError("Ошибка обработки: " + e.message)
      setRunning(false)
    }

    const req: WorkerRequest =
      mode === "dupes"
        ? { kind: "dupes", rows1: fileA!.rows, cfg1: fileA!.cfg as ColumnConfig, strictness }
        : { kind: "compare", rows1: fileA!.rows, cfg1: fileA!.cfg, rows2: fileB!.rows, cfg2: fileB!.cfg, strictness }
    worker.postMessage(req)
  }

  /* применяем ручные решения по спорным к результатам перед сборкой файла */
  function adjustedResults(): RowResult[] {
    if (!compareRes) return []
    return compareRes.results.map((r) => {
      if (r.res.status !== "disputed") return r
      const d = decisions[r.excelRow]
      if (d === "yes") return { ...r, res: { ...r.res, status: "typo" as const, reason: "подтверждено вручную" } }
      if (d === "no") return { ...r, res: { ...r.res, status: "notfound" as const, reason: undefined } }
      return r
    })
  }

  function downloadResult() {
    if (!fileA || !compareRes) return
    const base = fileA.name.replace(/\.[^.]+$/, "")
    const results = adjustedResults()
    try {
      if (mode === "color") {
        downloadBlob(buildColored(fileA.rows, fileA.cfg, results, matchColor, { addLabel, paintRed }), base + "_РЕЗУЛЬТАТ.xlsx")
      } else {
        downloadBlob(buildExport(fileA.rows, fileA.cfg, results, expWhat), base + "_СВЕРКА.xlsx")
      }
      setDownloadNote("Файл скачан.")
    } catch (e) {
      setError("Не удалось собрать файл: " + (e instanceof Error ? e.message : String(e)))
    }
  }

  function downloadDupesReport() {
    if (!fileA || !dupes) return
    const base = fileA.name.replace(/\.[^.]+$/, "")
    downloadBlob(buildDupesFile(dupes.groups), base + "_ДУБЛИ.xlsx")
    setDownloadNote("Отчёт по дублям скачан.")
  }

  function downloadClean() {
    if (!fileA || !dupes) return
    const base = fileA.name.replace(/\.[^.]+$/, "")
    const out = buildCleanFile(fileA, dupes.groups, { withLog: dupWithLog, delPhone: dupDelPhone })
    if (!out) {
      setDownloadNote("Нечего удалять: все группы — совпадения только по телефону. Включите вторую галочку, если их тоже нужно удалить.")
      return
    }
    downloadBlob(out.blob, base + "_БЕЗ_ДУБЛЕЙ.xlsx")
    setDownloadNote(`Удалено строк: ${out.removedCount}. Файл скачан.`)
  }

  const disputedLeft = compareRes
    ? compareRes.results.filter((r) => r.res.status === "disputed" && !decisions[r.excelRow]).length
    : 0

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-baseline justify-between gap-2 px-4 py-4 xl:px-0">
          <h1 className="text-lg font-semibold tracking-tight">
            Сверка списков <span className="font-mono text-sm font-normal text-primary">ФИО · телефон · дата рождения</span>
          </h1>
          <p className="rounded-full border border-border bg-muted px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            локально · файлы не покидают браузер
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pt-10 pb-10 xl:px-0">
        <Step num="01" title="Выберите файлы">
          <div className="grid gap-4 lg:grid-cols-2">
            <FileCard index={1} title="Что сверяем" subtitle="файл, который проверяем" file={fileA} onLoaded={setFileA} />
            <FileCard
              index={2}
              title="База для сверки"
              subtitle="файл, в котором ищем"
              file={fileB}
              dimmed={mode === "dupes"}
              onLoaded={setFileB}
            />
          </div>
          {mode === "dupes" && <p className="text-xs text-muted-foreground">Для поиска дублей нужен только файл 1.</p>}
        </Step>

        <Step num="02" title="Режим и настройки">
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Режим работы">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                className={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
                  mode === m.id ? "border-primary bg-card ring-2 ring-primary/25" : "border-border bg-card hover:border-primary/50"
                }`}
              >
                <span className="text-sm font-semibold">{m.title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{m.desc}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Строгость сверки</span>
              <div className="flex flex-wrap gap-1 rounded-md border border-input bg-muted p-0.5" role="radiogroup" aria-label="Строгость сверки">
                {STRICTNESS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={strictness === s.id}
                    onClick={() => setStrictness(s.id)}
                    className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                      strictness === s.id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.label} <span className="hidden font-normal text-muted-foreground sm:inline">— {s.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {mode === "color" && (
              <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                <div className="flex flex-col gap-1.5">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Цвет найденных</span>
                  <div className="flex gap-1.5" role="radiogroup" aria-label="Цвет заливки найденных строк">
                    {SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={matchColor === c}
                        aria-label={`Цвет #${c}`}
                        onClick={() => setMatchColor(c)}
                        style={{ backgroundColor: `#${c}` }}
                        className={`h-8 w-8 rounded-md border transition-transform ${
                          matchColor === c ? "scale-110 border-foreground ring-2 ring-foreground/25" : "border-border hover:scale-105"
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={addLabel} onChange={(e) => setAddLabel(e.target.checked)} className="h-4 w-4 accent-primary" />
                  добавить столбец «Результат сверки»
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={paintRed} onChange={(e) => setPaintRed(e.target.checked)} className="h-4 w-4 accent-primary" />
                  не найденных красить красным
                </label>
              </div>
            )}

            {mode === "export" && (
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Что выгружать</span>
                <div className="flex flex-wrap gap-4" role="radiogroup" aria-label="Что выгружать">
                  {(
                    [
                      ["both", "найденных и не найденных"],
                      ["found", "только найденных"],
                      ["notfound", "только не найденных"],
                    ] as const
                  ).map(([val, lbl]) => (
                    <label key={val} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="expWhat"
                        checked={expWhat === val}
                        onChange={() => setExpWhat(val)}
                        className="h-4 w-4 accent-primary"
                      />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {mode === "dupes" && (
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={dupWithLog} onChange={(e) => setDupWithLog(e.target.checked)} className="h-4 w-4 accent-primary" />
                  удалённых вывести на лист «Удалённые»
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={dupDelPhone} onChange={(e) => setDupDelPhone(e.target.checked)} className="h-4 w-4 accent-primary" />
                  удалять и совпадения только по телефону
                </label>
              </div>
            )}
          </div>
        </Step>

        <Step num="03" title="Запуск и результат">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={!ready}
              className="rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? "Обрабатываю…" : mode === "dupes" ? "Найти дубли" : "Запустить сверку"}
            </button>
            {!ready && !running && (
              <p className="text-xs text-muted-foreground">{needB ? "Сначала выберите оба файла." : "Выберите файл 1."}</p>
            )}
          </div>

          {progress && (
            <div className="flex flex-col gap-1.5">
              <div
                className="h-2 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-valuenow={progress.pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${progress.pct}%` }} />
              </div>
              <p className="font-mono text-xs text-muted-foreground">{progress.text}</p>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {compareRes && (
            <>
              <ResultsPanel
                results={compareRes.results}
                dbCount={compareRes.dbCount}
                decisions={decisions}
                onDecide={(row, d) =>
                  setDecisions((prev) => {
                    const next = { ...prev }
                    if (d) next[row] = d
                    else delete next[row]
                    return next
                  })
                }
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={downloadResult}
                  className="rounded-md bg-foreground px-6 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
                >
                  Скачать результат (.xlsx)
                </button>
                {disputedLeft > 0 && (
                  <p className="text-xs text-accent-foreground">
                    Спорных без решения: {disputedLeft} — они попадут в файл со статусом «спорный».
                  </p>
                )}
              </div>
            </>
          )}

          {dupes && (
            <>
              <DupesPanel groups={dupes.groups} total={dupes.total} />
              {dupes.groups.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={downloadClean}
                    className="rounded-md bg-foreground px-6 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
                  >
                    Скачать файл без дублей
                  </button>
                  <button
                    type="button"
                    onClick={downloadDupesReport}
                    className="rounded-md border border-input bg-card px-6 py-2.5 text-sm font-semibold transition-colors hover:border-foreground/40"
                  >
                    Скачать отчёт по дублям
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Дубли не найдены — файл чистый.</p>
              )}
            </>
          )}

          {downloadNote && <p className="font-mono text-xs text-primary">{downloadNote}</p>}
        </Step>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-4 py-6 xl:px-0">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Сверка учитывает ё/е, порядок слов, опечатки, смену фамилии по телефону и тёзок по дате рождения. Обработка идёт в
            отдельном потоке браузера — интерфейс не замирает даже на больших файлах.
          </p>
        </div>
      </footer>
    </div>
  )
}

"use client"

import { useEffect, useRef, useState } from "react"
import { FileCard } from "@/components/file-card"
import { ResultsPanel, type Decision } from "@/components/results-panel"
import { DupesPanel } from "@/components/dupes-panel"
import Image from "next/image"
import { BlurInText } from "@/components/blur-in-text"
import { AiAssistant } from "@/components/ai-assistant"
import { SwapFilesButton } from "@/components/swap-files-button"
import type { LoadedFile } from "@/lib/xlsx-io"
import { buildColored, buildExport, buildDupesFile, buildCleanFile, buildPhoneReportFile, buildPhoneCleanFile, downloadBlob } from "@/lib/xlsx-io"
import { isAiJudgeablePair, type DupAiResult, type DupNamesakeDecision } from "@/lib/dupes"
import type { Strictness } from "@/lib/matching"
import type { RowResult, DupMember, WorkerResponse, WorkerRequest, ColumnConfig } from "@/workers/match.worker"

type Mode = "color" | "export" | "dupes"

const MODES: { id: Mode; title: string; desc: string }[] = [
  { id: "color", title: "Покраска файла", desc: "Найденные строки заливаются цветом прямо в копии файла 1" },
  { id: "export", title: "Выгрузка листами", desc: "Отдельный файл с листами «Найдены», «Не найдены», «Спорные»" },
  { id: "dupes", title: "Поиск дублей", desc: "Ищет повторы внутри файла 1 и собирает файл без дублей" },
]

const SWATCHES = ["92D050", "FFFF00", "00B0F0", "FFC000", "F4B6C2"]

const STRICTNESS: { id: Strictness; label: string; desc: string; hint: string }[] = [
  {
    id: "strict",
    label: "Строгая",
    desc: "меньше ложных совпадений",
    hint: "Совпадением считается почти точное сходство ФИО (от 94%). Разных людей почти никогда не склеит, но реальные опечатки могут уйти в «не найдены». Выбирайте, когда цена ложного совпадения высока.",
  },
  {
    id: "normal",
    label: "Обычная",
    desc: "проверенные пороги",
    hint: "Сбалансированные пороги (сходство ФИО от 90%): ловит типичные опечатки, ё/е и перестановку слов, при этом редко даёт ложные пары. Подходит для большинства сверок.",
  },
  {
    id: "soft",
    label: "Мягкая",
    desc: "ловит больше опечаток",
    hint: "Пониженные пороги (сходство ФИО от 85%): находит больше опечаток и сокращений, но чаще отправляет случаи в «спорные» на ручную проверку. Выбирайте для «грязных» файлов с ошибками ввода.",
  },
]

function Step({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-4 md:grid-cols-[72px_1fr]">
      <div className="flex items-baseline gap-3 md:flex-col md:items-end md:gap-1">
        <span className="font-mono text-2xl font-semibold text-primary tabular-nums" aria-hidden="true">
          {num}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-3 border-border pb-[35px] md:border-l md:pl-6">
        <h2 className="text-base font-semibold text-balance" style={{ color: "var(--chart-1)" }}>
          {title}
        </h2>
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
  const [dupPhoneReport, setDupPhoneReport] = useState(false)

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ pct: number; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [compareRes, setCompareRes] = useState<{ results: RowResult[]; dbCount: number } | null>(null)
  const [dupes, setDupes] = useState<{ groups: DupMember[][]; disputed: DupMember[][]; phoneGroups: DupMember[][]; total: number } | null>(null)
  const [decisions, setDecisions] = useState<Record<number, Decision>>({})
  const [dupDecisions, setDupDecisions] = useState<Record<number, DupNamesakeDecision>>({})
  const [dupAiVerdicts, setDupAiVerdicts] = useState<Record<number, DupAiResult>>({})
  const [dupAiEnabled, setDupAiEnabled] = useState(false)
  const [dupAiRunning, setDupAiRunning] = useState(false)
  const [dupAiProgress, setDupAiProgress] = useState<{ done: number; total: number } | null>(null)
  const [dupAiError, setDupAiError] = useState<string | null>(null)
  const [downloadNote, setDownloadNote] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)
  useEffect(() => () => workerRef.current?.terminate(), [])
  useEffect(() => {
    let active = true
    fetch("/api/judge-pairs")
      .then((res) => (res.ok ? res.json() : { enabled: false }))
      .then((data: { enabled?: boolean }) => {
        if (active) setDupAiEnabled(data.enabled === true)
      })
      .catch(() => {
        if (active) setDupAiEnabled(false)
      })
    return () => {
      active = false
    }
  }, [])

  const needB = mode !== "dupes"
  const ready = !!fileA && (!needB || !!fileB) && !running

  /* меняем файлы местами (вместе с их настройками столбцов) и сбрасываем результаты */
  function swapFiles() {
    setFileA(fileB)
    setFileB(fileA)
    setCompareRes(null)
    setDupes(null)
    setDecisions({})
    setDupDecisions({})
    setDupAiVerdicts({})
    setDupAiProgress(null)
    setDupAiError(null)
    setProgress(null)
    setDownloadNote(null)
    setError(null)
  }

  function run() {
    setError(null)
    setCompareRes(null)
    setDupes(null)
    setDecisions({})
    setDupDecisions({})
    setDupAiVerdicts({})
    setDupAiProgress(null)
    setDupAiError(null)
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
        setDupes({ groups: msg.groups, disputed: msg.disputed ?? [], phoneGroups: msg.phoneGroups ?? [], total: msg.total })
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
        ? { kind: "dupes", rows1: fileA!.rows, rawRows1: fileA!.rawRows, cfg1: fileA!.cfg as ColumnConfig, strictness }
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

  type JudgeSourceRow = {
    excelRow: number
    columns: { header: string; value: string }[]
  }

  type JudgePairPayload = {
    index: number
    left: JudgeSourceRow
    right: JudgeSourceRow
    matchReason: string
  }

  function buildJudgePairs(indices: number[]): JudgePairPayload[] {
    if (!fileA || !dupes) return []
    const headerRow = fileA.rows[fileA.cfg.start - 2] || []
    const maxCols = Math.max(headerRow.length, ...fileA.rows.map((row) => row.length), 1)
    const headers = Array.from({ length: maxCols }, (_, col) => String(headerRow[col] || "").trim() || `Колонка ${col + 1}`)
    const sourceRow = (excelRow: number): JudgeSourceRow => {
      const row = fileA.rows[excelRow - 1] || []
      return {
        excelRow,
        columns: headers.map((header, col) => ({ header, value: String(row[col] ?? "") })),
      }
    }
    return indices
      .map((index) => {
        const pair = dupes.disputed[index]
        if (!pair?.[0] || !pair[1]) return null
        return {
          index,
          left: sourceRow(pair[0].excelRow),
          right: sourceRow(pair[1].excelRow),
          matchReason: `${pair[0].type}; ${pair[1].type}`,
        }
      })
      .filter((pair): pair is JudgePairPayload => pair !== null)
  }

  async function judgePairIndices(indices: number[]) {
    if (!dupAiEnabled || dupAiRunning || !fileA || !dupes) return
    const target = [...new Set(indices)].filter((index) => {
      const pair = dupes.disputed[index]
      return !!pair && isAiJudgeablePair(pair)
    })
    if (!target.length) return
    setDupAiRunning(true)
    setDupAiError(null)
    setDupAiProgress({ done: 0, total: target.length })
    const failures: number[] = []
    try {
      for (let start = 0; start < target.length; start += 15) {
        const batchIndices = target.slice(start, start + 15)
        const pairs = buildJudgePairs(batchIndices)
        try {
          const response = await fetch("/api/judge-pairs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pairs }),
          })
          if (!response.ok) throw new Error(`Сервис ИИ ответил (${response.status})`)
          const data = (await response.json()) as { results?: (DupAiResult & { index: number })[] }
          const results = data.results
          if (!Array.isArray(results)) throw new Error("Некорректный ответ сервиса ИИ")
          const returnedIndices = new Set(results.map((result) => result.index))
          const missingIndices = batchIndices.filter((index) => !returnedIndices.has(index))
          if (missingIndices.length) failures.push(...missingIndices)
          setDupAiVerdicts((previous) => {
            const next = { ...previous }
            for (const result of results) {
              if (batchIndices.includes(result.index)) next[result.index] = result
            }
            return next
          })
        } catch (error) {
          failures.push(...batchIndices)
          console.error("[judge-pairs] batch failed:", error)
        }
        setDupAiProgress({ done: Math.min(start + batchIndices.length, target.length), total: target.length })
      }
      if (failures.length) {
        setDupAiError(`Не удалось проверить ${failures.length} ${failures.length === 1 ? "пару" : "пар"}. Их можно проверить повторно.`)
      }
    } finally {
      setDupAiRunning(false)
    }
  }

  function acceptConfidentAiVerdicts() {
    setDupDecisions((previous) => {
      const next = { ...previous }
      for (const [index, result] of Object.entries(dupAiVerdicts)) {
        if (result.confidence >= 90 && result.verdict === "same") next[Number(index)] = "yes"
        if (result.confidence >= 90 && result.verdict === "different") next[Number(index)] = "no"
      }
      return next
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
        downloadBlob(
          buildExport(fileA.rows, fileA.cfg, results, expWhat, {
            passportEnabled: fileA.cfg.passport >= 0 && (fileB?.cfg.passport ?? -1) >= 0,
          }),
          base + "_СВЕРКА.xlsx",
        )
      }
      setDownloadNote("Файл скачан.")
    } catch (e) {
      setError("Не удалось собрать файл: " + (e instanceof Error ? e.message : String(e)))
    }
  }

  function downloadDupesReport() {
    if (!fileA || !dupes) return
    const base = fileA.name.replace(/\.[^.]+$/, "")
    const samePairs = dupes.disputed.filter((_, index) => dupDecisions[index] === "yes")
    downloadBlob(buildDupesFile(dupes.groups, dupes.disputed, {
      manualSamePairs: samePairs,
      aiVerdicts: dupAiVerdicts,
      decisions: dupDecisions,
      includePassport: fileA.cfg.passport >= 0,
    }), base + "_ДУБЛИ.xlsx")
    setDownloadNote("Отчёт по дублям скачан.")
  }

  function downloadClean() {
    if (!fileA || !dupes) return
    const base = fileA.name.replace(/\.[^.]+$/, "")
    const samePairs = dupes.disputed.filter((_, index) => dupDecisions[index] === "yes")
    const out = buildCleanFile(fileA, dupes.groups, { withLog: dupWithLog, delPhone: dupDelPhone, manualSamePairs: samePairs })
    if (!out) {
      setDownloadNote("Нечего удалять: все группы — совпадения только по телефону. Включите вторую галочку, если их тоже нужно удалить.")
      return
    }
    downloadBlob(out.blob, base + "_БЕЗ_ДУБЛЕЙ.xlsx")
    setDownloadNote(`Удалено строк: ${out.removedCount}. Файл скачан.`)
  }

  function downloadPhoneReport() {
    if (!fileA || !dupes || !dupes.phoneGroups.length) return
    const base = fileA.name.replace(/\.[^.]+$/, "")
    downloadBlob(buildPhoneReportFile(fileA.rows, fileA.cfg, dupes.phoneGroups), base + "_ТЕЛЕФОНЫ.xlsx")
    setDownloadNote("Список одинаковых телефонов скачан.")
  }

  function downloadPhoneClean() {
    if (!fileA || !dupes || !dupes.phoneGroups.length) return
    const base = fileA.name.replace(/\.[^.]+$/, "")
    const out = buildPhoneCleanFile(fileA, dupes.phoneGroups, { withLog: dupWithLog })
    if (!out) {
      setDownloadNote("Нечего удалять: одинаковых телефонов не найдено.")
      return
    }
    downloadBlob(out.blob, base + "_БЕЗ_ПОВТОРОВ_ТЕЛЕФОНОВ.xlsx")
    setDownloadNote(`Удалено строк: ${out.removedCount}. Файл скачан.`)
  }

  const disputedLeft = compareRes
    ? compareRes.results.filter((r) => r.res.status === "disputed" && !decisions[r.excelRow]).length
    : 0
  const passportConflictCount = compareRes
    ? compareRes.results.filter((r) => r.res.status === "passport-conflict").length
    : 0
  const acceptedDupNamesakes = dupes
    ? dupes.disputed.filter((_, index) => dupDecisions[index] === "yes").length
    : 0

  return (
    <div className="min-h-screen">
      <header className="glass-card sticky top-0 z-10 border-b border-border/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-baseline justify-between gap-2 px-4 py-4 xl:px-0">
          <h1 className="text-gradient-hero text-lg font-bold tracking-tight">
            Сверка списков{" "}
            <span
              className="text-sm font-normal text-primary"
              style={{ WebkitTextFillColor: "var(--primary)", fontFamily: "system-ui", marginLeft: "10px" }}
            >
              <BlurInText text="паспорт · фио · телефон · дата рождения" />
            </span>
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <p
              className="font-rubik text-sm inline"
              style={{
                fontWeight: "300",
                color: "#ffffff",
                paddingRight: "70px",
                borderBottom: "1px solid rgba(217, 221, 230, 0)",
                lineHeight: "1.4em",
                paddingBottom: "1px",
              }}
            >
              разработано{" "}
              <a
                href="https://t.me/pythonvoin"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 transition-colors hover:underline hover:brightness-125"
                style={{ fontWeight: "400", textTransform: "capitalize" }}
              >
                Никитой Мищенко
              </a>
            </p>
            <p
              className="anim-pulse-glow rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wider"
              style={{ color: "#5dffe1", marginRight: "-13px" }}
            >
              локально · файлы не покидают браузер
            </p>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-4 pt-10 pb-10 xl:px-0">
        {/* декоративная 3D-иконка Excel слева от шагов: крупнее и ближе к контенту,
            видна уже с xl-экранов, чтобы не пропадала при приближении */}
        <div
          className="pointer-events-none absolute top-10 hidden select-none xl:-left-44 xl:block 2xl:-left-60"
          aria-hidden="true"
        >
          <Image
            src="/images/excel-3d.webp"
            alt=""
            width={280}
            height={280}
            priority
            className="anim-float-slow-alt w-[170px] drop-shadow-[0_0_55px_rgba(34,197,94,0.4)] xl:w-[220px] 2xl:w-[280px]"
          />
        </div>
        <Step num="01" title="Выберите файлы">
          <div className="relative grid gap-4 lg:grid-cols-2">
            {/* на мобильных кнопка стоит между карточками (order-2),
                на десктопе — по центру над карточками (absolute) */}
            <SwapFilesButton
              onClick={swapFiles}
              disabled={running || (!fileA && !fileB)}
              className="order-2 justify-self-center lg:absolute lg:-top-9 lg:left-1/2 lg:z-10 lg:order-none lg:-translate-x-1/2"
            />
            <div className="order-1 lg:order-none">
              <FileCard index={1} title="Что сверяем" subtitle="файл, который проверяем" file={fileA} onLoaded={setFileA} />
            </div>
            <div className="order-3 lg:order-none">
              <FileCard
                index={2}
                title="База для сверки"
                subtitle="файл, в котором ищем"
                file={fileB}
                dimmed={mode === "dupes"}
                onLoaded={setFileB}
              />
            </div>
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
                onClick={() => {
                  setMode(m.id)
                  setCompareRes(null)
                  setDupes(null)
                  setDecisions({})
                  setDupDecisions({})
                  setDupAiVerdicts({})
                  setDupAiProgress(null)
                  setDupAiError(null)
                  setProgress(null)
                  setDownloadNote(null)
                  setError(null)
                }}
                className={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-all ${
                  mode === m.id
                    ? "glow-primary-soft border-primary bg-primary/10 ring-2 ring-primary/30"
                    : "border-border bg-card hover:border-primary/50 hover:bg-primary/5"
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
                    aria-describedby={`strictness-hint-${s.id}`}
                    onClick={() => setStrictness(s.id)}
                    className={`btn-lift hint-trigger relative flex-1 rounded px-3 py-1.5 text-xs font-medium ${
                      strictness === s.id
                        ? "glow-primary-soft bg-primary font-bold text-primary-foreground"
                        : "text-muted-foreground hover:bg-primary/10 hover:text-foreground"
                    }`}
                  >
                    {s.label}{" "}
                    <span className={`hidden font-normal sm:inline ${strictness === s.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                      — {s.desc}
                    </span>
                    <span
                      id={`strictness-hint-${s.id}`}
                      role="tooltip"
                      className="hint-bubble glow-primary-soft pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-lg border border-primary/30 bg-popover p-3 text-left text-[11px] font-normal leading-relaxed text-popover-foreground"
                    >
                      {s.hint}
                    </span>
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
                <label className="hint-trigger relative flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={dupPhoneReport} onChange={(e) => setDupPhoneReport(e.target.checked)} className="h-4 w-4 accent-primary" />
                  отдельно собрать совпадения по телефону
                  <span
                    role="tooltip"
                    className="hint-bubble glow-primary-soft pointer-events-none absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-primary/30 bg-popover p-3 text-left text-[11px] font-normal leading-relaxed text-popover-foreground"
                  >
                    Собирает все строки с одинаковым номером телефона, даже если ФИО разные. Полезно для поиска записей, оформленных на один номер
                  </span>
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
              className="btn-lift glow-primary rounded-lg bg-primary px-7 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
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
                passportEnabled={fileA!.cfg.passport >= 0 && fileB!.cfg.passport >= 0}
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
                  className="btn-lift rounded-lg bg-foreground px-6 py-2.5 text-sm font-bold text-background shadow-[0_0_24px_rgba(230,237,247,0.18)] hover:opacity-90"
                >
                  Скачать результат (.xlsx)
                </button>
                {disputedLeft > 0 && (
                  <p className="text-xs text-accent-foreground">
                    Спорных без решения: {disputedLeft} — они попадут в файл со статусом «спорный».
                  </p>
                )}
                {passportConflictCount > 0 && (
                  <p className="text-xs text-accent-foreground">
                    Конфликтов паспорта: {passportConflictCount} — они выделены оранжевым и не считаются найденными.
                  </p>
                )}
              </div>
            </>
          )}

          {dupes && (
            <>
              <DupesPanel
                groups={dupes.groups}
                disputed={dupes.disputed}
                total={dupes.total}
                passportEnabled={fileA!.cfg.passport >= 0}
                dupDelPhone={dupDelPhone}
                decisions={dupDecisions}
                aiVerdicts={dupAiVerdicts}
                aiEnabled={dupAiEnabled}
                aiRunning={dupAiRunning}
                aiProgress={dupAiProgress}
                aiError={dupAiError}
                onJudgeAll={() =>
                  judgePairIndices(
                    dupes.disputed
                      .map((pair, index) => (isAiJudgeablePair(pair) ? index : -1))
                      .filter((index) => index >= 0),
                  )
                }
                onJudgePair={(pairIndex) => judgePairIndices([pairIndex])}
                onAcceptConfident={acceptConfidentAiVerdicts}
                onDecide={(pairIndex, decision) =>
                  setDupDecisions((prev) => {
                    const next = { ...prev }
                    if (decision) next[pairIndex] = decision
                    else delete next[pairIndex]
                    return next
                  })
                }
              />
              {dupes.groups.length > 0 || acceptedDupNamesakes > 0 ? (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={downloadClean}
                    className="btn-lift rounded-lg bg-foreground px-6 py-2.5 text-sm font-bold text-background shadow-[0_0_24px_rgba(230,237,247,0.18)] hover:opacity-90"
                  >
                    Скачать файл без дублей
                  </button>
                  <button
                    type="button"
                    onClick={downloadDupesReport}
                    className="btn-lift rounded-lg border border-primary/40 bg-primary/10 px-6 py-2.5 text-sm font-semibold text-primary hover:bg-primary/20"
                  >
                    Скачать отчёт по дублям
                  </button>
                </div>
              ) : dupes.disputed.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={downloadDupesReport}
                    className="btn-lift rounded-lg border border-primary/40 bg-primary/10 px-6 py-2.5 text-sm font-semibold text-primary hover:bg-primary/20"
                  >
                    Скачать отчёт по дублям
                  </button>
                  <p className="text-sm text-muted-foreground">Автоматических дублей нет: спорные тёзки не удаляются.</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Дубли не найдены — файл чистый.</p>
              )}
              {dupPhoneReport && dupes.phoneGroups.length > 0 && (
                <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
                  <p className="text-sm font-semibold text-primary">
                    Одинаковые телефоны: {dupes.phoneGroups.length} групп, {dupes.phoneGroups.reduce((sum, group) => sum + group.length, 0)} строк
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={downloadPhoneReport}
                      className="btn-lift rounded-lg border border-primary/40 bg-primary/10 px-6 py-2.5 text-sm font-semibold text-primary hover:bg-primary/20"
                    >
                      Скачать список одинаковых телефонов
                    </button>
                    <button
                      type="button"
                      onClick={downloadPhoneClean}
                      className="btn-lift rounded-lg bg-foreground px-6 py-2.5 text-sm font-bold text-background shadow-[0_0_24px_rgba(230,237,247,0.18)] hover:opacity-90"
                    >
                      Скачать файл без повторов телефонов
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {downloadNote && <p className="font-mono text-xs text-primary">{downloadNote}</p>}
        </Step>
      </main>

      <AiAssistant
        context={(() => {
          const fioOf = (row: string[], cfg: ColumnConfig) => {
            if (cfg.fioMode === "single") return cfg.fio >= 0 ? String(row[cfg.fio] ?? "").trim() : ""
            return [cfg.fam, cfg.im, cfg.ot]
              .filter((c) => c >= 0)
              .map((c) => String(row[c] ?? "").trim())
              .filter((p) => p && p.toLowerCase() !== "nan")
              .join(" ")
          }
          const namesOf = (f: typeof fileA, limit: number) => {
            if (!f) return null
            const names = f.rows
              .slice(f.cfg.start)
              .map((r) => fioOf(r, f.cfg))
              .filter(Boolean)
            const shown = names.slice(0, limit)
            return `${names.length} имён${names.length > limit ? ` (первые ${limit})` : ""}: ${shown.join("; ")}`
          }
          const parts: string[] = []
          const n1 = namesOf(fileA, 400)
          const n2 = namesOf(fileB, 400)
          if (n1) parts.push(`Файл 1 «${fileA!.name}» — ${n1}`)
          if (n2) parts.push(`Файл 2 (база) «${fileB!.name}» — ${n2}`)
          if (compareRes) {
            const count = (s: string) => compareRes.results.filter((r) => r.res.status === s).length
            parts.push(
              `Результат сверки (режим: ${mode}, строгость: ${strictness}): всего ${compareRes.results.length} строк. ` +
                `Найдено точно: ${count("exact")}, с опечаткой: ${count("typo")}, смена фамилии: ${count("namechange")}, ` +
                `по телефону: ${count("phone")}, конфликтов паспорта: ${count("passport-conflict")}, спорных: ${count("disputed")}, ` +
                `не найдено: ${count("notfound")}. База: ${compareRes.dbCount} строк.`,
            )
            const detail = compareRes.results
              .filter((r) => r.res.status === "passport-conflict" || r.res.status === "disputed" || r.res.status === "notfound")
              .slice(0, 120)
              .map((r) => {
                if (r.res.status === "passport-conflict") return `строка ${r.excelRow}: ${r.fio} — конфликт паспорта (${r.res.reason ?? "?"})`
                if (r.res.status === "disputed") return `строка ${r.excelRow}: ${r.fio} — спорный (${r.res.reason ?? "?"})`
                return `строка ${r.excelRow}: ${r.fio} — не найден`
              })
            if (detail.length) parts.push(`Спорные и не найденные:\n${detail.join("\n")}`)
          }
          if (dupes) parts.push(`Поиск дублей: групп ${dupes.groups.length}, спорных тёзок ${dupes.disputed.length}, всего строк ${dupes.total}.`)
          return parts.length ? parts.join("\n\n") : undefined
        })()}
      />

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 xl:px-0">
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Сверка учитывает паспорт, ё/е, порядок слов, опечатки, смену фамилии по телефону и тёзок по дате рождения. Обработка идёт в
            отдельном потоке браузера — интерфейс не замирает даже на больших файлах.
          </p>
          <p className="font-rubik text-xs text-muted-foreground">
            разработано{" "}
            <a
              href="https://t.me/pythonvoin"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 transition-colors hover:underline hover:brightness-125"
            >
              Никитой Мищенко
            </a>
          </p>
          <p className="anim-shimmer" style={{ fontFamily: '"Inter", sans-serif', fontSize: "14px", color: "rgba(97, 218, 255, 0.27)" }}>
            последнее обновление июль 2026
          </p>
        </div>
      </footer>
    </div>
  )
}

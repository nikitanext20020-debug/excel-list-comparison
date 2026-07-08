/* Web Worker: вся сверка выполняется вне основного потока —
   интерфейс не замирает даже на больших файлах. */

import {
  makeIndex,
  addToIndex,
  matchRecord,
  normalizeName,
  normalizeFuzzy,
  canonicalKey,
  normalizePhone,
  THRESHOLD_PRESETS,
  type MatchResult,
  type MatchStatus,
  type Strictness,
} from "@/lib/matching"

export interface ColumnConfig {
  start: number
  fioMode: "single" | "three"
  fio: number
  fam: number
  im: number
  ot: number
  phone: number
  dob: number
}

export interface RowResult {
  excelRow: number
  fio: string
  phone: string
  dob: string
  res: MatchResult
}

export interface DupMember {
  excelRow: number
  fio: string
  phone: string
  type: string
}

export type WorkerRequest =
  | { kind: "compare"; rows1: string[][]; cfg1: ColumnConfig; rows2: string[][]; cfg2: ColumnConfig; strictness: Strictness }
  | { kind: "dupes"; rows1: string[][]; cfg1: ColumnConfig; strictness: Strictness }

export type WorkerResponse =
  | { kind: "progress"; pct: number; text: string }
  | { kind: "compare-done"; results: RowResult[]; counts: Record<MatchStatus, number>; dbCount: number }
  | { kind: "dupes-done"; groups: DupMember[][]; total: number }
  | { kind: "error"; message: string }

function getFio(row: string[], cfg: ColumnConfig): string {
  if (cfg.fioMode === "single") return cfg.fio >= 0 ? String(row[cfg.fio] ?? "") : ""
  const parts = [cfg.fam, cfg.im, cfg.ot]
    .filter((c) => c >= 0)
    .map((c) => String(row[c] ?? "").trim())
  return parts.filter((p) => p && p.toLowerCase() !== "nan").join(" ")
}

function cell(row: string[], c: number): string {
  return c >= 0 ? String(row[c] ?? "") : ""
}

function post(msg: WorkerResponse) {
  ;(self as unknown as Worker).postMessage(msg)
}

function runCompare(rows1: string[][], cfg1: ColumnConfig, rows2: string[][], cfg2: ColumnConfig, strictness: Strictness) {
  const th = THRESHOLD_PRESETS[strictness]
  const idx = makeIndex()

  for (let i = cfg2.start - 1; i < rows2.length; i++) {
    const row = rows2[i] || []
    addToIndex(idx, getFio(row, cfg2), cfg2.phone >= 0 ? row[cfg2.phone] : null, cfg2.dob >= 0 ? row[cfg2.dob] : null)
    if (i % 5000 === 0) post({ kind: "progress", pct: Math.round((25 * i) / rows2.length), text: `Читаю базу… ${i.toLocaleString("ru-RU")} строк` })
  }
  post({ kind: "progress", pct: 25, text: `База загружена: ${idx.count.toLocaleString("ru-RU")} записей` })

  const results: RowResult[] = []
  const counts: Record<MatchStatus, number> = { exact: 0, typo: 0, namechange: 0, phone: 0, disputed: 0, notfound: 0, empty: 0 }
  const total = Math.max(rows1.length - (cfg1.start - 1), 1)

  for (let i = cfg1.start - 1; i < rows1.length; i++) {
    const row = rows1[i] || []
    const fio = getFio(row, cfg1)
    const phone = cell(row, cfg1.phone)
    const dob = cell(row, cfg1.dob)
    const res = matchRecord(idx, fio, phone || null, dob || null, th)
    if (res.status !== "empty") {
      results.push({ excelRow: i + 1, fio, phone, dob, res })
      counts[res.status]++
    }
    if (i % 300 === 0) {
      post({ kind: "progress", pct: 25 + Math.round((70 * (i - cfg1.start + 1)) / total), text: `Сверяю… ${(i - cfg1.start + 1).toLocaleString("ru-RU")} из ${total.toLocaleString("ru-RU")}` })
    }
  }
  post({ kind: "progress", pct: 100, text: "Сверка завершена" })
  post({ kind: "compare-done", results, counts, dbCount: idx.count })
}

function runDupes(rows: string[][], cfg: ColumnConfig, strictness: Strictness) {
  const th = THRESHOLD_PRESETS[strictness]
  const idx = makeIndex()
  const byFuzz = new Map<string, number>()
  const byCanon = new Map<string, number>()
  const byPhone = new Map<string, number>()
  const groups: DupMember[][] = []
  const total = Math.max(rows.length - (cfg.start - 1), 1)

  for (let i = cfg.start - 1; i < rows.length; i++) {
    const row = rows[i] || []
    const fio = getFio(row, cfg)
    const phone = cell(row, cfg.phone)
    const nExact = normalizeName(fio)
    const nFuzz = normalizeFuzzy(nExact)
    const nCanon = canonicalKey(nFuzz)
    const ph = normalizePhone(phone || null)
    if (!nFuzz && !ph) continue

    let gid = -1
    let type = ""
    if (nFuzz && byFuzz.has(nFuzz)) { gid = byFuzz.get(nFuzz)!; type = "одинаковое ФИО" }
    else if (nCanon && byCanon.has(nCanon)) { gid = byCanon.get(nCanon)!; type = "ФИО, другой порядок слов" }
    else if (ph && byPhone.has(ph)) { gid = byPhone.get(ph)!; type = "совпал телефон" }
    else if (nFuzz) {
      const res = matchRecord(idx, fio, null, null, th)
      if (res.status === "typo" && res.matchedName && byFuzz.has(res.matchedName)) {
        gid = byFuzz.get(res.matchedName)!
        type = "ФИО с опечаткой"
      }
    }
    if (gid < 0) {
      gid = groups.length
      groups.push([])
      type = ""
    }
    groups[gid].push({ excelRow: i + 1, fio, phone, type: type || "первое упоминание" })
    if (nFuzz && !byFuzz.has(nFuzz)) byFuzz.set(nFuzz, gid)
    if (nCanon && !byCanon.has(nCanon)) byCanon.set(nCanon, gid)
    if (ph && !byPhone.has(ph)) byPhone.set(ph, gid)
    addToIndex(idx, fio, null)

    if (i % 300 === 0) {
      post({ kind: "progress", pct: Math.round((95 * (i - cfg.start + 1)) / total), text: `Ищу дубли… ${(i - cfg.start + 1).toLocaleString("ru-RU")} из ${total.toLocaleString("ru-RU")}` })
    }
  }
  post({ kind: "progress", pct: 100, text: "Поиск завершён" })
  post({ kind: "dupes-done", groups: groups.filter((g) => g.length > 1), total })
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const msg = e.data
    if (msg.kind === "compare") runCompare(msg.rows1, msg.cfg1, msg.rows2, msg.cfg2, msg.strictness)
    else if (msg.kind === "dupes") runDupes(msg.rows1, msg.cfg1, msg.strictness)
  } catch (err) {
    post({ kind: "error", message: err instanceof Error ? err.message : String(err) })
  }
}

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
  normalizeDob,
  THRESHOLD_PRESETS,
  type MatchResult,
  type MatchStatus,
  type Strictness,
} from "@/lib/matching"
import { DUP_NAMESAKE_TYPE } from "@/lib/dupes"

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
  | { kind: "dupes-done"; groups: DupMember[][]; disputed?: DupMember[][]; phoneGroups: DupMember[][]; total: number }
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

  // byFuzz / byCanon / byPhone: ключ → gid
  // Для тёзок используем составной ключ nFuzz + ":" + dob, чтобы не перекрывать исходный ключ
  const byFuzz = new Map<string, number>()
  const byCanon = new Map<string, number>()
  const byPhone = new Map<string, number>()

  const groups: DupMember[][] = []

  // БАГ 1 FIX: храним ДР отдельно по ФИО-ключу внутри каждой группы
  // groupFioDobs[gid] = Map<nFuzz, Set<dob>>
  const groupFioDobs: Map<string, Set<string>>[] = []

  // БАГ 2 FIX: disputed — пары конфликтов [представитель_группы_А, тёзка]
  const disputedPairs: DupMember[][] = []

  // Вспомогательная функция: представитель группы с данным ФИО-ключом
  const groupRepresentative = (gid: number, nFuzz: string | null): DupMember | undefined =>
    groups[gid]?.find((m) => {
      const mn = normalizeFuzzy(normalizeName(m.fio))
      return mn === nFuzz
    }) ?? groups[gid]?.[0]

  const phoneRows = new Map<string, DupMember[]>()
  const totalRows = Math.max(rows.length - (cfg.start - 1), 1)

  let totalNonEmpty = 0
  for (let i = cfg.start - 1; i < rows.length; i++) {
    const row = rows[i] || []
    if (row.some((cellVal) => cellVal && cellVal.trim() !== "")) {
      totalNonEmpty++
    }
  }
  const total = Math.max(totalNonEmpty, 1)

  // БАГ 1 FIX: проверяем конфликт ДР только среди строк с тем же ФИО-ключом
  const hasDobConflict = (gid: number, nFuzzKey: string | null, dob: string | null): boolean => {
    if (!dob || !nFuzzKey) return false
    const fioDobs = groupFioDobs[gid]
    if (!fioDobs) return false
    const dobsForFio = fioDobs.get(nFuzzKey)
    if (!dobsForFio || dobsForFio.size === 0) return false
    return [...dobsForFio].some((memberDob) => memberDob !== dob)
  }

  // Регистрирует строку в группе (обновляет индексы, ДР-карту)
  const registerInGroup = (gid: number, nFuzzKey: string | null, nCanonKey: string | null, ph: string | null, dob: string | null) => {
    if (!groupFioDobs[gid]) groupFioDobs[gid] = new Map()
    if (nFuzzKey) {
      if (!groupFioDobs[gid].has(nFuzzKey)) groupFioDobs[gid].set(nFuzzKey, new Set())
      if (dob) groupFioDobs[gid].get(nFuzzKey)!.add(dob)
    }
    if (nFuzzKey && !byFuzz.has(nFuzzKey)) byFuzz.set(nFuzzKey, gid)
    if (nCanonKey && !byCanon.has(nCanonKey)) byCanon.set(nCanonKey, gid)
    if (ph && !byPhone.has(ph)) byPhone.set(ph, gid)
  }

  for (let i = cfg.start - 1; i < rows.length; i++) {
    const row = rows[i] || []
    const fio = getFio(row, cfg)
    const phone = cell(row, cfg.phone)
    const dobRaw = cfg.dob >= 0 ? row[cfg.dob] : null
    const dob = normalizeDob(dobRaw)
    const nExact = normalizeName(fio)
    const nFuzz = normalizeFuzzy(nExact)
    const nCanon = canonicalKey(nFuzz)
    const ph = normalizePhone(phone || null)

    if (ph) {
      if (!phoneRows.has(ph)) phoneRows.set(ph, [])
      phoneRows.get(ph)!.push({ excelRow: i + 1, fio, phone, type: "" })
    }
    if (!nFuzz && !ph) continue

    let gid = -1
    let type = ""
    let isNamesakeConflict = false
    let conflictWithGid = -1

    if (nFuzz && byFuzz.has(nFuzz)) {
      const existingGid = byFuzz.get(nFuzz)!
      if (hasDobConflict(existingGid, nFuzz, dob)) {
        // БАГ 1+2 FIX: это тёзка с другой ДР
        // Проверяем, нет ли уже группы для этой тёзки (nFuzz + ":" + dob)
        const namesakeKey = nFuzz + ":" + (dob ?? "__nodob__")
        if (byFuzz.has(namesakeKey)) {
          // уже есть группа для этой конкретной тёзки — просто добавляем туда
          gid = byFuzz.get(namesakeKey)!
          type = "одинаковое ФИО"
        } else {
          // новая тёзка — создаём новую группу
          isNamesakeConflict = true
          conflictWithGid = existingGid
          gid = groups.length
          groups.push([])
          groupFioDobs.push(new Map())
          // регистрируем под составным ключом, чтобы не вытеснить исходный
          byFuzz.set(namesakeKey, gid)
          if (nCanon) {
            const namesakeCanonKey = nCanon + ":" + (dob ?? "__nodob__")
            if (!byCanon.has(namesakeCanonKey)) byCanon.set(namesakeCanonKey, gid)
          }
          type = "одинаковое ФИО"
        }
      } else {
        gid = existingGid
        type = "одинаковое ФИО"
      }
    } else if (nCanon && byCanon.has(nCanon)) {
      const existingGid = byCanon.get(nCanon)!
      if (hasDobConflict(existingGid, nFuzz, dob)) {
        const namesakeKey = nFuzz + ":" + (dob ?? "__nodob__")
        if (byFuzz.has(namesakeKey)) {
          gid = byFuzz.get(namesakeKey)!
          type = "ФИО, другой порядок слов"
        } else {
          isNamesakeConflict = true
          conflictWithGid = existingGid
          gid = groups.length
          groups.push([])
          groupFioDobs.push(new Map())
          if (nFuzz) byFuzz.set(namesakeKey, gid)
          const namesakeCanonKey = nCanon + ":" + (dob ?? "__nodob__")
          if (!byCanon.has(namesakeCanonKey)) byCanon.set(namesakeCanonKey, gid)
          type = "ФИО, другой порядок слов"
        }
      } else {
        gid = existingGid
        type = "ФИО, другой порядок слов"
      }
    } else if (ph && byPhone.has(ph)) {
      gid = byPhone.get(ph)!
      type = "совпал телефон"
    } else if (nFuzz) {
      const res = matchRecord(idx, fio, null, dobRaw, th)
      if (res.status === "disputed" && res.matchedName && byFuzz.has(res.matchedName)) {
        const existingGid = byFuzz.get(res.matchedName)!
        const namesakeKey = nFuzz + ":" + (dob ?? "__nodob__")
        if (byFuzz.has(namesakeKey)) {
          gid = byFuzz.get(namesakeKey)!
          type = DUP_NAMESAKE_TYPE
        } else {
          isNamesakeConflict = true
          conflictWithGid = existingGid
          gid = groups.length
          groups.push([])
          groupFioDobs.push(new Map())
          byFuzz.set(namesakeKey, gid)
          type = DUP_NAMESAKE_TYPE
        }
      } else if (res.status === "typo" && res.matchedName && byFuzz.has(res.matchedName)) {
        gid = byFuzz.get(res.matchedName)!
        type = "ФИО с опечаткой"
      }
    }

    if (gid < 0) {
      gid = groups.length
      groups.push([])
      groupFioDobs.push(new Map())
      type = ""
    }

    const member: DupMember = { excelRow: i + 1, fio, phone, type: type || "первое упоминание" }
    groups[gid].push(member)
    registerInGroup(gid, nFuzz, nCanon, ph, dob)

    // БАГ 2 FIX: после добавления тёзки в новую группу — фиксируем пару конфликта
    if (isNamesakeConflict && conflictWithGid >= 0) {
      const representative = groupRepresentative(conflictWithGid, nFuzz)
      if (representative) {
        disputedPairs.push([{ ...representative, type: DUP_NAMESAKE_TYPE }, { ...member, type: DUP_NAMESAKE_TYPE }])
      }
    }

    addToIndex(idx, fio, null, dobRaw)

    if (i % 300 === 0) {
      post({ kind: "progress", pct: Math.round((95 * (i - cfg.start + 1)) / totalRows), text: `Ищу дубли… ${(i - cfg.start + 1).toLocaleString("ru-RU")} из ${totalRows.toLocaleString("ru-RU")}` })
    }
  }

  post({ kind: "progress", pct: 100, text: "Поиск завершён" })

  const phoneGroups = [...phoneRows.entries()]
    .filter(([, members]) => members.length > 1)
    .sort(([phoneA], [phoneB]) => phoneA.localeCompare(phoneB))
    .map(([, members]) =>
      members
        .slice()
        .sort((a, b) => a.excelRow - b.excelRow)
        .map((member, index) => ({ ...member, type: index === 0 ? "первое упоминание" : "повтор телефона" })),
    )

  post({ kind: "dupes-done", groups: groups.filter((g) => g.length > 1), disputed: disputedPairs, phoneGroups, total })
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

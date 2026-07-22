/* Ядро сверки: нормализация, нечёткое сходство, индекс базы, каскад проверок.
   Портировано из проверенной HTML-версии + добавлены дата рождения,
   пресеты строгости и блокировка по первой букве фамилии для скорости. */

export type MatchStatus =
  | "exact"
  | "typo"
  | "namechange"
  | "phone"
  | "disputed"
  | "notfound"
  | "empty"

export interface MatchResult {
  status: MatchStatus
  matchedName?: string
  matchedDob?: string | null
  sim?: number
  reason?: string
}

export interface Thresholds {
  word: number
  phoneFuzzy: number
  surname: number
  nameOnly: number
  nameChangeFnp: number
}

export type Strictness = "strict" | "normal" | "soft"

export const THRESHOLD_PRESETS: Record<Strictness, Thresholds> = {
  strict: { word: 0.8, phoneFuzzy: 0.86, surname: 0.86, nameOnly: 0.94, nameChangeFnp: 0.97 },
  normal: { word: 0.75, phoneFuzzy: 0.8, surname: 0.82, nameOnly: 0.9, nameChangeFnp: 0.95 },
  soft: { word: 0.7, phoneFuzzy: 0.72, surname: 0.78, nameOnly: 0.85, nameChangeFnp: 0.92 },
}

/* ================= Нормализация ================= */

function normStr(v: unknown): string {
  if (v === null || v === undefined) return ""
  return String(v).trim()
}

export function normalizePhone(v: unknown): string | null {
  let s = normStr(v)
  if (!s || s.toLowerCase() === "nan") return null
  // научная нотация вида 8.9123456789e+10 (артефакт Excel)
  if (/^[\d.,]+e\+?\d+$/i.test(s)) {
    const num = Number(s.replace(",", "."))
    if (isFinite(num)) s = num.toFixed(0)
  }
  let d = s.replace(/\D/g, "")
  if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1)
  else if (d.length === 10) d = "7" + d
  return d.length === 11 ? d : null
}

export function normalizeName(v: unknown): string | null {
  const s = normStr(v)
  if (!s || s.toLowerCase() === "nan") return null
  return s.toLowerCase().replace(/\s+/g, " ").trim() || null
}

export function normalizeFuzzy(name: string | null): string | null {
  if (!name) return null
  let n = name.replace(/ё/g, "е")
  n = n.replace(/[-\s]+$/, "")
  n = n.replace(/\s+/g, " ").trim()
  return n || null
}

export function canonicalKey(name: string | null): string | null {
  if (!name) return null
  return name.split(" ").sort().join(" ")
}

/* Дата рождения -> "гггг-мм-дд" или null */
export function normalizeDob(v: unknown): string | null {
  // Настоящие date-ячейки Excel при чтении с cellDates: true приходят как Date.
  // SheetJS создаёт их в локальном часовом поясе, поэтому используем local getters:
  // UTC-геттеры в часовых поясах восточнее UTC могут вернуть предыдущий день.
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear()
    const mo = v.getMonth() + 1
    const d = v.getDate()
    if (y > 1900 && y < 2100) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    }
    return null
  }

  // Числовая date-ячейка без date-типа — серийный номер Excel.
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000)
    const y = date.getUTCFullYear()
    const mo = date.getUTCMonth() + 1
    const d = date.getUTCDate()
    if (y > 1900 && y < 2100) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    }
    return null
  }

  const s = normStr(v)
  if (!s || s.toLowerCase() === "nan") return null
  // дд.мм.гггг / дд/мм/гг / дд-мм-гггг
  let m = /^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/.exec(s)
  if (m) {
    let [, d, mo, y] = m
    if (y.length === 2) y = (+y > 30 ? "19" : "20") + y
    const dd = +d, mm = +mo, yy = +y
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yy > 1900 && yy < 2100) {
      return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
    }
    return null
  }
  // гггг-мм-дд
  m = /^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/.exec(s)
  if (m) {
    const [, y, mo, d] = m
    const dd = +d, mm = +mo, yy = +y
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yy > 1900 && yy < 2100) {
      return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
    }
  }
  return null
}

/* ================= Нечёткое сходство (аналог difflib.SequenceMatcher) ================= */

function lcsBlock(a: string, alo: number, ahi: number, b: string, blo: number, bhi: number): [number, number, number] {
  let besti = alo, bestj = blo, bestsize = 0
  let j2len = new Map<number, number>()
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>()
    const ch = a[i]
    for (let j = blo; j < bhi; j++) {
      if (b[j] === ch) {
        const k = (j2len.get(j - 1) || 0) + 1
        newj2len.set(j, k)
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k }
      }
    }
    j2len = newj2len
  }
  return [besti, bestj, bestsize]
}

function matchedCount(a: string, alo: number, ahi: number, b: string, blo: number, bhi: number): number {
  if (alo >= ahi || blo >= bhi) return 0
  const [i, j, k] = lcsBlock(a, alo, ahi, b, blo, bhi)
  if (k === 0) return 0
  return k + matchedCount(a, alo, i, b, blo, j) + matchedCount(a, i + k, ahi, b, j + k, bhi)
}

export function simRatio(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  return (2 * matchedCount(a, 0, a.length, b, 0, b.length)) / (a.length + b.length)
}

function sortedWords(s: string): string {
  return s.split(" ").sort().join(" ")
}

export function fuzzySim(a: string, b: string): number {
  if (!a || !b) return 0
  return Math.max(simRatio(a, b), simRatio(sortedWords(a), sortedWords(b)))
}

function surnameSim(a: string, b: string): number {
  if (!a || !b) return 0
  return simRatio(a.split(" ")[0] || "", b.split(" ")[0] || "")
}

function namePatronymicSim(a: string, b: string): number {
  if (!a || !b) return 0
  const ra = a.split(" ").slice(1).join(" ")
  const rb = b.split(" ").slice(1).join(" ")
  if (!ra || !rb) return 0
  return simRatio(ra, rb)
}

/* Если какое-то слово ФИО совпадает слабо — это другой человек, а не опечатка */
function wordsAlignedOk(a: string, b: string, wordThresh: number): boolean {
  const wa = a.split(" ").filter(Boolean)
  const wb = b.split(" ").filter(Boolean)
  if (wa.length !== wb.length) return true
  let ok = true
  for (let i = 0; i < wa.length; i++) {
    if (simRatio(wa[i], wb[i]) < wordThresh) { ok = false; break }
  }
  if (ok) return true
  const sa = wa.slice().sort()
  const sb = wb.slice().sort()
  for (let i = 0; i < sa.length; i++) {
    if (simRatio(sa[i], sb[i]) < wordThresh) return false
  }
  return true
}

function charCounts(s: string): Record<string, number> {
  const cnt: Record<string, number> = Object.create(null)
  for (const ch of s) cnt[ch] = (cnt[ch] || 0) + 1
  return cnt
}

/* ================= Индекс базы ================= */

interface FuzzyMeta {
  name: string
  len: number
  cnt: Record<string, number>
  dobs: string[]
}

export interface MatchIndex {
  exact: Set<string>
  fuzzy: Set<string>
  canon: Set<string>
  phones: Set<string>
  phoneToNames: Map<string, { name: string; dob: string | null }[]>
  nameToDobs: Map<string, string[]>
  /* блокировка: первая буква фамилии -> список метаданных (ускоряет нечёткий поиск) */
  blocks: Map<string, FuzzyMeta[]>
  count: number
}

export function makeIndex(): MatchIndex {
  return {
    exact: new Set(),
    fuzzy: new Set(),
    canon: new Set(),
    phones: new Set(),
    phoneToNames: new Map(),
    nameToDobs: new Map(),
    blocks: new Map(),
    count: 0,
  }
}

export function addToIndex(idx: MatchIndex, rawFio: unknown, rawPhone: unknown, rawDob?: unknown): void {
  const nExact = normalizeName(rawFio)
  const nFuzz = normalizeFuzzy(nExact)
  const nCanon = canonicalKey(nFuzz)
  const phone = normalizePhone(rawPhone)
  const dob = normalizeDob(rawDob)

  if (nExact) idx.exact.add(nExact)
  if (nFuzz) {
    if (!idx.fuzzy.has(nFuzz)) {
      idx.fuzzy.add(nFuzz)
      const meta: FuzzyMeta = { name: nFuzz, len: nFuzz.length, cnt: charCounts(nFuzz), dobs: [] }
      const key = nFuzz[0] || "#"
      if (!idx.blocks.has(key)) idx.blocks.set(key, [])
      idx.blocks.get(key)!.push(meta)
    }
    if (dob) {
      if (!idx.nameToDobs.has(nFuzz)) idx.nameToDobs.set(nFuzz, [])
      const list = idx.nameToDobs.get(nFuzz)!
      if (!list.includes(dob)) list.push(dob)
    }
  }
  if (nCanon) idx.canon.add(nCanon)
  if (phone) {
    idx.phones.add(phone)
    if (nFuzz) {
      if (!idx.phoneToNames.has(phone)) idx.phoneToNames.set(phone, [])
      idx.phoneToNames.get(phone)!.push({ name: nFuzz, dob })
    }
  }
  if (nExact || phone) idx.count++
}

/* ================= Каскад сверки ================= */

export function matchRecord(
  idx: MatchIndex,
  rawFio: unknown,
  rawPhone: unknown,
  rawDob: unknown,
  th: Thresholds,
  opts?: { nameOnlyScan?: boolean },
): MatchResult {
  const nExact = normalizeName(rawFio)
  const nFuzz = normalizeFuzzy(nExact)
  const nCanon = canonicalKey(nFuzz)
  const phone = normalizePhone(rawPhone)
  const dob = normalizeDob(rawDob)

  if (!nExact && !phone) return { status: "empty" }

  /* 1. Точное совпадение ФИО (с учётом ё/е и порядка слов) */
  const exactHit =
    (nExact && idx.exact.has(nExact)) ||
    (nFuzz && idx.fuzzy.has(nFuzz)) ||
    (nCanon && idx.canon.has(nCanon))
  if (exactHit) {
    // проверка тёзок по дате рождения
    if (dob && nFuzz) {
      const dbDobs = idx.nameToDobs.get(nFuzz)
      if (dbDobs && dbDobs.length && !dbDobs.includes(dob)) {
        return {
          status: "disputed",
          matchedName: nFuzz,
          matchedDob: dbDobs[0],
          sim: 1,
          reason: "ФИО совпало, но дата рождения другая — возможен тёзка",
        }
      }
    }
    return { status: "exact" }
  }

  /* 2. Совпадение по телефону */
  if (phone && idx.phones.has(phone)) {
    const cands = idx.phoneToNames.get(phone) || []
    if (!nFuzz) return { status: "phone" }
    let bestSim = 0
    let bestCand = cands[0] || null
    for (const cand of cands) {
      const overall = fuzzySim(nFuzz, cand.name)
      if (overall > bestSim) { bestSim = overall; bestCand = cand }
      // дата рождения совпала — подтверждение личности
      if (dob && cand.dob && cand.dob === dob) {
        return {
          status: "typo",
          matchedName: cand.name,
          matchedDob: cand.dob,
          sim: overall,
          reason: "подтверждено датой рождения",
        }
      }
      if (overall >= th.phoneFuzzy && surnameSim(nFuzz, cand.name) >= th.surname) {
        return { status: "typo", matchedName: cand.name, matchedDob: cand.dob, sim: overall }
      }
      if (namePatronymicSim(nFuzz, cand.name) >= th.nameChangeFnp) {
        return { status: "namechange", matchedName: cand.name, matchedDob: cand.dob, sim: overall }
      }
    }
    return {
      status: "disputed",
      matchedName: bestCand?.name || "",
      matchedDob: bestCand?.dob ?? null,
      sim: bestSim,
      reason: "телефон совпал, но ФИО сильно отличается",
    }
  }

  /* 3. Нечёткий поиск только по ФИО (блокировка по первой букве фамилии) */
  if (nFuzz && opts?.nameOnlyScan !== false) {
    const la = nFuzz.length
    const qCnt = charCounts(nFuzz)
    const block = idx.blocks.get(nFuzz[0] || "#") || []
    for (const meta of block) {
      const lb = meta.len
      if ((2 * Math.min(la, lb)) / (la + lb) < th.nameOnly) continue
      let mm = 0
      for (const ch in meta.cnt) {
        const q = qCnt[ch]
        if (q) mm += q < meta.cnt[ch] ? q : meta.cnt[ch]
      }
      if ((2 * mm) / (la + lb) < th.nameOnly) continue
      const overall = fuzzySim(nFuzz, meta.name)
      if (overall >= th.nameOnly && surnameSim(nFuzz, meta.name) >= th.surname && wordsAlignedOk(nFuzz, meta.name, th.word)) {
        const dbDobs = idx.nameToDobs.get(meta.name)
        if (dob && dbDobs && dbDobs.length && !dbDobs.includes(dob)) {
          return {
            status: "disputed",
            matchedName: meta.name,
            matchedDob: dbDobs[0],
            sim: overall,
            reason: "ФИО похоже, но дата рождения другая",
          }
        }
        return { status: "typo", matchedName: meta.name, matchedDob: dbDobs?.[0] ?? null, sim: overall }
      }
    }
  }

  return { status: "notfound" }
}

/* ================= Статусы ================= */

export const STATUS_LABEL: Record<MatchStatus, string> = {
  exact: "найден",
  typo: "найден (опечатка)",
  namechange: "найден (смена фамилии?)",
  phone: "телефон совпал",
  disputed: "спорный",
  notfound: "не найден",
  empty: "",
}

export const MATCHED_STATUSES = new Set<MatchStatus>(["exact", "typo", "namechange", "phone"])

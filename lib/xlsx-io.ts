/* Чтение Excel-файлов, автоопределение столбцов и сборка итоговых файлов.
   Всё выполняется локально в браузере — данные никуда не отправляются. */

import * as XLSX from "xlsx-js-style"
import { STATUS_LABEL, MATCHED_STATUSES, type MatchStatus } from "@/lib/matching"
import type { ColumnConfig, RowResult, DupMember } from "@/workers/match.worker"

export interface LoadedFile {
  name: string
  buf: ArrayBuffer
  sheetNames: string[]
  sheet: string
  rows: string[][]
  cfg: ColumnConfig
}

export function colLetter(i: number): string {
  let s = ""
  let n = i
  for (;;) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
    if (n < 0) break
  }
  return s
}

export function sheetRows(wb: XLSX.WorkBook, sheetName: string): string[][] {
  const ws = wb.Sheets[sheetName]
  if (!ws || !ws["!ref"]) return []
  const range = XLSX.utils.decode_range(ws["!ref"] as string)
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", blankrows: true }) as string[][]
  const colPad = new Array(range.s.c).fill("")
  const rows: string[][] = []
  for (let i = 0; i < range.s.r; i++) rows.push([])
  for (const r of raw) rows.push(colPad.concat(r))
  return rows
}

export function guessColumns(rows: string[][]): ColumnConfig {
  const g = { headerRow: -1, fio: -1, fam: -1, im: -1, ot: -1, phone: -1, dob: -1 }
  let bestHits = 0
  const lim = Math.min(rows.length, 10)
  for (let r = 0; r < lim; r++) {
    const row = rows[r] || []
    const cur = { fio: -1, fam: -1, im: -1, ot: -1, phone: -1, dob: -1 }
    let hits = 0
    for (let c = 0; c < row.length; c++) {
      const v = String(row[c] || "").toLowerCase().trim()
      if (!v) continue
      if (cur.fio < 0 && (v.includes("фио") || v.includes("ф.и.о") || (v.includes("фамилия") && v.includes("имя")))) { cur.fio = c; hits++; continue }
      if (cur.fam < 0 && v.startsWith("фамил")) { cur.fam = c; hits++; continue }
      if (cur.im < 0 && (v === "имя" || v.startsWith("имя"))) { cur.im = c; hits++; continue }
      if (cur.ot < 0 && v.startsWith("отчеств")) { cur.ot = c; hits++; continue }
      if (cur.phone < 0 && (v.includes("телефон") || v.includes("тел.") || v === "тел" || v.includes("номер тел"))) { cur.phone = c; hits++; continue }
      if (cur.dob < 0 && (v.includes("дата рожд") || v.includes("рождения") || v === "д.р." || v === "др" || v.includes("birth"))) { cur.dob = c; hits++; continue }
    }
    if (hits > bestHits) { bestHits = hits; g.headerRow = r; Object.assign(g, cur) }
  }
  return {
    start: g.headerRow >= 0 ? g.headerRow + 2 : 2,
    fioMode: g.fio < 0 && g.fam >= 0 && g.im >= 0 ? "three" : "single",
    fio: g.fio,
    fam: g.fam,
    im: g.im,
    ot: g.ot,
    phone: g.phone,
    dob: g.dob,
  }
}

export async function loadExcelFile(file: File): Promise<LoadedFile> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: "array" })
  const sheet = wb.SheetNames[0]
  const rows = sheetRows(wb, sheet)
  return { name: file.name, buf, sheetNames: wb.SheetNames, sheet, rows, cfg: guessColumns(rows) }
}

export function switchSheet(f: LoadedFile, sheet: string): LoadedFile {
  const wb = XLSX.read(f.buf, { type: "array" })
  const rows = sheetRows(wb, sheet)
  return { ...f, sheet, rows, cfg: guessColumns(rows) }
}

/* ================= Сборка результатов ================= */

function colWidths(aoa: unknown[][]) {
  const cols: { wch: number }[] = []
  const nCols = Math.max(...aoa.map((r) => r.length), 1)
  const lim = Math.min(aoa.length, 300)
  for (let c = 0; c < nCols; c++) {
    let w = 8
    for (let r = 0; r < lim; r++) w = Math.max(w, String((aoa[r] || [])[c] ?? "").length)
    cols.push({ wch: Math.min(w + 2, 45) })
  }
  return cols
}

function toBlob(wb: XLSX.WorkBook): Blob {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" })
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
}

export function statusLabelFor(r: RowResult): string {
  if (r.res.status === "disputed") return `спорный: ${r.res.reason || "требует проверки"}`
  if (r.res.status === "typo" && r.res.reason) return `найден (${r.res.reason})`
  return STATUS_LABEL[r.res.status]
}

/* Покраска: новый чистый файл с данными и цветовой заливкой */
export function buildColored(
  rows: string[][],
  cfg: ColumnConfig,
  results: RowResult[],
  matchColor: string,
  opts: { addLabel: boolean; paintRed: boolean },
): Blob {
  const maxCols = Math.min(Math.max(...rows.map((r) => r.length), 1), 60)
  const aoa: (string | number)[][] = []
  for (let r = 0; r < rows.length; r++) {
    const src = rows[r] || []
    const vals: (string | number)[] = []
    for (let c = 0; c < maxCols; c++) vals.push(src[c] ?? "")
    if (opts.addLabel) vals.push("")
    aoa.push(vals)
  }
  if (opts.addLabel) {
    const headerIdx = Math.max(cfg.start - 2, 0)
    aoa[headerIdx][maxCols] = "Результат сверки"
    for (const r of results) {
      if (aoa[r.excelRow - 1]) aoa[r.excelRow - 1][maxCols] = statusLabelFor(r)
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const mkFill = (rgb: string) => ({ fill: { patternType: "solid", fgColor: { rgb } } })
  const matchS = mkFill(matchColor)
  const redS = mkFill("FF0000")
  const orangeS = mkFill("FFD966")
  const lastC = opts.addLabel ? maxCols : maxCols - 1
  for (const { excelRow, res } of results) {
    let s: object | null = null
    if (MATCHED_STATUSES.has(res.status)) s = matchS
    else if (res.status === "disputed") s = orangeS
    else if (res.status === "notfound" && opts.paintRed) s = redS
    if (!s) continue
    for (let c = 0; c <= lastC; c++) {
      const addr = XLSX.utils.encode_cell({ r: excelRow - 1, c })
      if (!ws[addr]) ws[addr] = { t: "s", v: "" }
      ;(ws[addr] as { s?: object }).s = s
    }
  }
  ws["!cols"] = colWidths(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Результат")
  return toBlob(wb)
}

/* Выгрузка отдельным файлом с листами «Найдены» / «Не найдены» / «Спорные» */
export function buildExport(
  rows: string[][],
  cfg: ColumnConfig,
  results: RowResult[],
  what: "found" | "notfound" | "both",
): Blob {
  const headerIdx = cfg.start - 2
  const srcHeader = headerIdx >= 0 ? rows[headerIdx] || [] : []
  const maxCols = Math.min(Math.max(...rows.map((r) => r.length), 1), 60)
  const headers: string[] = []
  for (let c = 0; c < maxCols; c++) {
    const v = String(srcHeader[c] || "").trim()
    headers.push(v || colLetter(c))
  }
  headers.push("Результат сверки")
  const wb = XLSX.utils.book_new()
  const addSheet = (title: string, rowsList: RowResult[]) => {
    const aoa: (string | number)[][] = [headers]
    for (const r of rowsList) {
      const src = rows[r.excelRow - 1] || []
      const vals: (string | number)[] = []
      for (let c = 0; c < maxCols; c++) vals.push(src[c] ?? "")
      vals.push(statusLabelFor(r))
      aoa.push(vals)
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    for (let c = 0; c < headers.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (ws[addr]) (ws[addr] as { s?: object }).s = { font: { bold: true } }
    }
    ws["!cols"] = colWidths(aoa)
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 1), c: headers.length - 1 } }) }
    XLSX.utils.book_append_sheet(wb, ws, title)
  }
  const found = results.filter((r) => MATCHED_STATUSES.has(r.res.status))
  const notfound = results.filter((r) => r.res.status === "notfound")
  const disputed = results.filter((r) => r.res.status === "disputed")
  if (what === "found" || what === "both") addSheet("Найдены", found)
  if (what === "notfound" || what === "both") addSheet("Не найдены", notfound)
  if (disputed.length) addSheet("Спорные", disputed)
  if (!wb.SheetNames.length) addSheet("Пусто", [])
  return toBlob(wb)
}

/* Отчёт по дублям */
export function buildDupesFile(groups: DupMember[][]): Blob {
  const headers = ["Группа", "Строка в файле", "ФИО", "Телефон", "Совпадение"]
  const aoa: (string | number)[][] = [headers]
  const shade: boolean[] = []
  const groupStart: boolean[] = []
  let g = 1
  for (const grp of groups) {
    let first = true
    for (const m of grp) {
      aoa.push([g, m.excelRow, m.fio || "", m.phone || "", m.type])
      shade.push(g % 2 === 0)
      groupStart.push(first)
      first = false
    }
    g++
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  for (let c = 0; c < headers.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c })
    if (ws[addr]) (ws[addr] as { s?: object }).s = { font: { bold: true } }
  }
  const grayFill = { patternType: "solid", fgColor: { rgb: "F2F2F2" } }
  const groupBorder = { top: { style: "medium", color: { rgb: "666666" } } }
  for (let r = 0; r < shade.length; r++) {
    if (!shade[r] && !groupStart[r]) continue
    for (let c = 0; c < headers.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: r + 1, c })
      if (!ws[addr]) ws[addr] = { t: "s", v: "" }
      const s: { fill?: object; border?: object } = {}
      if (shade[r]) s.fill = grayFill
      if (groupStart[r]) s.border = groupBorder
      ;(ws[addr] as { s?: object }).s = s
    }
  }
  ws["!cols"] = colWidths(aoa)
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 1), c: headers.length - 1 } }) }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Дубли")
  return toBlob(wb)
}

/* Копия листа без удалённых строк с сохранением стилей исходника */
function buildStyledCleanSheet(buf: ArrayBuffer, sheetName: string, del: Set<number>): XLSX.WorkSheet | null {
  const wb2 = XLSX.read(buf, { type: "array", cellStyles: true, cellNF: true } as XLSX.ParsingOptions)
  const ws = wb2.Sheets[sheetName]
  if (!ws || !ws["!ref"]) return null
  const range = XLSX.utils.decode_range(ws["!ref"] as string)
  const map = new Array(range.e.r + 1).fill(-1)
  let nr = 0
  for (let r = 0; r <= range.e.r; r++) {
    if (del.has(r + 1)) continue
    map[r] = nr++
  }
  if (!nr) return null
  const out: XLSX.WorkSheet = {}
  for (const key in ws) {
    if (key[0] === "!") continue
    const cc = XLSX.utils.decode_cell(key)
    const newR = map[cc.r]
    if (newR == null || newR < 0) continue
    out[XLSX.utils.encode_cell({ r: newR, c: cc.c })] = ws[key]
  }
  out["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: range.s.c }, e: { r: nr - 1, c: range.e.c } })
  if (ws["!cols"]) out["!cols"] = ws["!cols"]
  if (ws["!merges"]) {
    const merges: XLSX.Range[] = []
    for (const m of ws["!merges"] as XLSX.Range[]) {
      let firstKept = -1
      let keptCount = 0
      for (let r = m.s.r; r <= m.e.r; r++) {
        if (r < map.length && map[r] >= 0) {
          if (firstKept < 0) firstKept = map[r]
          keptCount++
        }
      }
      if (firstKept < 0) continue
      if (keptCount === 1 && m.s.c === m.e.c) continue
      merges.push({ s: { r: firstKept, c: m.s.c }, e: { r: firstKept + keptCount - 1, c: m.e.c } })
    }
    if (merges.length) out["!merges"] = merges
  }
  return out
}

/* Файл без дублей: из каждой группы остаётся первое упоминание */
export function buildCleanFile(
  f: LoadedFile,
  groups: DupMember[][],
  opts: { withLog: boolean; delPhone: boolean },
): { blob: Blob; removedCount: number } | null {
  const del = new Map<number, { g: number; type: string }>()
  let g = 1
  for (const grp of groups) {
    for (let i = 1; i < grp.length; i++) {
      const m = grp[i]
      if (!opts.delPhone && m.type === "совпал телефон") continue // разные люди с общим телефоном — не трогаем
      del.set(m.excelRow, { g, type: m.type })
    }
    g++
  }
  if (!del.size) return null

  const delSet = new Set(del.keys())
  const wb = XLSX.utils.book_new()
  let ws: XLSX.WorkSheet | null = null
  try {
    ws = buildStyledCleanSheet(f.buf, f.sheet, delSet)
  } catch {
    ws = null
  }
  if (!ws) {
    const keptAoa: string[][] = []
    for (let i = 0; i < f.rows.length; i++) {
      if (!delSet.has(i + 1)) keptAoa.push(f.rows[i] || [])
    }
    ws = XLSX.utils.aoa_to_sheet(keptAoa.length ? keptAoa : [[""]])
    ws["!cols"] = colWidths(keptAoa.length ? keptAoa : [[""]])
  }
  XLSX.utils.book_append_sheet(wb, ws, "Без дублей")

  if (opts.withLog) {
    let headerRow = f.cfg.start >= 2 ? f.rows[f.cfg.start - 2] || [] : []
    if (!headerRow.some((v) => String(v ?? "").trim())) {
      const nCols = Math.max(...[...del.keys()].map((r) => (f.rows[r - 1] || []).length), 1)
      headerRow = Array.from({ length: nCols }, (_, c) => "Колонка " + (c + 1))
    }
    const remAoa: (string | number)[][] = [["Строка в файле", "Группа", "Совпадение", ...headerRow]]
    for (const [excelRow, info] of [...del.entries()].sort((a, b) => a[0] - b[0])) {
      remAoa.push([excelRow, info.g, info.type, ...(f.rows[excelRow - 1] || [])])
    }
    const ws2 = XLSX.utils.aoa_to_sheet(remAoa)
    for (let c = 0; c < remAoa[0].length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (ws2[addr]) (ws2[addr] as { s?: object }).s = { font: { bold: true } }
    }
    ws2["!cols"] = colWidths(remAoa)
    XLSX.utils.book_append_sheet(wb, ws2, "Удалённые")
  }
  return { blob: toBlob(wb), removedCount: del.size }
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

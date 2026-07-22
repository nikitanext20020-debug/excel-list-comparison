/* Чтение Excel-файлов, автоопределение столбцов и сборка итоговых файлов.
   Всё выполняется локально в браузере — данные никуда не отправляются. */

import * as XLSX from "xlsx-js-style"
import { STATUS_LABEL, MATCHED_STATUSES, normalizePhone, type MatchStatus } from "@/lib/matching"
import type { ColumnConfig, RowResult, DupMember } from "@/workers/match.worker"
import { DUP_MANUAL_NAMESAKE_TYPE, filterAutoDuplicateMembers, isDisputedNamesake } from "@/lib/dupes"

export interface LoadedFile {
  name: string
  buf: ArrayBuffer
  sheetNames: string[]
  sheet: string
  rows: string[][]
  rawRows: unknown[][]
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

/** Исходные значения ячеек для точной обработки дат в режиме поиска дублей. */
export function sheetRawRows(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName]
  if (!ws || !ws["!ref"]) return []
  const range = XLSX.utils.decode_range(ws["!ref"] as string)
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: true }) as unknown[][]
  const colPad = new Array(range.s.c).fill("")
  const rows: unknown[][] = []
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
  const wb = XLSX.read(buf, { type: "array", cellDates: true })
  const sheet = wb.SheetNames[0]
  const rows = sheetRows(wb, sheet)
  const rawRows = sheetRawRows(wb, sheet)
  return { name: file.name, buf, sheetNames: wb.SheetNames, sheet, rows, rawRows, cfg: guessColumns(rows) }
}

export function switchSheet(f: LoadedFile, sheet: string): LoadedFile {
  const wb = XLSX.read(f.buf, { type: "array", cellDates: true })
  const rows = sheetRows(wb, sheet)
  const rawRows = sheetRawRows(wb, sheet)
  return { ...f, sheet, rows, rawRows, cfg: guessColumns(rows) }
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
export function buildDupesFile(
  groups: DupMember[][],
  disputed: DupMember[][] = [],
  manualSamePairs: DupMember[][] = [],
): Blob {
  const headers = ["Группа", "Строка в файле", "ФИО", "Телефон", "Совпадение"]
  const aoa: (string | number)[][] = [headers]
  const shade: boolean[] = []
  const groupStart: boolean[] = []
  const disputedRows = [
    ...disputed.flat(),
    ...groups.flatMap((grp) => grp.filter((member) => isDisputedNamesake(member.type))),
  ]
  let g = 1
  for (const grp of groups) {
    const autoMembers = filterAutoDuplicateMembers(grp)
    let first = true
    for (const m of autoMembers) {
      aoa.push([g, m.excelRow, m.fio || "", m.phone || "", m.type])
      shade.push(g % 2 === 0)
      groupStart.push(first)
      first = false
    }
    g++
  }
  for (const pair of manualSamePairs) {
    if (!pair[0] || !pair[1]) continue
    const manualGroup = [
      { ...pair[0], type: "первое упоминание" },
      { ...pair[1], type: DUP_MANUAL_NAMESAKE_TYPE },
    ]
    let first = true
    for (const m of manualGroup) {
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
  if (disputedRows.length) {
    const disputedAoa: (string | number)[][] = [["Строка в файле", "ФИО", "Телефон", "Совпадение"]]
    for (const m of disputedRows) disputedAoa.push([m.excelRow, m.fio || "", m.phone || "", m.type])
    const disputedWs = XLSX.utils.aoa_to_sheet(disputedAoa)
    for (let c = 0; c < disputedAoa[0].length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (disputedWs[addr]) (disputedWs[addr] as { s?: object }).s = { font: { bold: true } }
    }
    disputedWs["!cols"] = colWidths(disputedAoa)
    disputedWs["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(disputedAoa.length - 1, 1), c: disputedAoa[0].length - 1 } }) }
    XLSX.utils.book_append_sheet(wb, disputedWs, "Спорные тёзки")
  }
  return toBlob(wb)
}

function sortedPhoneGroups(phoneGroups: DupMember[][]): DupMember[][] {
  const groups = phoneGroups
    .filter((group) => group.length > 1)
    .map((group) =>
      group.slice().sort((a, b) => {
        const phoneA = normalizePhone(a.phone) || ""
        const phoneB = normalizePhone(b.phone) || ""
        return phoneA.localeCompare(phoneB) || a.excelRow - b.excelRow
      }),
    )
  return groups.sort((a, b) => {
    const phoneA = normalizePhone(a[0]?.phone) || ""
    const phoneB = normalizePhone(b[0]?.phone) || ""
    return phoneA.localeCompare(phoneB) || (a[0]?.excelRow || 0) - (b[0]?.excelRow || 0)
  })
}

/** Отдельный отчёт по всем строкам, у которых совпал нормализованный телефон. */
export function buildPhoneReportFile(rows: string[][], cfg: ColumnConfig, phoneGroups: DupMember[][]): Blob {
  const headerIdx = cfg.start - 2
  const srcHeader = headerIdx >= 0 ? rows[headerIdx] || [] : []
  const maxCols = Math.min(Math.max(...rows.map((r) => r.length), 1), 60)
  const sourceHeaders = Array.from({ length: maxCols }, (_, c) => String(srcHeader[c] || "").trim() || colLetter(c))
  const headers = ["Группа", "Строка в файле", "Телефон", "ФИО", ...sourceHeaders]
  const aoa: (string | number)[][] = [headers]

  for (const [groupIndex, group] of sortedPhoneGroups(phoneGroups).entries()) {
    for (const member of group) {
      const sourceRow = rows[member.excelRow - 1] || []
      aoa.push([
        groupIndex + 1,
        member.excelRow,
        member.phone || "",
        member.fio || "",
        ...Array.from({ length: maxCols }, (_, c) => sourceRow[c] ?? ""),
      ])
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  for (let c = 0; c < headers.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c })
    if (ws[addr]) (ws[addr] as { s?: object }).s = { font: { bold: true } }
  }
  ws["!cols"] = colWidths(aoa)
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 1), c: headers.length - 1 } }) }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Телефоны")
  return toBlob(wb)
}

/* Копия листа без удалённых строк с сохранением стилей исходника */
function buildStyledCleanSheet(buf: ArrayBuffer, sheetName: string, del: Set<number>): XLSX.WorkSheet {
  // П.5: убрать молчаливый фолбэк — читаем с cellStyles, логируем если не работает
  const wb2 = XLSX.read(buf, { type: "array", cellStyles: true, cellNF: true } as XLSX.ParsingOptions)
  const ws = wb2.Sheets[sheetName]
  if (!ws || !ws["!ref"]) {
    throw new Error(`Лист «${sheetName}» не найден или пуст в буфере файла`)
  }

  // Проверяем что стили действительно читаются
  const range = XLSX.utils.decode_range(ws["!ref"] as string)
  let stylesFound = 0
  for (const key in ws) {
    if (key[0] === "!") continue
    const cell = ws[key] as { s?: object }
    if (cell?.s) stylesFound++
    if (stylesFound >= 3) break
  }
  if (stylesFound === 0) {
    console.warn(`[buildStyledCleanSheet] xlsx-js-style не вернул стили для листа «${sheetName}». Форматирование может не сохраниться.`)
  }

  const map = new Array(range.e.r + 1).fill(-1)
  let nr = 0
  for (let r = 0; r <= range.e.r; r++) {
    if (del.has(r + 1)) continue
    map[r] = nr++
  }
  if (!nr) {
    throw new Error("После удаления дублей не осталось ни одной строки")
  }

  const out: XLSX.WorkSheet = {}
  for (const key in ws) {
    if (key[0] === "!") continue
    const cc = XLSX.utils.decode_cell(key)
    const newR = map[cc.r]
    if (newR == null || newR < 0) continue
    out[XLSX.utils.encode_cell({ r: newR, c: cc.c })] = ws[key]
  }
  out["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: range.s.c }, e: { r: nr - 1, c: range.e.c } })
  // ширины столбцов
  if (ws["!cols"]) out["!cols"] = ws["!cols"]
  // высоты строк — пересчитываем индексы
  if (ws["!rows"]) {
    const srcRows = ws["!rows"] as unknown[]
    const dstRows: unknown[] = new Array(nr)
    for (let r = 0; r < map.length; r++) {
      if (map[r] >= 0 && srcRows[r] !== undefined) dstRows[map[r]] = srcRows[r]
    }
    out["!rows"] = dstRows as XLSX.RowInfo[]
  }
  // объединённые ячейки
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
  // автофильтр — пересчитываем строку
  if (ws["!autofilter"]) {
    const af = ws["!autofilter"] as { ref: string }
    try {
      const afRange = XLSX.utils.decode_range(af.ref)
      const newStart = map[afRange.s.r]
      const newEnd = map[afRange.e.r] >= 0 ? map[afRange.e.r] : nr - 1
      if (newStart >= 0)
        out["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: newStart, c: afRange.s.c }, e: { r: newEnd, c: afRange.e.c } }) }
    } catch { /* пропустить */ }
  }
  // заморозка панелей
  if ((ws as { "!freeze"?: unknown })["!freeze"]) (out as { "!freeze"?: unknown })["!freeze"] = (ws as { "!freeze"?: unknown })["!freeze"]
  // защита листа
  if ((ws as { "!protect"?: unknown })["!protect"]) (out as { "!protect"?: unknown })["!protect"] = (ws as { "!protect"?: unknown })["!protect"]
  return out
}

/* ===== Вспомогательные стили для листа «Удалённые» ===== */

const STYLE_HEADER = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { patternType: "solid", fgColor: { rgb: "4472C4" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: {
    top: { style: "thin", color: { rgb: "CCCCCC" } },
    bottom: { style: "thin", color: { rgb: "CCCCCC" } },
    left: { style: "thin", color: { rgb: "CCCCCC" } },
    right: { style: "thin", color: { rgb: "CCCCCC" } },
  },
}

const STYLE_KEPT = {
  fill: { patternType: "solid", fgColor: { rgb: "E2EFDA" } },
  border: {
    top: { style: "thin", color: { rgb: "CCCCCC" } },
    bottom: { style: "thin", color: { rgb: "CCCCCC" } },
    left: { style: "thin", color: { rgb: "CCCCCC" } },
    right: { style: "thin", color: { rgb: "CCCCCC" } },
  },
}

const STYLE_DELETED = {
  fill: { patternType: "solid", fgColor: { rgb: "FCE4E4" } },
  border: {
    top: { style: "thin", color: { rgb: "CCCCCC" } },
    bottom: { style: "thin", color: { rgb: "CCCCCC" } },
    left: { style: "thin", color: { rgb: "CCCCCC" } },
    right: { style: "thin", color: { rgb: "CCCCCC" } },
  },
}

const STYLE_ZEBRA = {
  fill: { patternType: "solid", fgColor: { rgb: "F2F2F2" } },
  border: {
    top: { style: "thin", color: { rgb: "CCCCCC" } },
    bottom: { style: "thin", color: { rgb: "CCCCCC" } },
    left: { style: "thin", color: { rgb: "CCCCCC" } },
    right: { style: "thin", color: { rgb: "CCCCCC" } },
  },
}

const STYLE_PLAIN = {
  border: {
    top: { style: "thin", color: { rgb: "CCCCCC" } },
    bottom: { style: "thin", color: { rgb: "CCCCCC" } },
    left: { style: "thin", color: { rgb: "CCCCCC" } },
    right: { style: "thin", color: { rgb: "CCCCCC" } },
  },
}

const STYLE_GROUP_TOP_BORDER = {
  border: {
    top: { style: "medium", color: { rgb: "4472C4" } },
    bottom: { style: "thin", color: { rgb: "CCCCCC" } },
    left: { style: "thin", color: { rgb: "CCCCCC" } },
    right: { style: "thin", color: { rgb: "CCCCCC" } },
  },
}

/**
 * Строит оформленный лист «Удалённые».
 * Строка 1: пояснение (объединённые ячейки, жирный).
 * Строка 3: шапка (синяя, белый жирный).
 * С строки 4: данные. Для каждой группы — «оставлен в списке» (зелёный) + «удалён» (красный).
 * Зебра по группам, синяя рамка сверху первой строки каждой группы.
 */
function buildDeletedSheet(
  rows: string[][],
  cfg: ColumnConfig,
  groupsData: { groupNum: number; kept: number; deleted: number[]; type: string }[],
  explanation: string,
): XLSX.WorkSheet {
  const headerIdx = cfg.start - 2
  let srcHeader = headerIdx >= 0 ? rows[headerIdx] || [] : []
  const maxCols = Math.min(Math.max(...rows.map((r) => r.length), 1), 60)
  if (!srcHeader.some((v) => String(v ?? "").trim())) {
    srcHeader = Array.from({ length: maxCols }, (_, c) => "Колонка " + (c + 1))
  }
  const srcColHeaders = Array.from({ length: maxCols }, (_, c) => String(srcHeader[c] || "").trim() || colLetter(c))

  // Шапка: Группа | Строка в исх. файле | Статус | <исходные колонки> | Признак совпадения
  const headerCols = ["Группа", "Строка в исходном файле", "Статус", ...srcColHeaders, "Признак совпадения"]
  const totalCols = headerCols.length

  // aoa: строка 0 — пояснение, строка 1 — пустая, строка 2 — шапка, с строки 3 — данные
  const aoa: (string | number)[][] = []
  // строка 0 — пояснение
  const explanationRow: (string | number)[] = [explanation]
  for (let c = 1; c < totalCols; c++) explanationRow.push("")
  aoa.push(explanationRow)
  // строка 1 — пустая
  aoa.push(Array(totalCols).fill(""))
  // строка 2 — шапка
  aoa.push(headerCols)

  // данные
  const rowMeta: { isKept: boolean; groupNum: number; isGroupStart: boolean }[] = []

  for (const { groupNum, kept, deleted, type } of groupsData) {
    // первая строка группы — «оставлен в списке»
    const keptRow = rows[kept - 1] || []
    const dataRow: (string | number)[] = [
      groupNum,
      kept,
      "оставлен в списке",
      ...Array.from({ length: maxCols }, (_, c) => keptRow[c] ?? ""),
      type,
    ]
    aoa.push(dataRow)
    rowMeta.push({ isKept: true, groupNum, isGroupStart: true })

    // удалённые строки
    for (const delRow of deleted) {
      const srcRow = rows[delRow - 1] || []
      aoa.push([
        groupNum,
        delRow,
        "удалён",
        ...Array.from({ length: maxCols }, (_, c) => srcRow[c] ?? ""),
        type,
      ])
      rowMeta.push({ isKept: false, groupNum, isGroupStart: false })
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Объединяем ячейки пояснения (строка 0)
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }]

  // Стиль пояснения
  const explanationAddr = XLSX.utils.encode_cell({ r: 0, c: 0 })
  if (!ws[explanationAddr]) ws[explanationAddr] = { t: "s", v: explanation }
  ;(ws[explanationAddr] as { s?: object }).s = { font: { bold: true, sz: 10 }, alignment: { wrapText: true, vertical: "center" } }

  // Стиль шапки (строка 2)
  for (let c = 0; c < totalCols; c++) {
    const addr = XLSX.utils.encode_cell({ r: 2, c })
    if (!ws[addr]) ws[addr] = { t: "s", v: "" }
    ;(ws[addr] as { s?: object }).s = STYLE_HEADER
  }

  // Стиль данных (с строки 3)
  for (let ri = 0; ri < rowMeta.length; ri++) {
    const { isKept, groupNum, isGroupStart } = rowMeta[ri]
    const sheetRow = ri + 3 // 0=пояснение, 1=пустая, 2=шапка, с 3 — данные
    const isEvenGroup = groupNum % 2 === 0

    for (let c = 0; c < totalCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: sheetRow, c })
      if (!ws[addr]) ws[addr] = { t: "s", v: "" }

      let style: object
      if (isKept) {
        style = isGroupStart
          ? { ...STYLE_KEPT, border: { ...STYLE_KEPT.border, top: { style: "medium", color: { rgb: "4472C4" } } } }
          : STYLE_KEPT
      } else if (isGroupStart) {
        style = { ...STYLE_DELETED, border: { ...STYLE_DELETED.border, top: { style: "medium", color: { rgb: "4472C4" } } } }
      } else if (isEvenGroup) {
        style = STYLE_ZEBRA
      } else {
        style = STYLE_PLAIN
      }

      ;(ws[addr] as { s?: object }).s = style
    }
  }

  // Ширины столбцов
  ws["!cols"] = [{ wch: 8 }, { wch: 14 }, { wch: 18 }, ...Array.from({ length: maxCols }, () => ({ wch: 18 })), { wch: 28 }]

  // Автофильтр на шапку + данные
  const dataEnd = 2 + rowMeta.length
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: Math.max(dataEnd, 3), c: totalCols - 1 } }),
  }

  // Закрепление областей — начиная со строки 4 (после шапки)
  ;(ws as { "!freeze"?: unknown })["!freeze"] = { xSplit: 0, ySplit: 3, topLeftCell: "A4", activePane: "bottomLeft" }

  // Высота строки пояснения
  ws["!rows"] = [{ hpt: 32 }] as XLSX.RowInfo[]

  return ws
}

/* Файл без дублей: из каждой группы остаётся первое упоминание */
export function buildCleanFile(
  f: LoadedFile,
  groups: DupMember[][],
  opts: { withLog: boolean; delPhone: boolean; manualSamePairs?: DupMember[][] },
): { blob: Blob; removedCount: number } | null {
  // Строим структуру удаляемых строк + данные для листа «Удалённые»
  const del = new Map<number, { g: number; type: string }>()
  const groupsForLog: { groupNum: number; kept: number; deleted: number[]; type: string }[] = []
  let g = 1
  for (const grp of groups) {
    const autoMembers = filterAutoDuplicateMembers(grp)
    if (autoMembers.length === 0) { g++; continue }
    const keptRow = autoMembers[0].excelRow
    const deletedRows: number[] = []
    let matchType = autoMembers[0].type
    for (let i = 1; i < autoMembers.length; i++) {
      const m = autoMembers[i]
      if (!opts.delPhone && m.type === "совпал телефон") continue
      del.set(m.excelRow, { g, type: m.type })
      deletedRows.push(m.excelRow)
      matchType = m.type
    }
    if (opts.withLog) {
      groupsForLog.push({ groupNum: g, kept: keptRow, deleted: deletedRows, type: matchType })
    }
    g++
  }
  for (const pair of opts.manualSamePairs ?? []) {
    const kept = pair[0]
    const duplicate = pair[1]
    if (!kept || !duplicate) continue
    const alreadyScheduled = del.has(duplicate.excelRow)
    del.set(duplicate.excelRow, { g, type: DUP_MANUAL_NAMESAKE_TYPE })
    if (opts.withLog && !alreadyScheduled) {
      groupsForLog.push({
        groupNum: g,
        kept: kept.excelRow,
        deleted: [duplicate.excelRow],
        type: DUP_MANUAL_NAMESAKE_TYPE,
      })
    }
    g++
  }
  if (!del.size) return null

  const delSet = new Set(del.keys())
  const wb = XLSX.utils.book_new()

  // П.5: убрать молчаливый фолбэк — логируем ошибку, не подменяем голым листом
  let ws: XLSX.WorkSheet
  try {
    ws = buildStyledCleanSheet(f.buf, f.sheet, delSet)
  } catch (err) {
    console.error("[buildCleanFile] Не удалось сохранить стили исходного листа:", err)
    // Фолбэк только если стили совсем не читаются — сообщаем пользователю через throw
    throw new Error(
      "Не удалось сохранить форматирование исходного файла: " +
      (err instanceof Error ? err.message : String(err)) +
      ". Пересохраните файл как обычный .xlsx и попробуйте снова."
    )
  }

  XLSX.utils.book_append_sheet(wb, ws, f.sheet || "Без дублей")

  if (opts.withLog && groupsForLog.length > 0) {
    const ws2 = buildDeletedSheet(
      f.rows,
      f.cfg,
      groupsForLog,
      "Строки указаны по исходному файлу (до удаления). В основном списке оставлена первая строка группы, остальные удалены.",
    )
    XLSX.utils.book_append_sheet(wb, ws2, "Удалённые")
  }

  return { blob: toBlob(wb), removedCount: del.size }
}

/** Копия листа без повторов телефонов: из каждой телефонной группы остаётся первая строка. */
export function buildPhoneCleanFile(
  f: LoadedFile,
  phoneGroups: DupMember[][],
  opts: { withLog: boolean },
): { blob: Blob; removedCount: number } | null {
  const del = new Map<number, { g: number; type: string }>()
  const groupsForLog: { groupNum: number; kept: number; deleted: number[]; type: string }[] = []
  for (const [groupIndex, group] of sortedPhoneGroups(phoneGroups).entries()) {
    const groupNum = groupIndex + 1
    const keptRow = group[0].excelRow
    const deletedRows: number[] = []
    for (let i = 1; i < group.length; i++) {
      del.set(group[i].excelRow, { g: groupNum, type: "повтор телефона" })
      deletedRows.push(group[i].excelRow)
    }
    if (opts.withLog && deletedRows.length > 0) {
      groupsForLog.push({ groupNum, kept: keptRow, deleted: deletedRows, type: "повтор телефона" })
    }
  }
  if (!del.size) return null

  const delSet = new Set(del.keys())
  const wb = XLSX.utils.book_new()

  let ws: XLSX.WorkSheet
  try {
    ws = buildStyledCleanSheet(f.buf, f.sheet, delSet)
  } catch (err) {
    console.error("[buildPhoneCleanFile] Не удалось сохранить стили исходного листа:", err)
    throw new Error(
      "Не удалось сохранить форматирование исходного файла: " +
      (err instanceof Error ? err.message : String(err)) +
      ". Пересохраните файл как обычный .xlsx и попробуйте снова."
    )
  }

  XLSX.utils.book_append_sheet(wb, ws, f.sheet || "Без повторов телефонов")

  if (opts.withLog && groupsForLog.length > 0) {
    const ws2 = buildDeletedSheet(
      f.rows,
      f.cfg,
      groupsForLog,
      "Строки указаны по исходному файлу (до удаления). В основном списке оставлена первая строка каждой телефонной группы, остальные удалены.",
    )
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

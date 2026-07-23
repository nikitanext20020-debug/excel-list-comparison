import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ColumnConfig, WorkerResponse } from "./match.worker"

const posted: WorkerResponse[] = []
vi.stubGlobal("self", {
  postMessage: (message: WorkerResponse) => posted.push(message),
  onmessage: null,
})

let runCompare: typeof import("./match.worker").runCompare
let runDupes: typeof import("./match.worker").runDupes

beforeAll(async () => {
  const worker = await import("./match.worker")
  runCompare = worker.runCompare
  runDupes = worker.runDupes
})

const baseConfig: ColumnConfig = {
  start: 2,
  fioMode: "single",
  fio: 0,
  fam: -1,
  im: -1,
  ot: -1,
  phone: -1,
  dob: 2,
  passport: 1,
}

function dupesResult() {
  const result = posted.findLast((message) => message.kind === "dupes-done")
  if (!result || result.kind !== "dupes-done") throw new Error("dupes-done was not posted")
  return result
}

function compareResult() {
  const result = posted.findLast((message) => message.kind === "compare-done")
  if (!result || result.kind !== "compare-done") throw new Error("compare-done was not posted")
  return result
}

describe("passport support in two-file comparison", () => {
  beforeEach(() => {
    posted.length = 0
  })

  it("detects a passport conflict when both files have a passport column", () => {
    const checked = [
      ["ФИО", "Паспорт"],
      ["Петров Пётр Сергеевич", "4624637669"],
    ]
    const database = [
      ["ФИО", "Паспорт"],
      ["Иванов Иван Иванович", "4624 637669"],
    ]

    runCompare(checked, baseConfig, database, baseConfig, "normal")

    expect(compareResult().results[0].res.status).toBe("passport-conflict")
  })

  it("does not use passports when the column is missing in either file", () => {
    const checked = [
      ["ФИО", "Паспорт"],
      ["Петров Пётр Сергеевич", "4624637669"],
    ]
    const database = [
      ["ФИО", "Паспорт"],
      ["Иванов Иван Иванович", "4624 637669"],
    ]

    runCompare(checked, baseConfig, database, { ...baseConfig, passport: -1 }, "normal")

    expect(compareResult().results[0].res.status).toBe("notfound")
  })
})

describe("passport priority in duplicate search", () => {
  beforeEach(() => {
    posted.length = 0
  })

  it("groups the same passport regardless of a different date of birth", () => {
    const rows = [
      ["ФИО", "Паспорт", "Дата рождения"],
      ["Иванов Иван Иванович", "4624 637669", "01.02.1990"],
      ["Иванов Иван Иванович", "4624637669", "03.04.1995"],
    ]

    runDupes(rows, rows, baseConfig, "normal")

    const result = dupesResult()
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0][1].type).toBe("одинаковый паспорт")
    expect(result.disputed).toHaveLength(0)
  })

  it("sends the same passport with a different FIO to disputed pairs", () => {
    const rows = [
      ["ФИО", "Паспорт", "Дата рождения"],
      ["Иванов Иван Иванович", "4624 637669", "01.02.1990"],
      ["Петров Пётр Сергеевич", "4624637669", "03.04.1995"],
    ]

    runDupes(rows, rows, baseConfig, "normal")

    const result = dupesResult()
    expect(result.groups).toHaveLength(0)
    expect(result.disputed).toHaveLength(1)
    expect(result.disputed?.[0][1].type).toContain("паспорт одинаковый")
  })

  it("keeps the previous behavior when the passport column is not selected", () => {
    const rows = [
      ["ФИО", "Паспорт", "Дата рождения"],
      ["Иванов Иван Иванович", "4624 637669", "01.02.1990"],
      ["Петров Пётр Сергеевич", "4624637669", "03.04.1995"],
    ]

    runDupes(rows, rows, { ...baseConfig, passport: -1 }, "normal")

    const result = dupesResult()
    expect(result.groups).toHaveLength(0)
    expect(result.disputed).toHaveLength(0)
  })
})

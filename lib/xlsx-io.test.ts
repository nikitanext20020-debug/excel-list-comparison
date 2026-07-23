import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx-js-style"
import type { RowResult } from "@/workers/match.worker"
import { buildExport, guessColumns } from "./xlsx-io"

describe("guessColumns passport detection", () => {
  it.each(["Паспорт", "Серия", "Серия/номер", "passport"])(
    "detects the passport header %j",
    (header) => {
      const config = guessColumns([
        ["ФИО", "Телефон", header],
        ["Иванов Иван Иванович", "79991112233", "4624 637669"],
      ])

      expect(config.passport).toBe(2)
    },
  )

  it("detects a passport column by 10-digit values", () => {
    const config = guessColumns([
      ["Иванов Иван Иванович", "4624 637669"],
      ["Петров Пётр Петрович", "4610795927"],
      ["Сидоров Сидор Сидорович", "46 24 637670"],
    ])

    expect(config.passport).toBe(1)
  })

  it("does not reuse an already detected phone column as a passport", () => {
    const config = guessColumns([
      ["ФИО", "Телефон", "Документ"],
      ["Иванов Иван Иванович", "7123456789", "4624 637669"],
      ["Петров Пётр Петрович", "8123456789", "4610795927"],
    ])

    expect(config.phone).toBe(1)
    expect(config.passport).toBe(2)
  })
})

describe("passport columns in sheet export", () => {
  const rows = [
    ["ФИО", "Документ"],
    ["Петров Пётр Сергеевич", "4624637669"],
  ]
  const config = {
    ...guessColumns(rows),
    start: 2,
    fio: 0,
    passport: 1,
  }

  it("adds passport metadata and a separate conflict sheet when enabled", async () => {
    const result: RowResult = {
      excelRow: 2,
      fio: rows[1][0],
      phone: "",
      dob: "",
      passport: rows[1][1],
      res: {
        status: "passport-conflict",
        method: "passport",
        reason: "паспорт совпал, ФИО другое — проверьте!",
      },
    }

    const blob = buildExport(rows, config, [result], "both", { passportEnabled: true })
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" })
    expect(workbook.SheetNames).toContain("Паспорт совпал, ФИО другое")
    const sheetRows = XLSX.utils.sheet_to_json(
      workbook.Sheets["Паспорт совпал, ФИО другое"],
      { header: 1 },
    ) as string[][]
    expect(sheetRows[0]).toContain("Паспорт")
    expect(sheetRows[0]).toContain("Как найден")
    expect(sheetRows[1]).toContain("паспорт")
  })

  it("keeps the previous export columns when passport comparison is disabled", async () => {
    const result: RowResult = {
      excelRow: 2,
      fio: rows[1][0],
      phone: "",
      dob: "",
      passport: "",
      res: { status: "notfound" },
    }

    const blob = buildExport(rows, { ...config, passport: -1 }, [result], "notfound")
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" })
    const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets["Не найдены"], { header: 1 }) as string[][]
    expect(sheetRows[0]).not.toContain("Паспорт")
    expect(sheetRows[0]).not.toContain("Как найден")
    expect(sheetRows[0].at(-1)).toBe("Результат сверки")
  })
})

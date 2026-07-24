import { describe, expect, it } from "vitest"
import {
  THRESHOLD_PRESETS,
  addToIndex,
  makeIndex,
  matchRecord,
  normalizePassport,
} from "./matching"

describe("normalizePassport", () => {
  it.each([
    [" 4624  637669 ", "4624637669"],
    ["4610795927", "4610795927"],
    ["46 24 637669", "4624637669"],
    ["46\u00a024\u00a0637669", "4624637669"],
    ["4.624637669e+9", "4624637669"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizePassport(input)).toBe(expected)
  })

  it.each([
    "",
    null,
    undefined,
    "123456789",
    "12345678901",
  ])("returns null for invalid value %j", (input) => {
    expect(normalizePassport(input)).toBeNull()
  })
})

describe("passport matching priority", () => {
  it("confirms a matching person by passport before other identifiers", () => {
    const index = makeIndex()
    addToIndex(index, "Иванов Иван Иванович", "8 999 111-22-33", "01.02.1990", "46 24 637669")

    const result = matchRecord(
      index,
      "Иванов Иван Иванович",
      null,
      null,
      "4624637669",
      THRESHOLD_PRESETS.normal,
    )

    expect(result.status).toBe("exact")
    expect(result.method).toBe("passport")
    expect(result.reason).toBe("подтверждено паспортом")
  })

  it("returns a passport conflict when names are noticeably different", () => {
    const index = makeIndex()
    addToIndex(index, "Иванов Иван Иванович", null, null, "4624637669")

    const result = matchRecord(
      index,
      "Петров Пётр Сергеевич",
      null,
      null,
      "4624637669",
      THRESHOLD_PRESETS.normal,
    )

    expect(result.status).toBe("passport-conflict")
    expect(result.method).toBe("passport")
  })

  it("falls back to the existing FIO chain when passport is not found", () => {
    const index = makeIndex()
    addToIndex(index, "Иванов Иван Иванович", null, null, "4624637669")

    const result = matchRecord(
      index,
      "Иванов Иван Иванович",
      null,
      null,
      "4010123456",
      THRESHOLD_PRESETS.normal,
    )

    expect(result.status).toBe("exact")
    expect(result.method).toBe("fio")
  })
})

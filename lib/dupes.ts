/** Тип строки, которую нельзя автоматически считать дублем: совпало ФИО,
 * но заполненные даты рождения у записей различаются. */
export const DUP_NAMESAKE_TYPE = "тёзка? (другая дата рождения)"
export const DUP_MANUAL_NAMESAKE_TYPE = "одинаковое ФИО (ДР отличается, подтверждено вручную/ИИ)"
export const DUP_PASSPORT_CONFLICT_TYPE = "паспорт одинаковый, ФИО разное — проверьте"
export const DUP_MANUAL_PASSPORT_TYPE = "одинаковый паспорт (подтверждено вручную)"

export type DupNamesakeDecision = "yes" | "no"

export type DupAiVerdict = "same" | "different" | "unsure"

export interface DupAiResult {
  verdict: DupAiVerdict
  confidence: number
  reason: string
}

type RowWithType = { excelRow: number; type: string }

export function namesakePairKey(pair: { excelRow: number }[]): string {
  return `${pair[0]?.excelRow ?? 0}:${pair[1]?.excelRow ?? 0}`
}

export function manualDuplicateRows(
  disputed: { excelRow: number }[][],
  decisions: Record<number, DupNamesakeDecision>,
): Set<number> {
  const rows = new Set<number>()
  for (const [pairIndex, pair] of disputed.entries()) {
    if (decisions[pairIndex] === "yes" && pair[1]) rows.add(pair[1].excelRow)
  }
  return rows
}

export function isDisputedNamesake(type: string): boolean {
  return type === DUP_NAMESAKE_TYPE
}

export function isPassportConflict(type: string): boolean {
  return type === DUP_PASSPORT_CONFLICT_TYPE
}

export function isAiJudgeablePair(pair: { type: string }[]): boolean {
  return pair.some((member) => isDisputedNamesake(member.type))
}

export function manualConfirmedDuplicateType(pair: { type: string }[]): string {
  return pair.some((member) => isPassportConflict(member.type))
    ? DUP_MANUAL_PASSPORT_TYPE
    : DUP_MANUAL_NAMESAKE_TYPE
}

/** Общая фильтрация строк, которые относятся к автоматическим дублям. */
export function filterAutoDuplicateMembers<T extends { type: string }>(members: T[]): T[] {
  return members.filter((member) => !isDisputedNamesake(member.type))
}

/**
 * Считает количество строк, которые будут удалены из файла без дублей.
 * Та же логика, что в buildCleanFile — вынесена для синхронизации с UI.
 */
export function rowsWillDelete<T extends RowWithType>(
  groups: T[][],
  delPhone: boolean,
  manualRows: Iterable<number> = [],
): Set<number> {
  const rows = new Set<number>()
  for (const grp of groups) {
    const autoMembers = filterAutoDuplicateMembers(grp)
    for (let i = 1; i < autoMembers.length; i++) {
      const m = autoMembers[i]
      if (!delPhone && m.type === "совпал телефон") continue
      rows.add(m.excelRow)
    }
  }
  for (const row of manualRows) rows.add(row)
  return rows
}

export function countWillDelete<T extends RowWithType>(
  groups: T[][],
  delPhone: boolean,
  manualRows: Iterable<number> = [],
): number {
  return rowsWillDelete(groups, delPhone, manualRows).size
}

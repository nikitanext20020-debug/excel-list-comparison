/** Тип строки, которую нельзя автоматически считать дублем: совпало ФИО,
 * но заполненные даты рождения у записей различаются. */
export const DUP_NAMESAKE_TYPE = "тёзка? (другая дата рождения)"

export function isDisputedNamesake(type: string): boolean {
  return type === DUP_NAMESAKE_TYPE
}

/** Общая фильтрация строк, которые относятся к автоматическим дублям. */
export function filterAutoDuplicateMembers<T extends { type: string }>(members: T[]): T[] {
  return members.filter((member) => !isDisputedNamesake(member.type))
}

/**
 * Считает количество строк, которые будут удалены из файла без дублей.
 * Та же логика, что в buildCleanFile — вынесена для синхронизации с UI.
 */
export function countWillDelete<T extends { type: string }>(
  groups: T[][],
  delPhone: boolean,
): number {
  let count = 0
  for (const grp of groups) {
    const autoMembers = filterAutoDuplicateMembers(grp)
    for (let i = 1; i < autoMembers.length; i++) {
      const m = autoMembers[i]
      if (!delPhone && m.type === "совпал телефон") continue
      count++
    }
  }
  return count
}

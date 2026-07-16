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

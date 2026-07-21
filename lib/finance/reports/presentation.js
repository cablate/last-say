const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/

export function defaultAsOfDateForMonth(month, today = new Date().toLocaleDateString("en-CA")) {
  if (!MONTH.test(month || "")) return null
  if (!ISO_DATE.test(today || "")) return null

  const [year, monthNumber] = month.split("-").map(Number)
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
  return monthEnd > today ? today : monthEnd
}

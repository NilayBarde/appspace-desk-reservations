const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function getTargetDates({ startDate, endDate, selectedDays, existingDates, holidays }) {
  const dates = [];
  const start = new Date(startDate + "T12:00:00Z");
  const end = new Date(endDate + "T12:00:00Z");
  const holidaySet = new Set(holidays);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    if (existingDates.has(iso)) continue;
    if (holidaySet.has(iso)) continue;
    if (!selectedDays.has(DOW_NAMES[dow])) continue;
    dates.push(iso);
  }
  return dates;
}

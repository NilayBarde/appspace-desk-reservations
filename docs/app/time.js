const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDstBounds(year) {
  const marchFirst = new Date(year, 2, 1);
  const marchSecondSunday = 1 + ((7 - marchFirst.getDay()) % 7) + 7;
  const novFirst = new Date(year, 10, 1);
  const novFirstSunday = 1 + ((7 - novFirst.getDay()) % 7);
  return { marchSecondSunday, novFirstSunday };
}

export function etToUtc(dateStr, hour, minute) {
  const [y, m, day] = dateStr.split("-").map(Number);
  const { marchSecondSunday, novFirstSunday } = getDstBounds(y);
  const dstStart = new Date(y, 2, marchSecondSunday, 2);
  const dstEnd = new Date(y, 10, novFirstSunday, 2);
  const local = new Date(y, m - 1, day, hour, minute);
  const offsetHours = local >= dstStart && local < dstEnd ? 4 : 5;
  const utcHour = hour + offsetHours;
  return `${String(utcHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

export function formatUtcToEt(utcStr) {
  if (!utcStr) return "";
  const d = new Date(utcStr);
  const y = d.getUTCFullYear();
  const { marchSecondSunday, novFirstSunday } = getDstBounds(y);
  const dstStartUtc = new Date(Date.UTC(y, 2, marchSecondSunday, 7));
  const dstEndUtc = new Date(Date.UTC(y, 10, novFirstSunday, 6));
  const isDst = d >= dstStartUtc && d < dstEndUtc;
  const offset = isDst ? 4 : 5;
  const local = new Date(d.getTime() - offset * 3600000);
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm} ${isDst ? "EDT" : "EST"}`;
}

export { DOW_NAMES };

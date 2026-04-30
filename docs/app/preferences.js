const PREFIX = "deskRes_";

export function loadPrefs(storage) {
  const desk = storage.getItem(PREFIX + "desk") || null;
  const daysStr = storage.getItem(PREFIX + "days") || "";
  const days = daysStr ? daysStr.split(",") : [];
  const lastBookedDate = storage.getItem(PREFIX + "lastBookedDate") || null;
  const title = storage.getItem(PREFIX + "title") || "";
  const startTime = storage.getItem(PREFIX + "startTime") || "09:00";
  const endTime = storage.getItem(PREFIX + "endTime") || "17:00";
  return { desk, days, lastBookedDate, title, startTime, endTime };
}

export function savePrefs(storage, { desk, days, title, startTime, endTime }) {
  if (desk != null) storage.setItem(PREFIX + "desk", desk);
  if (days != null) storage.setItem(PREFIX + "days", days.join(","));
  if (title != null) storage.setItem(PREFIX + "title", title);
  if (startTime != null) storage.setItem(PREFIX + "startTime", startTime);
  if (endTime != null) storage.setItem(PREFIX + "endTime", endTime);
}

export function parseTime(timeStr) {
  const [h, m] = (timeStr || "09:00").split(":").map(Number);
  return { hour: h || 0, minute: m || 0 };
}

export function saveLastBookedDate(storage, date) {
  storage.setItem(PREFIX + "lastBookedDate", date);
}

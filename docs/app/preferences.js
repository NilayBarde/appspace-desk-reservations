const PREFIX = "deskRes_";

export function loadPrefs(storage) {
  const desk = storage.getItem(PREFIX + "desk") || null;
  const daysStr = storage.getItem(PREFIX + "days") || "";
  const days = daysStr ? daysStr.split(",") : [];
  const lastBookedDate = storage.getItem(PREFIX + "lastBookedDate") || null;
  const title = storage.getItem(PREFIX + "title") || "";
  return { desk, days, lastBookedDate, title };
}

export function savePrefs(storage, { desk, days, title }) {
  if (desk != null) storage.setItem(PREFIX + "desk", desk);
  if (days != null) storage.setItem(PREFIX + "days", days.join(","));
  if (title != null) storage.setItem(PREFIX + "title", title);
}

export function saveLastBookedDate(storage, date) {
  storage.setItem(PREFIX + "lastBookedDate", date);
}

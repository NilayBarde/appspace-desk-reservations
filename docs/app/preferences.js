const PREFIX = "deskRes_";

export function loadPrefs(storage) {
  const desk = storage.getItem(PREFIX + "desk") || null;
  const daysStr = storage.getItem(PREFIX + "days") || "";
  const days = daysStr ? daysStr.split(",") : [];
  const lastBookedDate = storage.getItem(PREFIX + "lastBookedDate") || null;
  return { desk, days, lastBookedDate };
}

export function savePrefs(storage, { desk, days }) {
  if (desk != null) storage.setItem(PREFIX + "desk", desk);
  if (days != null) storage.setItem(PREFIX + "days", days.join(","));
}

export function saveLastBookedDate(storage, date) {
  storage.setItem(PREFIX + "lastBookedDate", date);
}

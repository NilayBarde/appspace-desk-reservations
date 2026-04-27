const PREFIX = "deskRes_";
const DEFAULT_HORIZON = 90;

export function loadPrefs(storage) {
  const desk = storage.getItem(PREFIX + "desk") || null;
  const daysStr = storage.getItem(PREFIX + "days") || "";
  const days = daysStr ? daysStr.split(",") : [];
  const rawHorizon = parseInt(storage.getItem(PREFIX + "horizon"), 10);
  const horizon = rawHorizon > 0 ? rawHorizon : DEFAULT_HORIZON;
  const lastBookedDate = storage.getItem(PREFIX + "lastBookedDate") || null;
  return { desk, days, horizon, lastBookedDate };
}

export function savePrefs(storage, { desk, days, horizon }) {
  if (desk != null) storage.setItem(PREFIX + "desk", desk);
  if (days != null) storage.setItem(PREFIX + "days", days.join(","));
  if (horizon != null) storage.setItem(PREFIX + "horizon", String(horizon));
}

export function saveLastBookedDate(storage, date) {
  storage.setItem(PREFIX + "lastBookedDate", date);
}

export function saveResumeFrom(storage, date) {
  storage.setItem(PREFIX + "resumeFrom", date);
}

export function getResumeFrom(storage) {
  return storage.getItem(PREFIX + "resumeFrom") || null;
}

export function clearResumeState(storage) {
  storage.removeItem(PREFIX + "resumeFrom");
}

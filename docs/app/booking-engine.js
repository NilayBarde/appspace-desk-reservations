import { etToUtc, DOW_NAMES } from "./time.js";

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

export function findParkCandidates(todayStr, occupiedDates) {
  const candidates = [];
  const today = new Date(todayStr + "T12:00:00Z");
  for (let i = 2; i <= 7; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    if (!occupiedDates.has(iso)) candidates.push(iso);
  }
  return candidates;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function daysOut(todayStr, targetDate) {
  return Math.ceil(
    (new Date(targetDate + "T00:00:00Z") - new Date(todayStr + "T00:00:00Z")) / 86400000
  );
}

function checkExpired(status) {
  if (status === 401 || status === 403) {
    throw new Error("SESSION_EXPIRED");
  }
}

async function bookOneDay({ api, resourceId, targetDate, parkDate, user, todayStr, title, startHour, startMin, endHour, endMin }) {
  const startTime = etToUtc(targetDate, startHour, startMin);
  const endTime = etToUtc(targetDate, endHour, endMin);

  // Always try direct booking first — the API may allow far-future dates directly.
  const { status: directStatus, body: directBody } = await api.createReservation(resourceId, targetDate, startTime, endTime, user, title);
  checkExpired(directStatus);
  if (directBody.events && directBody.events[0]) return { ok: true, date: targetDate };
  if ((directBody.message || "").includes("Having")) return { ok: true, date: targetDate, existing: true };

  // If direct booking succeeded structurally but no event returned, treat non-4xx as ok.
  if (directStatus >= 200 && directStatus < 300) return { ok: true, date: targetDate };

  // Direct booking rejected — fall back to park-and-patch only for far dates.
  if (daysOut(todayStr, targetDate) <= 7 || !parkDate) {
    return { ok: false, date: targetDate, error: directBody.message || `HTTP ${directStatus}` };
  }

  const parkStart = etToUtc(parkDate, startHour, startMin);
  const parkEnd = etToUtc(parkDate, endHour, endMin);
  const { status, body } = await api.createReservation(resourceId, parkDate, parkStart, parkEnd, user, title);
  checkExpired(status);
  const eventId = body.events && body.events[0] && body.events[0].id;
  const resId = body.id;

  if (!eventId) {
    return { ok: false, date: targetDate, error: body.message || `HTTP ${status}` };
  }

  const patchResult = await api.patchEventDate(eventId, targetDate, startTime, endTime);
  const patchOk = patchResult.status >= 200 && patchResult.status < 300;
  const actualStart = patchResult.body.startAt || "";

  if (patchOk && (actualStart === "" || actualStart.startsWith(targetDate))) {
    return { ok: true, date: targetDate };
  }

  await api.deleteReservation(resId);
  return { ok: false, date: targetDate, error: `PATCH failed (HTTP ${patchResult.status}${actualStart ? ", got " + actualStart : ""})` };
}

export async function bookAllDays({ api, resourceId, user, targetDates, todayStr, onProgress, signal, title, startHour = 9, startMin = 0, endHour = 17, endMin = 0 }) {
  const directDates = [];
  const farDates = [];
  for (const d of targetDates) {
    if (daysOut(todayStr, d) <= 7) {
      directDates.push(d);
    } else {
      farDates.push(d);
    }
  }

  const booked = new Set();

  for (const targetDate of directDates) {
    if (signal && signal.aborted) throw new Error("CANCELLED");
    const result = await bookOneDay({ api, resourceId, targetDate, parkDate: null, user, todayStr, title, startHour, startMin, endHour, endMin });
    onProgress(result);
    if (result.ok) booked.add(targetDate);
    await sleep(400);
  }

  if (farDates.length === 0) return booked;

  const parkEndDate = new Date(new Date(todayStr + "T12:00:00Z").getTime() + 8 * 86400000)
    .toISOString().slice(0, 10);
  const parkEvents = await api.getResourceEvents(resourceId, todayStr, parkEndDate);

  const occupiedDays = new Set();
  for (const item of parkEvents) {
    const status = (item.status || "").toLowerCase();
    if (!["cancelled", "canceled", "released"].includes(status)) {
      occupiedDays.add((item.startAt || "").slice(0, 10));
    }
  }

  let parkCandidates = findParkCandidates(todayStr, occupiedDays);

  let freedParkDate = null;
  if (parkCandidates.length === 0) {
    const ownBookings = parkEvents
      .filter((item) => {
        const st = (item.status || "").toLowerCase();
        if (["cancelled", "canceled", "released"].includes(st)) return false;
        return (item.organizer || {}).id === user.id;
      })
      .map((item) => ({ day: (item.startAt || "").slice(0, 10), reservationId: item.reservationId }))
      .sort((a, b) => a.day.localeCompare(b.day));

    if (ownBookings.length === 0) {
      throw new Error("No free park dates and no own bookings to free. Cannot book beyond 7 days.");
    }

    const toFree = ownBookings[0];
    await api.deleteReservation(toFree.reservationId);
    parkCandidates = [toFree.day];
    freedParkDate = toFree.day;
  }

  let parkIdx = 0;

  for (const targetDate of farDates) {
    if (signal && signal.aborted) throw new Error("CANCELLED");
    const parkDate = parkCandidates[parkIdx % parkCandidates.length];
    const result = await bookOneDay({ api, resourceId, targetDate, parkDate, user, todayStr, title, startHour, startMin, endHour, endMin });
    onProgress(result);

    if (result.ok) {
      booked.add(targetDate);
    } else {
      parkIdx++;
    }
    await sleep(400);
  }

  if (freedParkDate && !booked.has(freedParkDate)) {
    const rebookResult = await bookOneDay({ api, resourceId, targetDate: freedParkDate, parkDate: freedParkDate, user, todayStr, title, startHour, startMin, endHour, endMin });
    onProgress(rebookResult);
  }

  return booked;
}

export function parseExistingBookings(events, organizerId) {
  const own = new Map();
  const others = new Map();
  const othersDates = new Set();
  for (const item of events) {
    const status = (item.status || "").toLowerCase();
    if (["cancelled", "canceled", "released"].includes(status)) continue;
    const org = item.organizer || {};
    const day = (item.startAt || "").slice(0, 10);
    if (org.id === organizerId) {
      own.set(day, {
        startAt: item.startAt,
        endAt: item.endAt,
        status: item.status,
        reservationId: item.reservationId,
        eventId: item.id,
      });
    } else {
      const name = org.name || "Unknown";
      if (!others.has(name)) others.set(name, 0);
      others.set(name, others.get(name) + 1);
      if (day) othersDates.add(day);
    }
  }
  return { own, others, othersDates };
}


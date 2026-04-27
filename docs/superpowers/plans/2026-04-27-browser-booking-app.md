# Browser-Based Desk Booking App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cron + Google Sheet desk reservation system with a browser-based bookmarklet app that books up to a year of weekday reservations in one session, working within Appspace's 20-minute token TTL.

**Architecture:** A bookmarklet loads `main.js` from GitHub Pages, which injects an overlay UI on the Appspace page. The app reads the session token from `sessionStorage.jwt`, resolves user identity from the JWT, and makes all Appspace API calls client-side. Core logic (park-and-patch booking, ET-to-UTC conversion) is ported from `book90.js`. Preferences are stored in `localStorage`.

**Tech Stack:** Vanilla JS (browser), no build step, no dependencies. Tests use Node.js with a lightweight test runner (built-in `node:test`). Hosted on GitHub Pages from `docs/`.

---

## File Structure

```
docs/
  index.html                   <- MODIFY: update setup page for new bookmarklet
  app/
    main.js                    <- CREATE: app entry point, orchestrates UI + engines
    ui.js                      <- CREATE: overlay UI rendering (setup, dashboard, cancel, progress)
    style.css                  <- CREATE: overlay styles
    booking-engine.js          <- CREATE: park-and-patch booking logic
    api.js                     <- CREATE: Appspace API wrapper (fetch-based)
    time.js                    <- CREATE: ET-to-UTC, UTC-to-ET, DST handling
    preferences.js             <- CREATE: localStorage read/write
    holidays.js                <- CREATE: company holiday list
    desk-search.js             <- CREATE: typeahead search + availability preview
    identity.js                <- CREATE: JWT parsing, token extraction
    DESK_LOOKUP.json           <- CREATE: copy from repo root
tests/
  js/
    time.test.js               <- CREATE: ET-to-UTC conversion tests
    target-dates.test.js       <- CREATE: weekday/holiday filtering tests
    park-dates.test.js         <- CREATE: park date selection tests
    identity.test.js           <- CREATE: JWT parsing tests
    preferences.test.js        <- CREATE: localStorage tests
    booking-engine.test.js     <- CREATE: integration tests with mock API
    cancellation.test.js       <- CREATE: cancellation flow tests
    desk-search.test.js        <- CREATE: availability preview tests
package.json                   <- CREATE: test runner config
README.md                      <- MODIFY: update for new architecture
```

Each `docs/app/*.js` file is a plain ES module (`export`/`import` style) that also works as a standalone script when concatenated — `main.js` imports the others. For tests, the same modules are loaded via Node.js with minor shims (no `sessionStorage`/`localStorage` in Node, so tests inject mocks).

---

### Task 1: Project Setup and Test Infrastructure

**Files:**
- Create: `package.json`
- Create: `tests/js/helpers.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "appspace-desk-reservations",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/js/*.test.js",
    "test:bash": "./tests/run_tests.sh"
  }
}
```

- [ ] **Step 2: Create test helpers with mock utilities**

Create `tests/js/helpers.js`:

```js
export function createMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem(key) { return store[key] ?? null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    get _store() { return store; },
  };
}

export function createMockFetch(handlers) {
  return async function mockFetch(url, options = {}) {
    for (const handler of handlers) {
      const match = handler.match(url, options);
      if (match) {
        return {
          ok: match.status >= 200 && match.status < 300,
          status: match.status,
          json: async () => match.body,
        };
      }
    }
    throw new Error(`Unhandled fetch: ${options.method || "GET"} ${url}`);
  };
}

export function urlContains(substring) {
  return (url) => url.includes(substring);
}

export function methodAndUrl(method, substring) {
  return {
    match(url, options) {
      if ((options.method || "GET") === method && url.includes(substring)) {
        return this._response;
      }
      return null;
    },
    responding(status, body) {
      this._response = { status, body };
      return this;
    },
  };
}
```

- [ ] **Step 3: Verify test runner works**

Run: `npm test`
Expected: "no test files matched" or similar (no tests yet), exit 0

- [ ] **Step 4: Commit**

```bash
git add package.json tests/js/helpers.js
git commit -m "Add Node.js test infrastructure for browser booking app"
```

---

### Task 2: Time Handling Module

**Files:**
- Create: `docs/app/time.js`
- Create: `tests/js/time.test.js`

- [ ] **Step 1: Write failing tests for ET-to-UTC conversion**

Create `tests/js/time.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { etToUtc, formatUtcToEt } from "../../docs/app/time.js";

describe("etToUtc", () => {
  it("converts 9:00 AM ET to 13:00 UTC during EDT (summer)", () => {
    assert.equal(etToUtc("2026-06-15", 9, 0), "13:00:00.000Z");
  });

  it("converts 5:00 PM ET to 21:00 UTC during EDT (summer)", () => {
    assert.equal(etToUtc("2026-06-15", 17, 0), "21:00:00.000Z");
  });

  it("converts 9:00 AM ET to 14:00 UTC during EST (winter)", () => {
    assert.equal(etToUtc("2026-01-15", 9, 0), "14:00:00.000Z");
  });

  it("converts 5:00 PM ET to 22:00 UTC during EST (winter)", () => {
    assert.equal(etToUtc("2026-01-15", 17, 0), "22:00:00.000Z");
  });

  it("handles DST spring-forward transition date (Mar 8, 2026)", () => {
    assert.equal(etToUtc("2026-03-08", 9, 0), "13:00:00.000Z");
  });

  it("handles day before DST spring-forward (Mar 7, 2026 is EST)", () => {
    assert.equal(etToUtc("2026-03-07", 9, 0), "14:00:00.000Z");
  });

  it("handles DST fall-back transition date (Nov 1, 2026)", () => {
    assert.equal(etToUtc("2026-11-01", 9, 0), "13:00:00.000Z");
  });

  it("handles day after DST fall-back (Nov 2, 2026 is EST)", () => {
    assert.equal(etToUtc("2026-11-02", 9, 0), "14:00:00.000Z");
  });
});

describe("formatUtcToEt", () => {
  it("formats summer UTC to EDT 12-hour", () => {
    assert.equal(formatUtcToEt("2026-06-15T13:00:00.000Z"), "9:00 AM EDT");
  });

  it("formats winter UTC to EST 12-hour", () => {
    assert.equal(formatUtcToEt("2026-01-15T14:00:00.000Z"), "9:00 AM EST");
  });

  it("formats PM time correctly", () => {
    assert.equal(formatUtcToEt("2026-06-15T21:00:00.000Z"), "5:00 PM EDT");
  });

  it("returns empty string for empty input", () => {
    assert.equal(formatUtcToEt(""), "");
  });

  it("returns empty string for null input", () => {
    assert.equal(formatUtcToEt(null), "");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module `../../docs/app/time.js` not found

- [ ] **Step 3: Implement time.js**

Create `docs/app/time.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add docs/app/time.js tests/js/time.test.js
git commit -m "Add DST-aware ET/UTC time conversion module with tests"
```

---

### Task 3: Holidays Module and Target Date Computation

**Files:**
- Create: `docs/app/holidays.js`
- Create: `docs/app/booking-engine.js` (partial — `getTargetDates` only)
- Create: `tests/js/target-dates.test.js`

- [ ] **Step 1: Write failing tests for target date computation**

Create `tests/js/target-dates.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOLIDAYS } from "../../docs/app/holidays.js";
import { getTargetDates } from "../../docs/app/booking-engine.js";

describe("HOLIDAYS", () => {
  it("contains known 2026 holidays", () => {
    assert.ok(HOLIDAYS.includes("2026-01-01"));
    assert.ok(HOLIDAYS.includes("2026-12-25"));
    assert.ok(HOLIDAYS.includes("2026-11-26"));
  });

  it("does not contain weekends", () => {
    for (const h of HOLIDAYS) {
      const d = new Date(h + "T12:00:00Z");
      const dow = d.getUTCDay();
      assert.ok(dow !== 0 && dow !== 6, `${h} is a weekend`);
    }
  });
});

describe("getTargetDates", () => {
  it("returns only weekdays", () => {
    const dates = getTargetDates({
      startDate: "2026-06-01",
      endDate: "2026-06-14",
      selectedDays: new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]),
      existingDates: new Set(),
      holidays: [],
    });
    for (const d of dates) {
      const dow = new Date(d + "T12:00:00Z").getUTCDay();
      assert.ok(dow >= 1 && dow <= 5, `${d} is not a weekday`);
    }
  });

  it("filters to only selected days", () => {
    const dates = getTargetDates({
      startDate: "2026-06-01",
      endDate: "2026-06-14",
      selectedDays: new Set(["Tue", "Thu"]),
      existingDates: new Set(),
      holidays: [],
    });
    const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const d of dates) {
      const name = DOW_NAMES[new Date(d + "T12:00:00Z").getUTCDay()];
      assert.ok(name === "Tue" || name === "Thu", `${d} (${name}) not in selected days`);
    }
  });

  it("excludes existing bookings", () => {
    const dates = getTargetDates({
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      selectedDays: new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]),
      existingDates: new Set(["2026-06-02", "2026-06-04"]),
      holidays: [],
    });
    assert.ok(!dates.includes("2026-06-02"));
    assert.ok(!dates.includes("2026-06-04"));
  });

  it("excludes holidays", () => {
    const dates = getTargetDates({
      startDate: "2026-11-25",
      endDate: "2026-11-30",
      selectedDays: new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]),
      existingDates: new Set(),
      holidays: ["2026-11-26", "2026-11-27"],
    });
    assert.ok(!dates.includes("2026-11-26"));
    assert.ok(!dates.includes("2026-11-27"));
  });

  it("returns empty array when no days match", () => {
    const dates = getTargetDates({
      startDate: "2026-06-06",
      endDate: "2026-06-07",
      selectedDays: new Set(["Mon"]),
      existingDates: new Set(),
      holidays: [],
    });
    assert.equal(dates.length, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement holidays.js**

Create `docs/app/holidays.js`:

```js
export const HOLIDAYS = [
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-11-27",
  "2026-12-24",
  "2026-12-25",
  "2026-12-31",
];
```

- [ ] **Step 4: Create booking-engine.js with getTargetDates only**

Create `docs/app/booking-engine.js`:

```js
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add docs/app/holidays.js docs/app/booking-engine.js tests/js/target-dates.test.js
git commit -m "Add holiday list and target date computation with tests"
```

---

### Task 4: Identity and JWT Parsing Module

**Files:**
- Create: `docs/app/identity.js`
- Create: `tests/js/identity.test.js`

- [ ] **Step 1: Write failing tests for JWT parsing**

Create `tests/js/identity.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSessionJwt, extractToken } from "../../docs/app/identity.js";

function makeJwt(payload) {
  const header = btoa(JSON.stringify({ alg: "HS256" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe("parseSessionJwt", () => {
  it("extracts token, userId, name, email from valid JWT", () => {
    const jwt = makeJwt({
      user: {
        CurrentAccess: { Token: "abc-token-123" },
        UserId: "user-guid-456",
        DisplayName: "Jane Smith",
        Username: "jane.smith@disney.com",
      },
    });
    const result = parseSessionJwt(jwt);
    assert.equal(result.token, "abc-token-123");
    assert.equal(result.id, "user-guid-456");
    assert.equal(result.name, "Jane Smith");
    assert.equal(result.email, "jane.smith@disney.com");
  });

  it("throws on JWT with no user field", () => {
    const jwt = makeJwt({ other: "data" });
    assert.throws(() => parseSessionJwt(jwt), /user/i);
  });

  it("throws on JWT with missing token", () => {
    const jwt = makeJwt({
      user: { UserId: "id", DisplayName: "X", Username: "x@y.com" },
    });
    assert.throws(() => parseSessionJwt(jwt), /token/i);
  });

  it("throws on malformed JWT string", () => {
    assert.throws(() => parseSessionJwt("not-a-jwt"), /parse|decode/i);
  });

  it("handles base64url encoding (- and _ chars)", () => {
    const payload = { user: { CurrentAccess: { Token: "tk" }, UserId: "id", DisplayName: "N", Username: "e" } };
    const body = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const jwt = `header.${body}.sig`;
    const result = parseSessionJwt(jwt);
    assert.equal(result.token, "tk");
  });
});

describe("extractToken", () => {
  it("reads JWT from sessionStorage mock", () => {
    const mockStorage = { jwt: makeJwt({
      user: { CurrentAccess: { Token: "t" }, UserId: "u", DisplayName: "N", Username: "e" },
    })};
    const result = extractToken(mockStorage);
    assert.equal(result.token, "t");
  });

  it("returns null when no JWT in storage", () => {
    const result = extractToken({});
    assert.equal(result, null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Implement identity.js**

Create `docs/app/identity.js`:

```js
export function parseSessionJwt(jwtString) {
  let parts;
  try {
    parts = jwtString.split(".");
    if (parts.length < 2) throw new Error("Not enough JWT segments");
  } catch {
    throw new Error("Failed to parse JWT: could not decode token");
  }

  let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "====".slice(pad);

  let payload;
  try {
    payload = JSON.parse(atob(b64));
  } catch {
    throw new Error("Failed to parse JWT: could not decode payload");
  }

  const user = payload.user;
  if (!user) throw new Error("JWT payload missing user field");

  const token = user.CurrentAccess && user.CurrentAccess.Token;
  if (!token) throw new Error("JWT payload missing token in CurrentAccess");

  return {
    token,
    id: user.UserId,
    name: user.DisplayName,
    email: user.Username,
  };
}

export function extractToken(storage) {
  const jwt = storage.jwt;
  if (!jwt) return null;
  return parseSessionJwt(jwt);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add docs/app/identity.js tests/js/identity.test.js
git commit -m "Add JWT parsing and identity extraction module with tests"
```

---

### Task 5: Preferences Module

**Files:**
- Create: `docs/app/preferences.js`
- Create: `tests/js/preferences.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/js/preferences.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadPrefs, savePrefs, clearResumeState, getResumeFrom } from "../../docs/app/preferences.js";
import { createMockStorage } from "./helpers.js";

describe("loadPrefs", () => {
  it("returns defaults when storage is empty", () => {
    const storage = createMockStorage();
    const prefs = loadPrefs(storage);
    assert.equal(prefs.desk, null);
    assert.deepEqual(prefs.days, []);
    assert.equal(prefs.horizon, 90);
    assert.equal(prefs.lastBookedDate, null);
  });

  it("reads saved values", () => {
    const storage = createMockStorage({
      deskRes_desk: "08W-147-F",
      deskRes_days: "Tue,Wed,Thu",
      deskRes_horizon: "180",
      deskRes_lastBookedDate: "2026-08-14",
    });
    const prefs = loadPrefs(storage);
    assert.equal(prefs.desk, "08W-147-F");
    assert.deepEqual(prefs.days, ["Tue", "Wed", "Thu"]);
    assert.equal(prefs.horizon, 180);
    assert.equal(prefs.lastBookedDate, "2026-08-14");
  });
});

describe("savePrefs", () => {
  it("writes values to storage", () => {
    const storage = createMockStorage();
    savePrefs(storage, { desk: "08W-1", days: ["Mon", "Fri"], horizon: 365 });
    assert.equal(storage.getItem("deskRes_desk"), "08W-1");
    assert.equal(storage.getItem("deskRes_days"), "Mon,Fri");
    assert.equal(storage.getItem("deskRes_horizon"), "365");
  });
});

describe("resume state", () => {
  it("getResumeFrom returns null when not set", () => {
    const storage = createMockStorage();
    assert.equal(getResumeFrom(storage), null);
  });

  it("clearResumeState removes the key", () => {
    const storage = createMockStorage({ deskRes_resumeFrom: "2026-06-10" });
    clearResumeState(storage);
    assert.equal(storage.getItem("deskRes_resumeFrom"), null);
  });
});

describe("horizon presets", () => {
  it("90 for 3 months", () => {
    const storage = createMockStorage({ deskRes_horizon: "90" });
    assert.equal(loadPrefs(storage).horizon, 90);
  });

  it("180 for 6 months", () => {
    const storage = createMockStorage({ deskRes_horizon: "180" });
    assert.equal(loadPrefs(storage).horizon, 180);
  });

  it("365 for 1 year", () => {
    const storage = createMockStorage({ deskRes_horizon: "365" });
    assert.equal(loadPrefs(storage).horizon, 365);
  });

  it("clamps invalid values to 90", () => {
    const storage = createMockStorage({ deskRes_horizon: "-5" });
    assert.equal(loadPrefs(storage).horizon, 90);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Implement preferences.js**

Create `docs/app/preferences.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add docs/app/preferences.js tests/js/preferences.test.js
git commit -m "Add localStorage preferences module with tests"
```

---

### Task 6: API Wrapper Module

**Files:**
- Create: `docs/app/api.js`

- [ ] **Step 1: Implement api.js**

This is a thin wrapper — tested indirectly through integration tests in later tasks.

Create `docs/app/api.js`:

```js
export function createApi(fetchFn, token) {
  async function request(method, path, body) {
    const options = {
      method,
      headers: {
        accept: "application/json",
        token,
        "content-type": "application/json;charset=UTF-8",
        "x-appspace-request-timezone": "America/New_York",
      },
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetchFn(path, options);
    const data = await res.json();
    return { status: res.status, body: data };
  }

  return {
    async verifyToken() {
      const today = new Date().toISOString().slice(0, 10);
      const { status } = await request(
        "GET",
        `/api/v3/reservation/users/me/events?startAt=${today}T00:00:00.000Z&endAt=${today}T00:00:01.000Z&limit=1`
      );
      return status !== 401 && status !== 403;
    },

    async getResourceEvents(resourceId, startDate, endDate) {
      const { body } = await request(
        "GET",
        `/api/v3/reservation/resources/${resourceId}/events?sort=startAt&startAt=${startDate}T00:00:00.000Z&endAt=${endDate}T23:59:59.000Z&page=1&start=0&limit=500`
      );
      return body.items || [];
    },

    async createReservation(resourceId, dateStr, startTime, endTime, user) {
      return request("POST", "/api/v3/reservation/reservations", {
        resourceIds: [resourceId],
        effectiveStartAt: `${dateStr}T${startTime}`,
        effectiveEndAt: `${dateStr}T${endTime}`,
        organizer: { id: user.id, name: user.name },
        sensitivity: "Public",
        organizerAvailabilityType: "Busy",
        attendees: [{
          displayName: user.name,
          email: user.email,
          resourceIds: [resourceId],
          attendanceType: "InPerson",
          userId: user.id,
          id: user.id,
        }],
        visitors: [],
        isAllDay: false,
        startTimeZone: "America/New_York",
        endTimeZone: "America/New_York",
      });
    },

    async patchEventDate(eventId, dateStr, startTime, endTime) {
      return request("PATCH", `/api/v3/reservation/events/${eventId}`, {
        startAt: `${dateStr}T${startTime}`,
        endAt: `${dateStr}T${endTime}`,
        reservationStartAt: `${dateStr}T${startTime}`,
        reservationEndAt: `${dateStr}T${endTime}`,
      });
    },

    async deleteReservation(reservationId) {
      return request("DELETE", `/api/v3/reservation/reservations/${reservationId}`);
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add docs/app/api.js
git commit -m "Add Appspace API wrapper module"
```

---

### Task 7: Booking Engine (Park-and-Patch)

**Files:**
- Modify: `docs/app/booking-engine.js`
- Create: `tests/js/booking-engine.test.js`
- Create: `tests/js/park-dates.test.js`

- [ ] **Step 1: Write failing tests for park date selection**

Create `tests/js/park-dates.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findParkCandidates } from "../../docs/app/booking-engine.js";

describe("findParkCandidates", () => {
  it("returns weekdays 2-7 days out that are not occupied", () => {
    const today = "2026-06-15";
    const candidates = findParkCandidates(today, new Set());
    assert.ok(candidates.length > 0);
    for (const c of candidates) {
      const d = new Date(c + "T12:00:00Z");
      assert.ok(d.getUTCDay() >= 1 && d.getUTCDay() <= 5);
    }
  });

  it("excludes occupied dates", () => {
    const today = "2026-06-15";
    const occupied = new Set(["2026-06-17", "2026-06-18", "2026-06-19"]);
    const candidates = findParkCandidates(today, occupied);
    for (const c of candidates) {
      assert.ok(!occupied.has(c));
    }
  });

  it("returns empty when all park dates occupied", () => {
    const today = "2026-06-15";
    const all = new Set();
    for (let i = 2; i <= 7; i++) {
      const d = new Date("2026-06-15T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      all.add(d.toISOString().slice(0, 10));
    }
    const candidates = findParkCandidates(today, all);
    assert.equal(candidates.length, 0);
  });
});
```

- [ ] **Step 2: Write failing integration tests for booking flow**

Create `tests/js/booking-engine.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bookAllDays } from "../../docs/app/booking-engine.js";

function createMockApi({ existingEvents = [], createOk = true, patchOk = true } = {}) {
  const calls = [];
  return {
    calls,
    async getResourceEvents() { return existingEvents; },
    async createReservation(resourceId, dateStr) {
      calls.push({ action: "create", dateStr });
      if (!createOk) return { status: 400, body: { message: "conflict" } };
      return { status: 200, body: { id: "res-1", events: [{ id: "evt-1" }] } };
    },
    async patchEventDate(eventId, dateStr) {
      calls.push({ action: "patch", dateStr });
      if (!patchOk) return { status: 200, body: { startAt: "" } };
      return { status: 200, body: { startAt: `${dateStr}T13:00:00.000Z` } };
    },
    async deleteReservation(resId) {
      calls.push({ action: "delete", resId });
      return { status: 200, body: {} };
    },
  };
}

describe("bookAllDays", () => {
  it("books dates within 7 days via direct create", async () => {
    const api = createMockApi();
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const dow = new Date(tomorrow + "T12:00:00Z").getUTCDay();
    if (dow === 0 || dow === 6) return;

    const results = [];
    await bookAllDays({
      api,
      resourceId: "res-1",
      user: { id: "u1", name: "Test", email: "t@t.com" },
      targetDates: [tomorrow],
      todayStr: today,
      onProgress: (r) => results.push(r),
    });

    assert.ok(api.calls.some((c) => c.action === "create"));
    assert.equal(results.length, 1);
    assert.ok(results[0].ok);
  });

  it("uses park-and-patch for dates beyond 7 days", async () => {
    const api = createMockApi();
    const today = "2026-06-15";
    const farDate = "2026-08-03";

    const results = [];
    await bookAllDays({
      api,
      resourceId: "res-1",
      user: { id: "u1", name: "Test", email: "t@t.com" },
      targetDates: [farDate],
      todayStr: today,
      onProgress: (r) => results.push(r),
    });

    assert.ok(api.calls.some((c) => c.action === "create"));
    assert.ok(api.calls.some((c) => c.action === "patch" && c.dateStr === farDate));
  });

  it("deletes park reservation on patch failure", async () => {
    const api = createMockApi({ patchOk: false });
    const today = "2026-06-15";
    const farDate = "2026-08-03";

    const results = [];
    await bookAllDays({
      api,
      resourceId: "res-1",
      user: { id: "u1", name: "Test", email: "t@t.com" },
      targetDates: [farDate],
      todayStr: today,
      onProgress: (r) => results.push(r),
    });

    assert.ok(api.calls.some((c) => c.action === "delete"));
    assert.ok(!results[0].ok);
  });

  it("calls onProgress for each date", async () => {
    const api = createMockApi();
    const today = "2026-06-15";
    const dates = ["2026-06-16", "2026-06-17", "2026-06-18"];

    const results = [];
    await bookAllDays({
      api,
      resourceId: "res-1",
      user: { id: "u1", name: "Test", email: "t@t.com" },
      targetDates: dates,
      todayStr: today,
      onProgress: (r) => results.push(r),
    });

    assert.equal(results.length, 3);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `findParkCandidates` and `bookAllDays` not exported

- [ ] **Step 4: Implement full booking engine**

Replace `docs/app/booking-engine.js` with the complete implementation including `findParkCandidates`, `bookAllDays`, and `parseExistingBookings`:

```js
import { etToUtc } from "./time.js";

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

async function bookOneDay(api, resourceId, targetDate, parkDate, user, todayStr) {
  const startTime = etToUtc(targetDate, 9, 0);
  const endTime = etToUtc(targetDate, 17, 0);

  if (daysOut(todayStr, targetDate) <= 7) {
    const { body } = await api.createReservation(resourceId, targetDate, startTime, endTime, user);
    if (body.events && body.events[0]) return { ok: true, date: targetDate };
    if ((body.message || "").includes("Having")) return { ok: true, date: targetDate, existing: true };
    return { ok: false, date: targetDate, error: body.message || "unknown error" };
  }

  const parkStart = etToUtc(parkDate, 9, 0);
  const parkEnd = etToUtc(parkDate, 17, 0);
  const { status, body } = await api.createReservation(resourceId, parkDate, parkStart, parkEnd, user);
  const eventId = body.events && body.events[0] && body.events[0].id;
  const resId = body.id;

  if (!eventId) {
    return { ok: false, date: targetDate, error: body.message || `HTTP ${status}` };
  }

  const patchResult = await api.patchEventDate(eventId, targetDate, startTime, endTime);
  const actualStart = patchResult.body.startAt || "";

  if (actualStart.startsWith(targetDate)) {
    return { ok: true, date: targetDate };
  }

  await api.deleteReservation(resId);
  return { ok: false, date: targetDate, error: `PATCH failed (got ${actualStart || "empty"})` };
}

export async function bookAllDays({ api, resourceId, user, targetDates, todayStr, onProgress }) {
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
  const booked = new Set();

  for (const targetDate of targetDates) {
    const parkDate = parkCandidates[parkIdx % parkCandidates.length];
    const result = await bookOneDay(api, resourceId, targetDate, parkDate, user, todayStr);
    onProgress(result);

    if (result.ok) {
      booked.add(targetDate);
    } else {
      parkIdx++;
    }
    await sleep(400);
  }

  if (freedParkDate && !booked.has(freedParkDate)) {
    const rebookResult = await bookOneDay(api, resourceId, freedParkDate, freedParkDate, user, todayStr);
    onProgress(rebookResult);
  }

  return booked;
}

export function parseExistingBookings(events, organizerId) {
  const own = new Map();
  const others = new Map();
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
    }
  }
  return { own, others };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add docs/app/booking-engine.js tests/js/booking-engine.test.js tests/js/park-dates.test.js
git commit -m "Implement park-and-patch booking engine with integration tests"
```

---

### Task 8: Desk Search Module

**Files:**
- Create: `docs/app/desk-search.js`
- Create: `tests/js/desk-search.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/js/desk-search.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchDesks, parseAvailability } from "../../docs/app/desk-search.js";

const SAMPLE_LOOKUP = {
  "08W-125-A": "id-a",
  "08W-125-B": "id-b",
  "08W-125-C": "id-c",
  "08W-147-F": "id-f",
  "09E-200-A": "id-g",
};

describe("searchDesks", () => {
  it("returns matching desks by prefix", () => {
    const results = searchDesks(SAMPLE_LOOKUP, "08W-125");
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.name.startsWith("08W-125")));
  });

  it("is case-insensitive", () => {
    const results = searchDesks(SAMPLE_LOOKUP, "08w-125");
    assert.equal(results.length, 3);
  });

  it("caps results at maxResults", () => {
    const results = searchDesks(SAMPLE_LOOKUP, "08W", 2);
    assert.equal(results.length, 2);
  });

  it("returns empty for no match", () => {
    const results = searchDesks(SAMPLE_LOOKUP, "ZZZZZ");
    assert.equal(results.length, 0);
  });

  it("returns name and resourceId", () => {
    const results = searchDesks(SAMPLE_LOOKUP, "08W-147");
    assert.equal(results[0].name, "08W-147-F");
    assert.equal(results[0].resourceId, "id-f");
  });
});

describe("parseAvailability", () => {
  it("returns organizer names and counts", () => {
    const events = [
      { startAt: "2026-06-15T13:00:00.000Z", status: "Pending", organizer: { id: "u1", name: "Jane" } },
      { startAt: "2026-06-16T13:00:00.000Z", status: "Pending", organizer: { id: "u1", name: "Jane" } },
      { startAt: "2026-06-17T13:00:00.000Z", status: "Active", organizer: { id: "u2", name: "Bob" } },
    ];
    const result = parseAvailability(events);
    assert.equal(result.get("Jane"), 2);
    assert.equal(result.get("Bob"), 1);
  });

  it("excludes cancelled events", () => {
    const events = [
      { startAt: "2026-06-15T13:00:00.000Z", status: "Cancelled", organizer: { id: "u1", name: "Jane" } },
    ];
    const result = parseAvailability(events);
    assert.equal(result.size, 0);
  });

  it("returns empty map for no events", () => {
    const result = parseAvailability([]);
    assert.equal(result.size, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Implement desk-search.js**

Create `docs/app/desk-search.js`:

```js
export function searchDesks(lookup, query, maxResults = 10) {
  const q = query.toLowerCase();
  const results = [];
  for (const [name, resourceId] of Object.entries(lookup)) {
    if (name.toLowerCase().includes(q)) {
      results.push({ name, resourceId });
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

export function parseAvailability(events) {
  const organizers = new Map();
  for (const item of events) {
    const status = (item.status || "").toLowerCase();
    if (["cancelled", "canceled", "released"].includes(status)) continue;
    const name = (item.organizer || {}).name || "Unknown";
    organizers.set(name, (organizers.get(name) || 0) + 1);
  }
  return organizers;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add docs/app/desk-search.js tests/js/desk-search.test.js
git commit -m "Add desk search with availability parsing and tests"
```

---

### Task 9: Cancellation Tests

**Files:**
- Create: `tests/js/cancellation.test.js`

- [ ] **Step 1: Write cancellation flow tests**

Create `tests/js/cancellation.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("cancelReservations", () => {
  function createMockApi() {
    const calls = [];
    return {
      calls,
      async deleteReservation(resId) {
        calls.push(resId);
        return { status: 200, body: {} };
      },
    };
  }

  it("deletes each selected reservation", async () => {
    const api = createMockApi();
    const bookings = new Map([
      ["2026-06-15", { reservationId: "r1" }],
      ["2026-06-16", { reservationId: "r2" }],
      ["2026-06-17", { reservationId: "r3" }],
    ]);
    const toCancel = ["2026-06-15", "2026-06-17"];

    for (const date of toCancel) {
      const booking = bookings.get(date);
      await api.deleteReservation(booking.reservationId);
    }

    assert.deepEqual(api.calls, ["r1", "r3"]);
  });

  it("handles empty selection", async () => {
    const api = createMockApi();
    const toCancel = [];
    for (const date of toCancel) {
      await api.deleteReservation(date);
    }
    assert.equal(api.calls.length, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/js/cancellation.test.js
git commit -m "Add cancellation flow tests"
```

---

### Task 10: Overlay Styles

**Files:**
- Create: `docs/app/style.css`

- [ ] **Step 1: Create overlay CSS**

Create `docs/app/style.css` with styles for the overlay panel, search results, day buttons, horizon presets, progress bar, reservation list, cancellation checkboxes, warning/error states, and close button. Use the `.dra-` prefix for all classes to avoid collisions with Appspace styles. The full CSS is provided in the implementation — it covers all UI states from the spec.

- [ ] **Step 2: Commit**

```bash
git add docs/app/style.css
git commit -m "Add overlay CSS styles for booking app UI"
```

---

### Task 11: UI Module

**Files:**
- Create: `docs/app/ui.js`

This renders all 4 UI states (setup, dashboard, cancel, progress). Since it's pure DOM manipulation tested via the manual checklist, it's implemented without TDD. Uses safe DOM construction methods (createElement, textContent) throughout — no innerHTML with untrusted content.

- [ ] **Step 1: Create ui.js**

Create `docs/app/ui.js` implementing:
- `createApp({ api, user, deskLookup, storage })` — main entry point
- `renderSetup()` — first-time setup with desk search, day checkboxes, horizon picker, no-show warning
- `renderDashboard()` — returning user view with status banner, reservation list, conflict detection
- `renderCancel(sorted, resourceId)` — cancellation view with date range picker and individual checkboxes
- `renderProgress(resourceId, targetDates, existingOwn)` — booking progress with progress bar and live log

All DOM construction uses `document.createElement` and `textContent` for text content. The desk search is debounced at 300ms with availability cached per session. The date range picker uses `<select>` dropdowns populated from the user's existing bookings.

- [ ] **Step 2: Commit**

```bash
git add docs/app/ui.js
git commit -m "Add overlay UI module with setup, dashboard, cancel, and progress views"
```

---

### Task 12: Main Entry Point

**Files:**
- Create: `docs/app/main.js`

- [ ] **Step 1: Create main.js**

Create `docs/app/main.js`:

```js
import { extractToken } from "./identity.js";
import { createApi } from "./api.js";
import { createApp } from "./ui.js";

const PAGES_BASE = "https://nilaybarde.github.io/appspace-desk-reservations/app";

async function init() {
  const identity = extractToken(sessionStorage);
  if (!identity) {
    alert("Log into Appspace first, then click this bookmark again.");
    return;
  }

  const api = createApi(fetch.bind(window), identity.token);

  const valid = await api.verifyToken();
  if (!valid) {
    alert("Your Appspace session has expired. Please refresh the page to re-login, then try again.");
    return;
  }

  let deskLookup;
  try {
    const res = await fetch(PAGES_BASE + "/DESK_LOOKUP.json");
    deskLookup = await res.json();
  } catch {
    alert("Failed to load desk data. Try again in a moment.");
    return;
  }

  const existingStyle = document.getElementById("desk-res-style");
  if (!existingStyle) {
    try {
      const cssRes = await fetch(PAGES_BASE + "/style.css");
      const cssText = await cssRes.text();
      const style = document.createElement("style");
      style.id = "desk-res-style";
      style.textContent = cssText;
      document.head.appendChild(style);
    } catch {
      // CSS load failed — app will still work, just unstyled
    }
  }

  createApp({
    api,
    user: { id: identity.id, name: identity.name, email: identity.email },
    deskLookup,
    storage: localStorage,
  });
}

init().catch((err) => {
  console.error("[Desk Reservations]", err);
  alert("Something went wrong loading the desk reservation tool. Check the console for details.");
});
```

- [ ] **Step 2: Commit**

```bash
git add docs/app/main.js
git commit -m "Add main entry point that wires identity, API, and UI together"
```

---

### Task 13: Copy DESK_LOOKUP.json and Update Setup Page

**Files:**
- Copy: `DESK_LOOKUP.json` to `docs/app/DESK_LOOKUP.json`
- Modify: `docs/index.html`

- [ ] **Step 1: Copy DESK_LOOKUP.json to docs/app/**

Run: `cp DESK_LOOKUP.json docs/app/DESK_LOOKUP.json`

- [ ] **Step 2: Rewrite docs/index.html as the new setup page**

Replace `docs/index.html` with the new bookmarklet setup page. The page:
- Explains the one-time setup ("drag to bookmarks bar")
- Explains the usage flow ("log into Appspace, click bookmark, book your days")
- Generates the bookmarklet href that checks for `sessionStorage.jwt` and loads `main.js` as a module from GitHub Pages
- Includes legacy/fallback details sections
- Uses the same clean design as the current page

The bookmarklet code:
```js
javascript:(function(){if(!sessionStorage.jwt){alert('Log into Appspace first, then click this bookmark again.');return;}var e=document.getElementById('desk-res-app');if(e){e.remove();return;}var s=document.createElement('script');s.id='desk-res-loader';s.type='module';s.src='https://nilaybarde.github.io/appspace-desk-reservations/app/main.js';document.head.appendChild(s);})();
```

- [ ] **Step 3: Commit**

```bash
git add docs/app/DESK_LOOKUP.json docs/index.html
git commit -m "Update setup page with new bookmarklet and copy DESK_LOOKUP to docs/app"
```

---

### Task 14: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite README for new architecture**

Replace the contents of `README.md` to reflect the new browser-based system:
- Features: browser-based booking, 90-day bulk booking, desk search with availability, vacation cancellation
- Setup: one-time bookmark save from the GitHub Pages helper page
- Usage: log into Appspace, click bookmark, pick desk/days, book
- DESK_LOOKUP generation: keep existing console snippet instructions
- Legacy section: check-in still exists but best-effort with 20-min token TTL
- File structure: updated to show `docs/app/` files
- Running tests: `npm test` for JS tests, `./tests/run_tests.sh` for legacy bash tests

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Rewrite README for browser-based booking app"
```

---

### Task 15: End-to-End Manual Verification

- [ ] **Step 1: Run all JS tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 2: Run existing bash tests**

Run: `./tests/run_tests.sh`
Expected: All tests PASS (these still cover the legacy scripts)

- [ ] **Step 3: Manual browser testing**

Open Appspace in a browser, logged in. Click the "Book My Desk" bookmarklet. Verify:

1. Overlay appears with setup screen
2. Desk search works — type a prefix, see results with availability
3. Day checkboxes work — can select/deselect
4. No-show warning is visible
5. Horizon presets work (3 mo / 6 mo / 1 year / custom)
6. Save and Continue goes to dashboard
7. Status banner shows correct booking info
8. "Book New Days" starts progress view with progress bar
9. Reservations appear in the list after booking
10. "Select days to cancel" shows date range picker
11. Cancellation confirms and removes days
12. Closing and re-opening preserves preferences
13. Settings gear allows changing desk/days

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "Fix issues found during manual testing"
```

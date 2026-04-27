# Browser-Based Desk Booking App

## Problem

Appspace session tokens now expire in 20 minutes, breaking the automated cron-based reservation system. Tokens stored in the Google Sheet are always stale by the time GitHub Actions runs. The current system requires technical knowledge (terminal, tokens, Google Sheet editing) that doesn't scale to non-technical users.

## Solution

A single-page booking app that runs entirely in the browser, injected as an overlay on the Appspace page via a bookmarklet. Users click one bookmark, see their desk dashboard, and book up to a year of weekday reservations in one session — all within the 20-minute token window.

## User Experience

### One-Time Setup

1. Visit the GitHub Pages setup page
2. Drag "Book My Desk" to the bookmarks bar

### Every ~3 Months

1. Log into Appspace
2. Click "Book My Desk" bookmark
3. First time: pick desk (searchable), pick weekdays, see no-show warning, confirm
4. Returning: see dashboard with booking status, click "Book New Days"
5. Done

### Vacation / Cancellation

1. Click "Book My Desk" bookmark
2. Scroll to reservations, click "Select days to cancel"
3. Use date range picker for bulk selection, or pick individual days
4. Confirm cancellation

## UI States

### State 1: First-Time Setup

Shown when no saved preferences exist in `localStorage`.

- **Name/email**: Auto-populated from the Appspace JWT
- **Desk search**: Typeahead input filtering against `DESK_LOOKUP.json` (32K entries, prefix filter)
- **Day checkboxes**: Mon through Fri, none selected by default — forces deliberate choice
- **No-show warning**: Prominent, shown before they can proceed: "Only select days you'll actually be in. Appspace tracks no-shows."
- **Booking horizon**: Presets (3 mo / 6 mo / 1 year) plus custom input. Default: 3 months
- Preferences saved to `localStorage` on confirm

### State 2: Returning User Dashboard

Shown when preferences exist in `localStorage`.

- **Identity bar**: Name, desk, days — with a Settings gear to change
- **Status banner**: "Booked through [date]. Book again around [date - 1 month] to stay covered." or "You're all set through [date]." or "[N] new days available to book."
- **Book New Days button**: Only shown when there are unbooked days within the horizon
- **Reservation list**: Grouped by month, scrollable, showing date/day/time/status
- **Cancel days button**: Enters cancellation mode

### State 3: Cancel Reservations

- **Date range picker**: From/To dropdowns for bulk selection (vacation blocks)
- **Individual checkboxes**: For fine-grained control, below the range picker
- **Live count**: "Cancelling N days."
- **Confirm button**: Requires explicit confirmation before DELETE calls

### State 4: Booking Progress

- **Progress bar**: Visual progress with count (e.g., "34 / 52 days")
- **Live log**: Each day shows booked/skipped/failed as it happens
- **Time estimate**: "(takes ~1-2 minutes)"
- Returns to dashboard on completion with updated status

### Error States

- **Not logged in**: "Log into Appspace first, then click this bookmark again."
- **Token expires mid-booking**: "Your session expired. Log into Appspace in another tab, come back here, click Retry." Resumes from last successful date.
- **Desk not found**: "Desk '[name]' wasn't found. Check your desk name in Settings."

## Technical Architecture

### Component Structure

```
Bookmarklet (tiny, in bookmark bar)
  loads main.js from GitHub Pages
    ├── Token extraction (reads sessionStorage.jwt)
    ├── Identity resolution (parse JWT for name/email/userId)
    ├── UI renderer (injects overlay into Appspace DOM)
    ├── Desk search (fetches DESK_LOOKUP.json from GitHub Pages)
    ├── Booking engine (park-and-patch logic from book90.js)
    ├── Cancellation engine (DELETE API calls)
    └── Preferences (localStorage read/write)
```

The bookmarklet is one line: `javascript:(function(){...load script...})()`. All real logic lives in the hosted `main.js`, so updates ship instantly without users re-saving their bookmark.

### Bookmarklet Behavior

1. Checks `sessionStorage.jwt` exists — if not, alerts user to log in
2. Injects `<script src="https://[pages-url]/app/main.js">` into the page
3. `main.js` initializes the overlay UI

### API Calls

All calls use `fetch()` from the Appspace domain with the token in the `token` header. No CORS issues since the script runs on the same origin.

| Action | Method | Endpoint |
|--------|--------|----------|
| Verify token | GET | `/api/v3/reservation/users/me/events?limit=1` |
| Get existing bookings | GET | `/api/v3/reservation/resources/{id}/events?startAt=...&endAt=...` |
| Create reservation (within 7 days) | POST | `/api/v3/reservation/reservations` |
| Create park reservation (for patch trick) | POST | `/api/v3/reservation/reservations` |
| Patch to target date | PATCH | `/api/v3/reservation/events/{eventId}` |
| Cancel reservation | DELETE | `/api/v3/reservation/reservations/{id}` |

### Booking Engine (Park-and-Patch)

Ported from `book90.js`. Logic:

1. Fetch existing bookings for the user's desk within the booking horizon
2. Compute target dates: all weekdays matching user's selected days, excluding already-booked dates
3. For dates within 7 days: create reservation directly via POST
4. For dates beyond 7 days:
   a. Create a "park" reservation on an available date within the next 2-7 days
   b. PATCH the event's start/end dates to the actual target date
   c. If PATCH fails, DELETE the park reservation and rotate to next park date
5. If all park dates are occupied by others, cancel one of the user's own nearby bookings to free a park slot, then re-book it after
6. 400ms delay between API calls to avoid rate limiting

### Time Handling

- Booking times: 9:00 AM - 5:00 PM Eastern, hardcoded. Not user-configurable — simplifies the UI and matches the standard office day.
- DST-aware ET-to-UTC conversion (ported from `book90.js` `etToUtc()` function)
- Timezone headers: `startTimeZone: America/New_York`, `endTimeZone: America/New_York`

### Holiday Handling

The booking engine skips company holidays (same list currently in `reserve.sh`). Holidays are maintained as a hardcoded array in `main.js`, updated yearly. Holidays appear grayed out in the reservation list and are excluded from "days available to book" counts.

### Token Expiry Recovery

The booking loop for 90 days takes ~1-2 minutes (400ms delay per call). For 365 days, ~4 minutes. Well within the 20-minute TTL. If the token does expire mid-booking:

1. API returns 401/403
2. UI pauses, shows: "Session expired. Log into Appspace in another tab, come back, click Retry."
3. On retry, re-reads `sessionStorage.jwt` for the fresh token
4. Resumes from the last successfully booked date (tracked in a local variable)

### localStorage Schema

```json
{
  "deskRes_desk": "08W-147-F",
  "deskRes_days": "Tue,Wed,Thu",
  "deskRes_horizon": 90,
  "deskRes_lastBookedDate": "2026-08-14"
}
```

Flat keys prefixed with `deskRes_` to avoid collisions. No tokens stored — always read fresh from `sessionStorage`.

### DESK_LOOKUP.json Delivery

32K entries, ~2MB. Fetched from GitHub Pages on load, browser-cached after first request. Cache-busted with a version parameter (`DESK_LOOKUP.json?v=2`) when desks are updated.

### File Structure on GitHub Pages

```
docs/
  index.html              <- setup page ("drag this to your bookmarks bar")
  app/
    main.js               <- full booking app (injected by bookmarklet)
    main.css              <- styles for the overlay UI
    DESK_LOOKUP.json      <- desk name to resource ID mapping
```

## What Gets Retired

- `reserve.sh` — replaced by browser booking
- `fetch_users.sh` — no more Google Sheet
- `.github/workflows/reservation.yml` — no more cron reservations
- Google Sheet — no longer needed for config or tokens

## What Stays (Best-Effort)

- `checkin.sh` / `.github/workflows/checkin.yml` — kept but documented as best-effort; requires a valid token which may not be available with 20-min TTL
- `DESK_LOOKUP.json` at repo root — source of truth, copied to `docs/app/` for Pages delivery

## Testing Strategy

### Unit Tests (Node.js, runnable via `npm test`)

- **ET-to-UTC conversion**: DST and EST dates, edge cases around DST transition days (ported from existing `test_time_conversion.sh` but in JS)
- **Target date computation**: Correct weekday filtering, holiday skipping, existing booking exclusion
- **Park date selection**: Finds free park dates, handles all-occupied scenario (frees own booking)
- **JWT parsing**: Extracts token/userId/name/email from sample payloads, handles malformed JWTs
- **localStorage preferences**: Read/write/defaults, migration from empty state
- **Booking horizon presets**: 3mo/6mo/1yr compute correct end dates, custom day input validation

### Integration Tests (against mock API)

- **Full booking flow**: Mock Appspace API responses, verify correct sequence of POST → PATCH → (DELETE on failure) calls
- **Cancellation flow**: Verify DELETE calls for selected dates
- **Token expiry recovery**: Simulate 401 mid-booking, verify resume from correct date
- **Existing bookings dedup**: Verify already-booked dates are skipped

### Manual Test Checklist (browser)

- Bookmarklet loads on Appspace domain
- First-time setup flow: desk search, day selection, warning shown
- Returning user dashboard: status banner accuracy, reservation list
- Book new days: progress bar, completion
- Cancel days: range picker, individual checkboxes, confirmation
- Error states: not logged in, expired token, invalid desk
- `localStorage` persistence across sessions
- `DESK_LOOKUP.json` loads and desk search performs well with 32K entries

## README Update

The repo README will be updated to reflect the new architecture:
- Replace Google Sheet setup instructions with bookmarklet setup instructions
- Document the new user flow (one-time bookmark save, periodic booking)
- Keep check-in documentation as best-effort/legacy
- Remove references to `reserve.sh`, `fetch_users.sh`, and the reservation cron

## Out of Scope

- Automated check-in (requires server-side token, not feasible with 20-min TTL + SSO)
- Multi-user admin view
- Notification/reminders (e.g., "time to re-book") — the dashboard status banner handles this passively

# Appspace Desk Reservations

Browser-based desk reservation tool for Appspace. Book months of weekday desk reservations in one click via a bookmarklet overlay — no terminal, no tokens to manage, no Google Sheet.

## How It Works

1. **One-time setup**: Visit the [setup page](https://nilaybarde.github.io/appspace-desk-reservations/), drag "Book My Desk" to your bookmarks bar
2. **Every ~3 months**: Log into Appspace → click the bookmark → pick your desk, days, hours, and horizon → done
3. **Vacation**: Click the bookmark → select days to cancel → confirm
4. **Change hours**: Click the bookmark → adjust hours (auto-saves) or use "Edit Times" to bulk-update existing reservations

The bookmarklet reads your Appspace session directly from the browser (same-origin, no tokens leave the page) and books up to 90 days of reservations in one session using a park-and-patch technique.

## Features

- **One-click booking**: Book up to 90 days of weekday reservations in ~1-2 minutes
- **Desk search with availability**: Search 32K+ desks, see who currently occupies each one
- **Flexible scheduling**: Pick specific weekdays (Mon-Fri), set booking horizon (1mo / 2mo / 3mo / custom)
- **Custom hours**: Choose your own start/end times (in ET, auto-adjusts for DST)
- **Mass edit times**: Bulk-update hours on existing reservations via the "Edit Times" view
- **Vacation cancellation**: Bulk-cancel date ranges or individual days
- **Conflict detection**: Warns if someone else has the desk reserved
- **No-show warning**: Reminds users to only book days they'll actually attend
- **Unified layout**: Settings, status, and actions all on one page — auto-saves as you change
- **Check-in / Rebook**: One-click check-in or rebook for today directly from the main view
- **Token-safe**: Works within the 20-minute Appspace token TTL — no stored tokens

## Setup

### For Users

1. Open the [Book My Desk setup page](https://nilaybarde.github.io/appspace-desk-reservations/)
2. Drag the **Book My Desk** button to your bookmarks bar
3. Log into [Appspace](https://disney.cloud.appspace.com/)
4. Click **Book My Desk** in your bookmarks bar
5. First time: search for your desk, pick your weekdays and hours (all settings auto-save)
6. Click **Book New Days** → choose horizon → Book

### For Repo Maintainers

The app is hosted on GitHub Pages from the `/docs` directory. To enable:
1. Go to repo **Settings → Pages**
2. Set Source to **Deploy from a branch**, branch `main`, folder `/docs`
3. Save

#### Updating DESK_LOOKUP.json

The desk lookup maps ~32K desk names to Appspace resource IDs. To regenerate:

1. Log into Appspace in your browser
2. Open DevTools console (F12)
3. Paste and run:

```javascript
(async () => {
    const jwt = sessionStorage.jwt;
    const token = JSON.parse(atob(jwt.split('.')[1])).user.CurrentAccess.Token;
    
    console.log('Fetching all desks...');
    let all = [];
    let start = 0;
    
    while (true) {
        const res = await fetch(
            `https://disney.cloud.appspace.com/api/v3/reservation/resources?start=${start}&limit=1000`,
            { headers: { 'token': token } }
        );
        const data = await res.json();
        if (!data.items || !data.size) break;
        
        all = all.concat(data.items);
        console.log(`${Math.round((Math.min(start + 1000, data.size) / data.size) * 100)}% - ${all.length} desks`);
        
        if (start + 1000 >= data.size) break;
        start += 1000;
    }
    
    const lookup = {};
    all.forEach(d => { lookup[d.name] = d.id; });
    
    const blob = new Blob([JSON.stringify(lookup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'DESK_LOOKUP.json';
    a.click();
    
    console.log(`Done — ${Object.keys(lookup).length} desks`);
})();
```

4. Save the downloaded file to the repo root as `DESK_LOOKUP.json`
5. Copy to `docs/app/DESK_LOOKUP.json`
6. Commit and push

## File Structure

```
appspace-desk-reservations/
├── docs/                          # GitHub Pages root
│   ├── index.html                 # Bookmarklet setup page
│   └── app/
│       ├── main.js                # Entry point (loaded by bookmarklet)
│       ├── ui.js                  # Overlay UI (main, book, cancel, edit times, progress)
│       ├── api.js                 # Appspace API wrapper
│       ├── booking-engine.js      # Park-and-patch booking logic
│       ├── identity.js            # JWT parsing and token extraction
│       ├── preferences.js         # localStorage read/write
│       ├── desk-search.js         # Desk search and availability parsing
│       ├── holidays.js            # Company holiday list
│       ├── time.js                # DST-aware ET/UTC conversion
│       ├── style.css              # Overlay CSS (.dra- prefixed)
│       └── DESK_LOOKUP.json       # Desk name → resource ID mapping
├── tests/
│   ├── js/                        # JavaScript unit/integration tests
│   │   ├── helpers.js             # Test utilities (mock storage, mock fetch)
│   │   ├── time.test.js           # ET/UTC conversion + DST tests
│   │   ├── identity.test.js       # JWT parsing tests
│   │   ├── preferences.test.js    # localStorage tests
│   │   ├── target-dates.test.js   # Holiday + target date tests
│   │   ├── booking-engine.test.js # Park-and-patch integration tests
│   │   ├── park-dates.test.js     # Park date selection tests
│   │   ├── desk-search.test.js    # Desk search tests
│   │   └── cancellation.test.js   # Cancellation flow tests
│   ├── run_tests.sh               # Legacy bash test runner
│   └── ...                        # Legacy bash tests
├── DESK_LOOKUP.json               # Source of truth (copied to docs/app/)
├── package.json                   # Node.js test config
├── checkin.sh                     # Legacy auto check-in (best-effort)
├── reserve.sh                     # Legacy reservation script
└── README.md
```

## Running Tests

```bash
# JavaScript tests (booking app)
npm test

# Legacy bash tests
./tests/run_tests.sh
```

## Technical Details

### Park-and-Patch Booking

Appspace limits direct reservations to 7 days out. To book further:
1. Create a "park" reservation within the next 2-7 days
2. PATCH the event's start/end dates to the actual target date
3. If the PATCH fails, DELETE the park reservation and try the next available park date

This allows booking up to 90 days ahead. The booking loop runs at 400ms per day to avoid rate limits.

### Token Handling

The app reads `sessionStorage.jwt` on the Appspace domain — same-origin, no CORS. Tokens have a 20-minute TTL. Booking 90 days takes ~1-2 minutes. If the token expires mid-booking, progress is saved to `localStorage` and resumed on next run.

### Holidays

Company holidays are hardcoded in `docs/app/holidays.js` (updated yearly). Holidays are skipped during booking and shown grayed out in the reservation list.

## Legacy System

The bash scripts (`reserve.sh`, `checkin.sh`, `fetch_users.sh`) and GitHub Actions workflows still exist but are largely superseded by the browser-based app. The auto check-in (`checkin.sh` / `.github/workflows/checkin.yml`) is kept as best-effort but requires a valid token, which is impractical with the 20-minute TTL.

## License

[Add your license here]

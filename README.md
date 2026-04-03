# Appspace Desk Reservations

Automated desk reservation and check-in system for Appspace. This project automatically reserves desks Monday through Friday and handles check-ins for scheduled reservations.

## Features

- 🤖 **Automated Reservations**: Automatically reserves desks for configured days (per-user) up to 7 days in advance
- ✅ **Auto Check-in**: Automatically checks in for reservations within a 15-minute window before/after start time
- 👥 **Multi-User Support**: Manage multiple users with individual desk assignments
- 📊 **Google Sheets Integration**: Users self-serve by adding their data to a shared Google Sheet
- 🪑 **Desk Name Lookup**: Use human-readable desk names instead of UUIDs
- 🔄 **GitHub Actions Integration**: Fully automated workflows for reservations and check-ins
- ✅ **Validation**: Test script to validate configuration before deployment
- 📝 **Logging**: Detailed logs for all reservation and check-in activities

## Prerequisites

- `bash` (version 4.0+)
- `jq` (JSON processor)
  - macOS: `brew install jq`
  - Linux: `apt-get install jq` or `yum install jq`
- `curl`
- Access to Appspace API with valid tokens

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/appspace-desk-reservations.git
   cd appspace-desk-reservations
   ```

2. Make scripts executable:

   ```bash
   chmod +x reserve.sh checkin.sh fetch_users.sh test_user_configs.sh
   ```

3. Install `jq` if not already installed:

   ```bash
   # macOS
   brew install jq
   
   # Linux (Debian/Ubuntu)
   sudo apt-get install jq
   
   # Linux (RHEL/CentOS)
   sudo yum install jq
   ```

## Configuration

### Local Setup (.env file)

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

```bash
# Appspace API endpoint
APPSPACE_HOST="https://disney.cloud.appspace.com"

# Booking time range (9 to 5 Eastern). Use HH:MM for DST-aware conversion:
BOOKING_START_UTC="09:00"  # 9:00 AM Eastern
BOOKING_END_UTC="17:00"    # 5:00 PM Eastern

# Google Sheet ID — the long string in your sheet URL
GOOGLE_SHEET_ID="your-google-sheet-id-here"
```

### Google Sheet Setup

User configuration is managed via a **public Google Sheet**. Users add their own data to the sheet, and the scripts automatically fetch the latest data before each run.

**Required columns** (in order):

| Name | Email | Desk | Appspace Token | Organizer ID | Days |
|------|-------|------|----------------|--------------|------|
| John Doe | <john.doe@disney.com> | 08W-125-H | abc-123-... | def-456-... | Mon,Tue,Wed,Thu |

- **Days** column uses 3-letter abbreviations: `Mon`, `Tue`, `Wed`, `Thu`, `Fri`
- Leave Days blank to default to `Tue,Wed,Thu`

**Rules:**

- Rows missing **Organizer ID** or **Appspace Token** are automatically skipped
- The sheet must be **publicly accessible** (anyone with the link can view)
- The `GOOGLE_SHEET_ID` is the long string in your sheet URL: `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`

### How fetch_users.sh Works

The `fetch_users.sh` script:

1. Downloads the Google Sheet as CSV via `https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv`
2. Parses each row and maps columns to the `USER_CONFIGS.json` format
3. Skips incomplete rows (missing Organizer ID or Appspace Token)
4. Writes the result to `USER_CONFIGS.json`

Both `reserve.sh` and `checkin.sh` call `fetch_users.sh` automatically when `GOOGLE_SHEET_ID` is set. If the fetch fails (e.g., no network), they fall back to the existing `USER_CONFIGS.json`.

### USER_CONFIGS.json Format

The auto-generated `USER_CONFIGS.json` looks like this (see `USER_CONFIGS.example.json` for a template):

```json
{
  "john.doe@disney.com": {
    "APPSPACE_TOKEN": "your-token-here",
    "DESK_NAME": "08W-125-H",
    "ORGANIZER_ID": "organizer-id",
    "ORGANIZER_NAME": "John Doe",
    "ORGANIZER_EMAIL": "john.doe@disney.com",
    "BOOKING_DAYS": "Mon,Tue,Wed,Thu"
  }
}
```

### DESK_LOOKUP.json

The `DESK_LOOKUP.json` file maps human-readable desk names to their resource IDs. This file is auto-generated from the Appspace API.

**Format:**

```json
{
  "08W-125-H": "4287c413-3c0a-4f9d-8865-ed80e54ff82d",
  "08W-125-J": "9178b379-0a24-4a2b-acb0-b819e71a7445",
  "08W-126-A": "a8a3f7f9-16bb-43ae-85e1-beab7668e090"
}
```

**To generate/update DESK_LOOKUP.json:**

1. Log into Appspace in your browser
2. Open browser DevTools console (F12)
3. Paste and run the following script:

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
    
    console.log(`✅ Downloaded DESK_LOOKUP.json with ${Object.keys(lookup).length} desks`);
})();
```

1. Save the downloaded file to your project directory

### Getting User Configuration from Browser

To get a new user's Appspace Token and Organizer ID:

1. Have the user log into Appspace in their browser
2. Open browser DevTools console (F12) or right click and click inspect
3. Go to the console tab
4. Paste and run:

```javascript
const getUser = () => {
    const jwt = sessionStorage.jwt;
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    return {
        token: payload.user.CurrentAccess.Token,
        userId: payload.user.UserId,
        email: payload.user.Username,
        name: payload.user.DisplayName
    };
};

const user = getUser();
console.log(`Name: ${user.name}`);
console.log(`Email: ${user.email}`);
console.log(`Appspace Token: ${user.token}`);
console.log(`Organizer ID: ${user.userId}`);
```

1. The user then adds this information to the Google Sheet

## Usage

### Manual Reservation

Reserve desks for a specific user:

```bash
export RESERVATION_USER="john.doe@disney.com"
./reserve.sh
```

Reserve desks for all users:

```bash
./reserve.sh
```

### Manual Check-in

Check in for a specific user:

```bash
export RESERVATION_USER="john.doe@disney.com"
./checkin.sh
```

Check in for all users:

```bash
./checkin.sh
```

### Fetch Users Only

Refresh `USER_CONFIGS.json` from the Google Sheet without running reservations:

```bash
./fetch_users.sh
```

### Testing Configuration

Before deploying, validate your `USER_CONFIGS`:

```bash
./test_user_configs.sh
```

This script validates:

- ✅ JSON format is valid
- ✅ All required fields are present
- ✅ DESK_NAME resolves correctly in DESK_LOOKUP.json
- ✅ Email and UUID formats are correct
- ✅ Compatibility with scripts

## GitHub Actions Setup

### Required Secrets

Configure the following secrets in your GitHub repository (Settings → Secrets and variables → Actions):

1. **`APPSPACE_HOST`**: Your Appspace API endpoint

   ```
   https://disney.cloud.appspace.com
   ```

2. **`BOOKING_START_UTC`** / **`BOOKING_END_UTC`**: 9 to 5 Eastern. Use `09:00` and `17:00` for DST-aware conversion, or `14:00:00.000Z` / `22:00:00.000Z` for literal UTC (EST only).

3. **`GOOGLE_SHEET_ID`**: The ID of your public Google Sheet

   ```
   1WkSm3QjQyuWviPcpgH1H3adxKpV4v3pKu4_LjVTosJk
   ```

> **Note:** The `USER_CONFIGS` secret is no longer needed. User data is fetched dynamically from the Google Sheet at runtime.

### Workflows

#### Reservation Workflow (`.github/workflows/reservation.yml`)

- **Schedule**: Runs at 9:01 AM Eastern (Monday-Friday), aligned with 9–5 booking. Uses two cron times for DST:
  - `1 13 * * 1-5` (9:01 AM EDT, Mar–Nov)
  - `1 14 * * 1-5` (9:01 AM EST, Nov–Mar)
- **Function**: Reserves desks for the next 7 weekdays (booking times are DST-aware)
- **Manual Trigger**: Available via workflow_dispatch with optional user selection

#### Check-in Workflow (`.github/workflows/checkin.yml`)

- **Schedule**: Runs 15 min before 9:00 AM Eastern (Monday-Friday), aligned with 9–5 booking. Uses two cron times for DST:
  - `45 12 * * 1-5` (8:45 AM EDT, Mar–Nov)
  - `45 13 * * 1-5` (8:45 AM EST, Nov–Mar)
- **Function**: Checks in for reservations within 15 minutes before/after start time
- **Manual Trigger**: Available via workflow_dispatch with optional user selection

### Manual Workflow Execution

You can manually trigger workflows from the GitHub Actions tab:

1. Go to **Actions** → Select workflow (Reservation or Check-in)
2. Click **Run workflow**
3. Optionally select a specific user or leave as "all" for all users
4. Click **Run workflow**

## File Structure

```
appspace-desk-reservations/
├── .github/
│   └── workflows/
│       ├── reservation.yml       # Automated reservation workflow
│       └── checkin.yml           # Automated check-in workflow
├── .env                          # Local environment variables (gitignored)
├── .env.example                  # Example environment variables template
├── .gitignore                    # Git ignore rules
├── checkin.sh                    # Check-in script
├── fetch_users.sh                # Fetches user data from Google Sheet
├── reserve.sh                    # Reservation script
├── test_user_configs.sh          # Configuration validation script
├── tests/
│   ├── run_tests.sh              # Run all tests
│   ├── test_time_conversion.sh   # Eastern-to-UTC conversion (DST)
│   ├── test_booking_utc_logic.sh # BOOKING_START_UTC/BOOKING_END_UTC resolution
│   ├── test_fetch_users.sh       # CSV parsing logic
│   └── fixtures/
│       └── sample_sheet.csv      # Test fixture for fetch_users
├── DESK_LOOKUP.json              # Desk name → resource ID mapping
├── USER_CONFIGS.example.json     # Example user configuration template
├── USER_CONFIGS.json             # Auto-generated from Google Sheet (gitignored)
└── README.md                     # This file
```

## How It Works

### User Data Flow

1. Users add their data to the shared Google Sheet
2. `fetch_users.sh` downloads the sheet as CSV and converts it to `USER_CONFIGS.json`
3. `reserve.sh` and `checkin.sh` call `fetch_users.sh` before loading configs
4. If the fetch fails, scripts fall back to the existing `USER_CONFIGS.json`

### Reservation Process

1. Script fetches latest user configs from Google Sheet
2. Script loads desk mappings from `DESK_LOOKUP.json`
3. For each user (or selected user):
   - Resolves `DESK_NAME` to resource ID via lookup
   - Loops through next 7 days
   - Skips weekends (Saturday/Sunday)
   - Attempts to reserve desk for each weekday
   - Uses configured booking time range
4. Logs all reservation attempts to `desk_reservation.log`

### Check-in Process

1. Script fetches latest user configs from Google Sheet
2. Script loads desk mappings from `DESK_LOOKUP.json`
3. For each user (or selected user):
   - Resolves `DESK_NAME` to resource ID via lookup
   - Fetches today's reservations from Appspace API
   - Filters events that need check-in:
     - Status: NotConfirmed, Pending, or Checkin
     - Within 15 minutes before/after start time
   - Automatically checks in for matching events
4. Logs all check-in attempts to `desk_checkin.log`

## Troubleshooting

### "jq is required" Error

Install `jq`:

```bash
brew install jq  # macOS
sudo apt-get install jq  # Linux
```

### "Missing GOOGLE_SHEET_ID"

Set `GOOGLE_SHEET_ID` in your `.env` file or export it:

```bash
export GOOGLE_SHEET_ID="your-sheet-id-here"
```

### "Failed to fetch Google Sheet"

- Verify the Google Sheet is publicly accessible (Share → Anyone with the link)
- Check your internet connection
- Verify the `GOOGLE_SHEET_ID` is correct

### "USER_CONFIGS is not valid JSON"

- Ensure `USER_CONFIGS.json` is valid JSON
- Run `./fetch_users.sh` to regenerate it from the Google Sheet
- Run `./test_user_configs.sh` to validate

### "User 'X' not found in USER_CONFIGS"

- Verify the user exists in the Google Sheet
- Ensure the user has all required fields filled in (especially Organizer ID)
- Run `./fetch_users.sh` and check for SKIPPED messages

### "Desk 'X' not found in DESK_LOOKUP"

- Verify the desk name is correct (case-sensitive)
- Ensure `DESK_LOOKUP.json` exists and contains the desk
- Re-export `DESK_LOOKUP.json` if desk was recently added

### Reservations Not Working

- Verify `APPSPACE_TOKEN` is valid and not expired
- Check `DESK_NAME` exists in `DESK_LOOKUP.json`
- Use `BOOKING_START_UTC="09:00"` and `BOOKING_END_UTC="17:00"` for DST-aware 9–5 Eastern
- Check `desk_reservation.log` for error messages

### Check-ins Not Working

- Verify reservation exists in Appspace
- Check that reservation start time is within check-in window (15 min before/after)
- Ensure reservation status allows check-in (NotConfirmed, Pending, or Checkin)
- Check `desk_checkin.log` for error messages

### GitHub Actions Failures

- Verify all required secrets are set (`APPSPACE_HOST`, `BOOKING_START_UTC`, `BOOKING_END_UTC`, `GOOGLE_SHEET_ID`)
- Ensure `DESK_LOOKUP.json` is committed to the repository
- Review workflow logs in GitHub Actions tab

## Security Notes

- ⚠️ **Never commit** `USER_CONFIGS.json` or `.env` files (already in `.gitignore`)
- ⚠️ Keep API tokens secure and rotate them regularly
- ⚠️ Use GitHub Secrets for sensitive configuration in CI/CD
- ⚠️ The Google Sheet contains tokens — keep the audience limited even if publicly readable
- ✅ `DESK_LOOKUP.json` is safe to commit (contains only desk names and IDs)
- ✅ `.env.example` is safe to commit (contains no real values)

## Running Tests

```bash
./tests/run_tests.sh
```

Tests cover:
- **Time conversion**: Eastern-to-UTC conversion and DST handling
- **Booking UTC logic**: HH:MM vs literal UTC format resolution
- **fetch_users**: CSV parsing and skip logic

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `./tests/run_tests.sh` and `./test_user_configs.sh`
5. Submit a pull request

## License

[Add your license here]

## Support

For issues or questions, please open an issue on GitHub.

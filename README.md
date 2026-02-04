# Appspace Desk Reservations

Automated desk reservation and check-in system for Appspace. This project automatically reserves desks Monday through Friday and handles check-ins for scheduled reservations.

## Features

- 🤖 **Automated Reservations**: Automatically reserves desks for weekdays (Monday-Friday) up to 7 days in advance
- ✅ **Auto Check-in**: Automatically checks in for reservations within a 15-minute window before/after start time
- 👥 **Multi-User Support**: Manage multiple users with individual desk assignments
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
   chmod +x reserve.sh checkin.sh test_user_configs.sh
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

Create a `.env` file in the project root with the following variables:

```bash
# Appspace API endpoint
APPSPACE_HOST="https://disney.cloud.appspace.com"

# Booking time range (UTC)
BOOKING_START_UTC="14:00:00.000Z"  # 9:00 AM Eastern
BOOKING_END_UTC="22:00:00.000Z"     # 5:00 PM Eastern

# User configurations (JSON string - see USER_CONFIGS section)
USER_CONFIGS='{"user1@disney.com":{"APPSPACE_TOKEN":"...","DESK_NAME":"08W-125-H","ORGANIZER_ID":"...","ORGANIZER_NAME":"...","ORGANIZER_EMAIL":"..."}}'
```

### USER_CONFIGS Format

`USER_CONFIGS` is a JSON object containing user configurations. Each user requires:

- `APPSPACE_TOKEN`: Authentication token for the Appspace API
- `DESK_NAME`: Human-readable desk name (e.g., `08W-125-H`) - looked up in `DESK_LOOKUP.json`
- `ORGANIZER_ID`: User's organizer ID
- `ORGANIZER_NAME`: User's full name
- `ORGANIZER_EMAIL`: User's email address

**Example:**

```json
{
  "john.doe@disney.com": {
    "APPSPACE_TOKEN": "your-token-here",
    "DESK_NAME": "08W-125-H",
    "ORGANIZER_ID": "organizer-id",
    "ORGANIZER_NAME": "John Doe",
    "ORGANIZER_EMAIL": "john.doe@disney.com"
  },
  "jane.smith@disney.com": {
    "APPSPACE_TOKEN": "another-token",
    "DESK_NAME": "08W-126-A",
    "ORGANIZER_ID": "another-organizer-id",
    "ORGANIZER_NAME": "Jane Smith",
    "ORGANIZER_EMAIL": "jane.smith@disney.com"
  }
}
```

**Note:** For GitHub Actions, `USER_CONFIGS` must be a single-line JSON string (no newlines). Use `cat USER_CONFIGS.json | jq -c .` to get the single-line format.

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

4. Save the downloaded file to your project directory

### Getting User Configuration from Browser

To get a new user's configuration:

1. Have the user log into Appspace in their browser
2. Open browser DevTools console (F12)
3. Paste and run:

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
console.log(JSON.stringify({
    [user.email.toLowerCase()]: {
        "APPSPACE_TOKEN": user.token,
        "DESK_NAME": "REPLACE_WITH_DESK_NAME",
        "ORGANIZER_ID": user.userId,
        "ORGANIZER_NAME": user.name,
        "ORGANIZER_EMAIL": user.email
    }
}, null, 2));
```

4. Replace `REPLACE_WITH_DESK_NAME` with the user's desk name (e.g., `08W-125-H`)
5. Add the output to your `USER_CONFIGS.json`

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

2. **`BOOKING_START_UTC`**: Reservation start time in UTC

   ```
   14:00:00.000Z
   ```

3. **`BOOKING_END_UTC`**: Reservation end time in UTC

   ```
   22:00:00.000Z
   ```

4. **`USER_CONFIGS`**: Single-line JSON string with all user configurations

   ```bash
   # Get single-line format:
   cat USER_CONFIGS.json | jq -c .
   ```

   **Important:** Paste the JSON string directly without quotes. The workflow adds quotes automatically.

### Workflows

#### Reservation Workflow (`.github/workflows/reservation.yml`)

- **Schedule**: Runs at 9:01 AM Eastern (Monday-Friday)
  - Winter (EST): `1 14 * * 1-5`
  - Summer (EDT): `1 13 * * 1-5`
- **Function**: Reserves desks for the next 7 weekdays
- **Manual Trigger**: Available via workflow_dispatch with optional user selection

#### Check-in Workflow (`.github/workflows/checkin.yml`)

- **Schedule**: Runs at 8:48 AM Eastern (Monday-Friday)
  - Cron: `48 13 * * 1-5`
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
├── .gitignore                    # Git ignore rules
├── checkin.sh                    # Check-in script
├── reserve.sh                    # Reservation script
├── test_user_configs.sh          # Configuration validation script
├── DESK_LOOKUP.json              # Desk name → resource ID mapping
├── USER_CONFIGS.example.json     # Example user configuration template
├── USER_CONFIGS.json             # Actual user configurations (gitignored)
├── desk_checkin.log              # Check-in activity log (gitignored)
└── desk_reservation.log          # Reservation activity log (gitignored)
```

## How It Works

### Reservation Process

1. Script loads user configurations from `USER_CONFIGS`
2. Script loads desk mappings from `DESK_LOOKUP.json`
3. For each user (or selected user):
   - Resolves `DESK_NAME` to resource ID via lookup
   - Loops through next 7 days
   - Skips weekends (Saturday/Sunday)
   - Attempts to reserve desk for each weekday
   - Uses configured booking time range
4. Logs all reservation attempts to `desk_reservation.log`

### Check-in Process

1. Script loads user configurations from `USER_CONFIGS`
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

### "USER_CONFIGS is not valid JSON"

- Ensure `USER_CONFIGS` is valid JSON
- For GitHub secrets, use single-line format: `cat USER_CONFIGS.json | jq -c .`
- Run `./test_user_configs.sh` to validate

### "User 'X' not found in USER_CONFIGS"

- Verify the user key exists in your `USER_CONFIGS`
- Check spelling/case sensitivity
- List available users: `echo "$USER_CONFIGS" | jq 'keys'`

### "Desk 'X' not found in DESK_LOOKUP"

- Verify the desk name is correct (case-sensitive)
- Ensure `DESK_LOOKUP.json` exists and contains the desk
- Re-export `DESK_LOOKUP.json` if desk was recently added

### Reservations Not Working

- Verify `APPSPACE_TOKEN` is valid and not expired
- Check `DESK_NAME` exists in `DESK_LOOKUP.json`
- Ensure booking times are in UTC format
- Check `desk_reservation.log` for error messages

### Check-ins Not Working

- Verify reservation exists in Appspace
- Check that reservation start time is within check-in window (15 min before/after)
- Ensure reservation status allows check-in (NotConfirmed, Pending, or Checkin)
- Check `desk_checkin.log` for error messages

### GitHub Actions Failures

- Verify all required secrets are set
- Check `USER_CONFIGS` secret format (must be single-line JSON)
- Ensure `DESK_LOOKUP.json` is committed to the repository
- Review workflow logs in GitHub Actions tab
- Ensure `jq` installation step completes successfully

## Security Notes

- ⚠️ **Never commit** `USER_CONFIGS.json` or `.env` files (already in `.gitignore`)
- ⚠️ Keep API tokens secure and rotate them regularly
- ⚠️ Use GitHub Secrets for sensitive configuration in CI/CD
- ⚠️ Review logs periodically for any unauthorized access
- ✅ `DESK_LOOKUP.json` is safe to commit (contains only desk names and IDs)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with `./test_user_configs.sh`
5. Submit a pull request

## License

[Add your license here]

## Support

For issues or questions, please open an issue on GitHub.

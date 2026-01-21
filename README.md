# Appspace Desk Reservations

Automated desk reservation and check-in system for Appspace. This project automatically reserves desks Monday through Friday and handles check-ins for scheduled reservations.

## Features

- 🤖 **Automated Reservations**: Automatically reserves desks for weekdays (Monday-Friday) up to 7 days in advance
- ✅ **Auto Check-in**: Automatically checks in for reservations within a 15-minute window before/after start time
- 👥 **Multi-User Support**: Manage multiple users with individual desk assignments
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
USER_CONFIGS='{"user1":{"APPSPACE_TOKEN":"...","RESOURCE_ID":"...","ORGANIZER_ID":"...","ORGANIZER_NAME":"...","ORGANIZER_EMAIL":"..."}}'
```

### USER_CONFIGS Format

`USER_CONFIGS` is a JSON object containing user configurations. Each user requires:

- `APPSPACE_TOKEN`: Authentication token for the Appspace API
- `RESOURCE_ID`: Desk/resource ID to reserve
- `ORGANIZER_ID`: User's organizer ID
- `ORGANIZER_NAME`: User's full name
- `ORGANIZER_EMAIL`: User's email address

**Example:**

```json
{
  "user1": {
    "APPSPACE_TOKEN": "your-token-here",
    "RESOURCE_ID": "desk-resource-id",
    "ORGANIZER_ID": "organizer-id",
    "ORGANIZER_NAME": "John Doe",
    "ORGANIZER_EMAIL": "john.doe@disney.com"
  },
  "user2": {
    "APPSPACE_TOKEN": "another-token",
    "RESOURCE_ID": "another-desk-id",
    "ORGANIZER_ID": "another-organizer-id",
    "ORGANIZER_NAME": "Jane Smith",
    "ORGANIZER_EMAIL": "jane.smith@disney.com"
  }
}
```

**Note:** For GitHub Actions, `USER_CONFIGS` must be a single-line JSON string (no newlines). Use `cat USER_CONFIGS.json | jq -c .` to get the single-line format.

### Getting User Configuration from Browser

To get your user configuration:

1. Open browser DevTools (F12)
2. Navigate to Appspace and make a desk reservation
3. Find the reservation API call in Network tab
4. Extract from the request:
   - `token` header → `APPSPACE_TOKEN`
   - `resourceIds` in request body → `RESOURCE_ID`
   - `organizer.id` → `ORGANIZER_ID`
   - `organizer.name` → `ORGANIZER_NAME`
   - `attendees[0].email` → `ORGANIZER_EMAIL`

## Usage

### Manual Reservation

Reserve desks for a specific user:

```bash
export RESERVATION_USER="user1"
./reserve.sh
```

Reserve desks for all users:

```bash
./reserve.sh
```

### Manual Check-in

Check in for a specific user:

```bash
export RESERVATION_USER="user1"
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
│       ├── reservation.yml    # Automated reservation workflow
│       └── checkin.yml         # Automated check-in workflow
├── .env                        # Local environment variables (gitignored)
├── .gitignore                  # Git ignore rules
├── checkin.sh                  # Check-in script
├── reserve.sh                  # Reservation script
├── test_user_configs.sh        # Configuration validation script
├── USER_CONFIGS.example.json   # Example user configuration template
├── USER_CONFIGS.json           # Actual user configurations (gitignored)
├── desk_checkin.log            # Check-in activity log (gitignored)
└── desk_reservation.log        # Reservation activity log (gitignored)
```

## How It Works

### Reservation Process

1. Script loads user configurations from `USER_CONFIGS`
2. For each user (or selected user):
   - Loops through next 7 days
   - Skips weekends (Saturday/Sunday)
   - Attempts to reserve desk for each weekday
   - Uses configured booking time range
3. Logs all reservation attempts to `desk_reservation.log`

### Check-in Process

1. Script loads user configurations from `USER_CONFIGS`
2. For each user (or selected user):
   - Fetches today's reservations from Appspace API
   - Filters events that need check-in:
     - Status: NotConfirmed, Pending, or Checkin
     - Within 15 minutes before/after start time
   - Automatically checks in for matching events
3. Logs all check-in attempts to `desk_checkin.log`

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

### Reservations Not Working

- Verify `APPSPACE_TOKEN` is valid and not expired
- Check `RESOURCE_ID` matches your desk ID
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
- Review workflow logs in GitHub Actions tab
- Ensure `jq` installation step completes successfully

## Security Notes

- ⚠️ **Never commit** `USER_CONFIGS.json` or `.env` files (already in `.gitignore`)
- ⚠️ Keep API tokens secure and rotate them regularly
- ⚠️ Use GitHub Secrets for sensitive configuration in CI/CD
- ⚠️ Review logs periodically for any unauthorized access

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

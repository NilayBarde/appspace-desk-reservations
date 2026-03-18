#!/usr/bin/env bash

# Auto-reserve desk Monday through Friday when days become available

# Load .env file
CONFIG_FILE=".env"
if [[ -f "$CONFIG_FILE" ]]; then
  echo "Loading environment from $CONFIG_FILE" >&2
  set -o allexport
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] && eval "export $line"
  done < "$CONFIG_FILE"
  set +o allexport
fi

LOG_FILE="./desk_reservation.log"

# Desk lookup file path
DESK_LOOKUP_FILE="./DESK_LOOKUP.json"

# Fetch user configs from Google Sheet
FETCH_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/fetch_users.sh"
USER_CONFIGS_FILE="./USER_CONFIGS.json"
: "${GOOGLE_SHEET_ID:?Missing GOOGLE_SHEET_ID - set it in .env or as an environment variable}"
"$FETCH_SCRIPT" "$USER_CONFIGS_FILE"
USER_CONFIGS=$(cat "$USER_CONFIGS_FILE")
echo "Loaded USER_CONFIGS from $USER_CONFIGS_FILE" >&2

# Helper function to extract and export user config from USER_CONFIGS
load_user_config() {
  local user="$1"
  local user_config=$(echo "$USER_CONFIGS" | jq -r ".\"$user\"")
  
  if [[ "$user_config" == "null" ]] || [[ -z "$user_config" ]]; then
    echo "Error: User '$user' not found in USER_CONFIGS" >&2
    return 1
  fi
  
  export APPSPACE_TOKEN=$(echo "$user_config" | jq -r '.APPSPACE_TOKEN // empty')
  export ORGANIZER_ID=$(echo "$user_config" | jq -r '.ORGANIZER_ID // empty')
  export ORGANIZER_NAME=$(echo "$user_config" | jq -r '.ORGANIZER_NAME // empty')
  export ORGANIZER_EMAIL=$(echo "$user_config" | jq -r '.ORGANIZER_EMAIL // empty')
  export BOOKING_DAYS=$(echo "$user_config" | jq -r '.BOOKING_DAYS // "Tue,Wed,Thu"')

  # Look up RESOURCE_ID from desk name (read directly from file to avoid env size limits)
  local desk_name=$(echo "$user_config" | jq -r '.DESK_NAME // empty')
  if [[ -n "$desk_name" ]]; then
    if [[ ! -f "$DESK_LOOKUP_FILE" ]]; then
      echo "Error: DESK_LOOKUP.json not found. Ensure it exists." >&2
      return 1
    fi
    export RESOURCE_ID=$(jq -r ".\"$desk_name\" // empty" "$DESK_LOOKUP_FILE")
    if [[ -z "$RESOURCE_ID" ]]; then
      echo "Error: Desk '$desk_name' not found in DESK_LOOKUP" >&2
      return 1
    fi
    echo "Resolved desk '$desk_name' to resource ID: $RESOURCE_ID" >&2
  else
    # Fallback: support legacy RESOURCE_ID for backwards compatibility
    export RESOURCE_ID=$(echo "$user_config" | jq -r '.RESOURCE_ID // empty')
  fi
  
  # Validate required fields
  : "${APPSPACE_TOKEN:?Missing APPSPACE_TOKEN for user $user}"
  : "${RESOURCE_ID:?Missing RESOURCE_ID for user $user}"
  : "${ORGANIZER_ID:?Missing ORGANIZER_ID for user $user}"
  : "${ORGANIZER_NAME:?Missing ORGANIZER_NAME for user $user}"
  : "${ORGANIZER_EMAIL:?Missing ORGANIZER_EMAIL for user $user}"
  
  return 0
}

# Convert Eastern time (HH:MM or HH:MM:SS) to UTC for a given date. Handles DST automatically.
# Supports both GNU date (Linux, GitHub Actions) and BSD date (macOS).
get_utc_time_for_eastern() {
  local date="$1"
  local eastern_time="$2"
  local result

  # Normalize to HH:MM (strip whitespace, newlines, and seconds for consistent parsing)
  eastern_time="${eastern_time//[$' \t\n\r']/}"
  if [[ "$eastern_time" =~ ^([0-9]{1,2}):([0-9]{2}) ]]; then
    eastern_time="${BASH_REMATCH[1]}:${BASH_REMATCH[2]}"
  fi

  # GNU date (Linux, GitHub Actions) - TZ in date string is the correct syntax
  if result=$(date -d "TZ=\"America/New_York\" ${date} ${eastern_time}" -u +%H:%M:00.000Z 2>/dev/null); then
    echo "$result"
    return
  fi

  # Fallback: alternate GNU date timezone syntax
  if result=$(date -d "${date} ${eastern_time} America/New_York" -u +%H:%M:00.000Z 2>/dev/null); then
    echo "$result"
    return
  fi

  # BSD date (macOS)
  local epoch
  if epoch=$(TZ=America/New_York date -j -f "%Y-%m-%d %H:%M" "${date} ${eastern_time}" +%s 2>/dev/null); then
    result=$(date -r "$epoch" -u +%H:%M:00.000Z 2>/dev/null)
    if [[ -n "$result" ]]; then
      echo "$result"
      return
    fi
  fi

  return 1
}

# Define reservation functions
reserve_day() {
  local date="$1"
  echo "Attempting reservation for $date" | tee -a "$LOG_FILE"

  # Compute UTC times. BOOKING_START_UTC/BOOKING_END_UTC: use "09:00"/"17:00" for 9-5 Eastern (DST-aware),
  # or "14:00:00.000Z"/"22:00:00.000Z" for literal UTC. Each value is handled independently.
  local booking_start_utc
  local booking_end_utc
  local start_val="${BOOKING_START_UTC:-09:00}"
  local end_val="${BOOKING_END_UTC:-17:00}"

  if [[ "$start_val" == *"Z"* ]]; then
    booking_start_utc="$start_val"
  else
    booking_start_utc=$(get_utc_time_for_eastern "$date" "$start_val")
    if [[ -z "$booking_start_utc" ]]; then
      echo "ERROR: Failed to convert BOOKING_START_UTC '$start_val' to UTC for $date. Use HH:MM (e.g. 09:00) or full UTC (e.g. 14:00:00.000Z)." | tee -a "$LOG_FILE" >&2
      return 1
    fi
  fi

  if [[ "$end_val" == *"Z"* ]]; then
    booking_end_utc="$end_val"
  else
    booking_end_utc=$(get_utc_time_for_eastern "$date" "$end_val")
    if [[ -z "$booking_end_utc" ]]; then
      echo "ERROR: Failed to convert BOOKING_END_UTC '$end_val' to UTC for $date. Use HH:MM (e.g. 17:00) or full UTC (e.g. 22:00:00.000Z)." | tee -a "$LOG_FILE" >&2
      return 1
    fi
  fi

  local response
  response=$(curl -s --location "$APPSPACE_HOST/api/v3/reservation/reservations" \
    --header "content-type: application/json;charset=UTF-8" \
    --header "accept: application/json" \
    --header "token: $APPSPACE_TOKEN" \
    --data-raw "{
      \"resourceIds\": [\"$RESOURCE_ID\"],
      \"effectiveStartAt\": \"${date}T${booking_start_utc}\",
      \"effectiveEndAt\": \"${date}T${booking_end_utc}\",
      \"organizer\": {
        \"id\": \"$ORGANIZER_ID\",
        \"name\": \"$ORGANIZER_NAME\"
      },
      \"sensitivity\": \"Public\",
      \"organizerAvailabilityType\": \"Busy\",
      \"attendees\": [
        {
          \"displayName\": \"$ORGANIZER_NAME\",
          \"email\": \"$ORGANIZER_EMAIL\",
          \"resourceIds\": [\"$RESOURCE_ID\"],
          \"attendanceType\": \"InPerson\",
          \"userId\": \"$ORGANIZER_ID\",
          \"id\": \"$ORGANIZER_ID\"
        }
      ],
      \"visitors\": [],
      \"visitPurpose\": \"\",
      \"isAllDay\": false,
      \"startTimeZone\": \"America/New_York\",
      \"endTimeZone\": \"America/New_York\"
    }")

  # Check for API errors in response
  local error_code
  error_code=$(echo "$response" | jq -r '.Code // empty' 2>/dev/null)

  if [[ -n "$error_code" ]]; then
    local error_message
    error_message=$(echo "$response" | jq -r '.Message // "Unknown error"' 2>/dev/null)
    echo "ERROR: $date - $error_code: $error_message" | tee -a "$LOG_FILE" >&2
    return 1
  fi

  # Check for "already reserved" message (not an error)
  local info_message
  info_message=$(echo "$response" | jq -r '.message // empty' 2>/dev/null)

  if [[ -n "$info_message" ]]; then
    echo "SKIPPED: $date - $info_message" | tee -a "$LOG_FILE"
  else
    echo "SUCCESS: $date - Reserved" | tee -a "$LOG_FILE"
  fi
  echo "-----" | tee -a "$LOG_FILE"
}

run_reservations() {
  local error_count=0
  local attempt_count=0

  # Map day-of-week numbers to 3-letter abbreviations
  local -A DAY_NAMES=([1]="Mon" [2]="Tue" [3]="Wed" [4]="Thu" [5]="Fri" [6]="Sat" [7]="Sun")

  # 2026 company holidays (YYYY-MM-DD)
  local HOLIDAYS=(
    "2026-01-01"  # New Year's Day
    "2026-01-19"  # Martin Luther King, Jr. Day
    "2026-02-16"  # President's Day
    "2026-05-25"  # Memorial Day
    "2026-06-19"  # Juneteenth
    "2026-07-03"  # Independence Day
    "2026-09-07"  # Labor Day
    "2026-11-26"  # Thanksgiving Day
    "2026-11-27"  # Day after Thanksgiving
    "2026-12-24"  # Christmas Eve
    "2026-12-25"  # Christmas Day
    "2026-12-31"  # New Year's Eve
  )

  echo "Booking days: $BOOKING_DAYS" | tee -a "$LOG_FILE"

  # Loop through 7 upcoming days and book only matching days
  for i in {0..7}; do
    DATE=$(date -v+"${i}"d +%Y-%m-%d 2>/dev/null || date -d "+${i} days" +%Y-%m-%d)
    DAY_OF_WEEK=$(date -d "$DATE" +%u 2>/dev/null || date -j -f "%Y-%m-%d" "$DATE" +%u)
    DAY_NAME="${DAY_NAMES[$DAY_OF_WEEK]}"

    if [[ "$DAY_OF_WEEK" -ge 6 ]]; then
      echo "Skipping weekend: $DATE" | tee -a "$LOG_FILE"
    elif [[ " ${HOLIDAYS[*]} " == *" $DATE "* ]]; then
      echo "Skipping holiday: $DATE" | tee -a "$LOG_FILE"
    elif [[ ",$BOOKING_DAYS," == *",$DAY_NAME,"* ]]; then
      ((attempt_count++))
      if ! reserve_day "$DATE"; then
        ((error_count++))
      fi
      sleep 2
    else
      echo "Skipping $DAY_NAME ($DATE) - not in booking days" | tee -a "$LOG_FILE"
    fi
  done

  if [[ "$error_count" -gt 0 ]]; then
    echo "FAILED: $error_count/$attempt_count reservation(s) failed" | tee -a "$LOG_FILE" >&2
    return 1
  fi
}

# If USER_CONFIGS is set, extract user config from JSON
# Use RESERVATION_USER if set (explicit), otherwise run for all users
if [[ -n "$USER_CONFIGS" ]]; then
  # Check if jq is available
  if ! command -v jq &> /dev/null; then
    echo "Error: jq is required to parse USER_CONFIGS. Install with: brew install jq (macOS) or apt-get install jq (Linux)" >&2
    exit 1
  fi
  
  # Get list of all users from USER_CONFIGS
  ALL_USERS=$(echo "$USER_CONFIGS" | jq -r 'keys[]')
  
  # Determine which user(s) to process
  # Priority: RESERVATION_USER > USER (if valid) > all users
  SELECTED_USER=""
  
  if [[ -n "$RESERVATION_USER" ]]; then
    # RESERVATION_USER explicitly set
    if echo "$ALL_USERS" | grep -q "^${RESERVATION_USER}$"; then
      SELECTED_USER="$RESERVATION_USER"
    else
      echo "Error: User '$RESERVATION_USER' not found in USER_CONFIGS" >&2
      echo "Available users:" >&2
      echo "$ALL_USERS" | sed 's/^/  - /' >&2
      exit 1
    fi
  elif [[ -n "$USER" ]] && echo "$ALL_USERS" | grep -q "^${USER}$"; then
    # USER is set and matches a valid user in config
    SELECTED_USER="$USER"
  fi
  
  # If no valid user selected, run for all users
  if [[ -z "$SELECTED_USER" ]]; then
    echo "No user specified - running for all users:" >&2
    echo "$ALL_USERS" | sed 's/^/  - /' >&2
    echo "" >&2
    
    FAILED_USERS=0
    
    # Loop through each user and run reservations
    for CURRENT_USER in $ALL_USERS; do
      echo "========================================" >&2
      echo "Processing user: $CURRENT_USER" >&2
      echo "========================================" >&2
      
      # Load user config
      if ! load_user_config "$CURRENT_USER"; then
        ((FAILED_USERS++))
        continue
      fi
      
      echo "Loaded config for user: $CURRENT_USER ($ORGANIZER_NAME)" >&2
      
      # Run reservations for this user
      if ! run_reservations; then
        ((FAILED_USERS++))
      fi
      
      echo "" >&2
    done
    
    # Exit with failure if any user had errors
    exit "$FAILED_USERS"
  else
    # Single user specified - load their config
    if ! load_user_config "$SELECTED_USER"; then
      exit 1
    fi
    echo "Loaded config for user: $SELECTED_USER ($ORGANIZER_NAME)" >&2
  fi
fi

# Ensure required base environment variables exist
: "${APPSPACE_HOST:?Missing APPSPACE_HOST}"
# BOOKING_START_UTC / BOOKING_END_UTC: "09:00"/"17:00" for 9-5 Eastern (DST-aware), or full UTC e.g. "14:00:00.000Z"
: "${BOOKING_START_UTC:?Missing BOOKING_START_UTC - use 09:00 for 9 AM Eastern or 14:00:00.000Z for literal UTC}"
: "${BOOKING_END_UTC:?Missing BOOKING_END_UTC - use 17:00 for 5 PM Eastern or 22:00:00.000Z for literal UTC}"

# Run reservations for single user mode
if [[ -n "$SELECTED_USER" ]]; then
  run_reservations
  exit $?
fi

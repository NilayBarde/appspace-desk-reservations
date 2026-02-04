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

# Define reservation functions
reserve_day() {
  local date="$1"
  echo "Attempting reservation for $date" | tee -a "$LOG_FILE"

  curl --location "$APPSPACE_HOST/api/v3/reservation/reservations" \
    --header "content-type: application/json;charset=UTF-8" \
    --header "accept: application/json" \
    --header "token: $APPSPACE_TOKEN" \
    --data-raw "{
      \"resourceIds\": [\"$RESOURCE_ID\"],
      \"effectiveStartAt\": \"${date}T${BOOKING_START_UTC}\",
      \"effectiveEndAt\": \"${date}T${BOOKING_END_UTC}\",
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
    }"

  echo "-----" | tee -a "$LOG_FILE"
}

run_reservations() {
  # Loop through 7 upcoming days and book only weekdays (Mon–Fri)
  for i in {0..7}; do
    DATE=$(date -v+"${i}"d +%Y-%m-%d 2>/dev/null || date -d "+${i} days" +%Y-%m-%d)
    DAY_OF_WEEK=$(date -d "$DATE" +%u 2>/dev/null || date -j -f "%Y-%m-%d" "$DATE" +%u)

    if [[ "$DAY_OF_WEEK" -ge 1 && "$DAY_OF_WEEK" -le 5 ]]; then
      reserve_day "$DATE"
      sleep 2
    else
      echo "Skipping weekend: $DATE" | tee -a "$LOG_FILE"
    fi
  done
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
    
    # Loop through each user and run reservations
    for CURRENT_USER in $ALL_USERS; do
      echo "========================================" >&2
      echo "Processing user: $CURRENT_USER" >&2
      echo "========================================" >&2
      
      # Load user config
      if ! load_user_config "$CURRENT_USER"; then
        continue
      fi
      
      echo "Loaded config for user: $CURRENT_USER ($ORGANIZER_NAME)" >&2
      
      # Run reservations for this user
      run_reservations
      
      echo "" >&2
    done
    
    # Exit after processing all users
    exit 0
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
: "${BOOKING_START_UTC:?Missing BOOKING_START_UTC}"
: "${BOOKING_END_UTC:?Missing BOOKING_END_UTC}"

# Run reservations for single user mode
if [[ -n "$SELECTED_USER" ]]; then
  run_reservations
fi

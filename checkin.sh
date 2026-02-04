#!/usr/bin/env bash

# Auto-check-in for today's reservations
# Checks in events between 15 minutes before and 15 minutes after start time
# Job runs at 12 minutes before start (e.g., 8:48am for 9:00am reservation)

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

LOG_FILE="./desk_checkin.log"

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
  else
    # Fallback: support legacy RESOURCE_ID for backwards compatibility
    export RESOURCE_ID=$(echo "$user_config" | jq -r '.RESOURCE_ID // empty')
  fi
  
  : "${APPSPACE_TOKEN:?Missing APPSPACE_TOKEN for user $user}"
  : "${RESOURCE_ID:?Missing RESOURCE_ID for user $user}"
  
  return 0
}

# Ensure required base environment variables exist
: "${APPSPACE_HOST:?Missing APPSPACE_HOST}"

# Check-in function for a single user
checkin_for_user() {
  local user="$1"
  
  echo "========================================" | tee -a "$LOG_FILE"
  echo "Checking in for user: $user at $(date -u +"%Y-%m-%dT%H:%M:%S.000Z")" | tee -a "$LOG_FILE"
  echo "========================================" | tee -a "$LOG_FILE"
  
  # Load user config
  if ! load_user_config "$user"; then
    echo "Error: Failed to load config for user $user" | tee -a "$LOG_FILE"
    return 1
  fi
  
  # Fetch today's reservations
  today=$(date -u +"%Y-%m-%d")
  start_at="${today}T05:00:00.000Z"
  end_at="${today}T23:59:59.999Z"
  
  events_json=$(curl -s "$APPSPACE_HOST/api/v3/reservation/users/me/events?sort=startAt&status=NotConfirmed%2C%20Pending%2C%20Checkin%2C%20Active&includesourceobject=true&startAt=${start_at}&endAt=${end_at}&page=1&start=0&limit=20&pagecount=20" \
    -H "accept: application/json, text/plain, */*" \
    -H "token: $APPSPACE_TOKEN" \
    -H "x-appspace-request-timezone: America/New_York")
  
  # Calculate current time in seconds since epoch
  now_epoch=$(date -u +%s)
  
  # Extract events that need check-in
  # Check-in window: between 15 minutes before and 15 minutes after start time (-900 to +900 seconds)
  # Skip events that are already checked in (status "Active" means already checked in)
  event_data=$(echo "$events_json" | jq --arg now "$now_epoch" '
    [.items[]? | 
    select(.status == "Checkin" or .status == "Pending" or .status == "NotConfirmed") |
    select(.status != "Active") |
    .startAt as $startAt |
    ($startAt | fromdateiso8601) as $startEpoch |
    (($now | tonumber) - $startEpoch) as $diffSeconds |
    select($diffSeconds >= -900 and $diffSeconds <= 900) |
    {id: .id, startAt: .startAt, resourceIds: .resourceIds, diffMinutes: ($diffSeconds / 60 | floor)}]
  ')
  
  event_ids=$(echo "$event_data" | jq -r '.[].id')
  
  if [[ -z "$event_ids" ]]; then
    event_count=$(echo "$events_json" | jq '.items | length')
    echo "No events found for check-in (need to be within 15 min before/after start and not already checked in). Found $event_count total events for today." | tee -a "$LOG_FILE"
    return 0
  fi
  
  event_count=$(echo "$event_ids" | wc -l | tr -d ' ')
  echo "Found $event_count event(s) ready for check-in (within 15 min before/after start)" | tee -a "$LOG_FILE"
  
  # Loop through events and check in
  for event_id in $event_ids; do
    event_info=$(echo "$event_data" | jq ".[] | select(.id == \"$event_id\")")
    start_at_time=$(echo "$event_info" | jq -r '.startAt')
    diff_minutes=$(echo "$event_info" | jq -r '.diffMinutes')
    
    if [[ $diff_minutes -lt 0 ]]; then
      time_desc="${diff_minutes#-} minutes before start"
    else
      time_desc="$diff_minutes minutes after start"
    fi
    echo "Checking in for event $event_id ($time_desc at $start_at_time)" | tee -a "$LOG_FILE"
    
    # Get resource IDs from event data, fallback to user's RESOURCE_ID
    resource_ids=$(echo "$event_info" | jq -r '.resourceIds')
    
    if [[ -z "$resource_ids" ]] || [[ "$resource_ids" == "null" ]] || [[ "$resource_ids" == "[]" ]]; then
      resource_ids="[\"$RESOURCE_ID\"]"
      echo "Using RESOURCE_ID from config: $RESOURCE_ID" | tee -a "$LOG_FILE"
    fi
    
    checkin_response=$(curl -s -X POST "$APPSPACE_HOST/api/v3/reservation/events/$event_id/checkin" \
      -H "accept: application/json" \
      -H "content-type: application/json;charset=UTF-8" \
      -H "token: $APPSPACE_TOKEN" \
      --data-raw "{\"resourceIds\": $resource_ids}")
    echo "Response: $checkin_response" | tee -a "$LOG_FILE"
    echo "-----" | tee -a "$LOG_FILE"
  done
}

# Main execution
echo "Running check-in at $(date -u +"%Y-%m-%dT%H:%M:%S.000Z")" | tee -a "$LOG_FILE"

# If USER_CONFIGS is set, support multiple users
if [[ -n "$USER_CONFIGS" ]]; then
  if ! command -v jq &> /dev/null; then
    echo "Error: jq is required to parse USER_CONFIGS. Install with: brew install jq (macOS) or apt-get install jq (Linux)" >&2
    exit 1
  fi
  
  ALL_USERS=$(echo "$USER_CONFIGS" | jq -r 'keys[]')
  
  # Determine which user(s) to process
  SELECTED_USER=""
  if [[ -n "$RESERVATION_USER" ]]; then
    if echo "$ALL_USERS" | grep -q "^${RESERVATION_USER}$"; then
      SELECTED_USER="$RESERVATION_USER"
    else
      echo "Error: User '$RESERVATION_USER' not found in USER_CONFIGS" >&2
      exit 1
    fi
  elif [[ -n "$USER" ]] && echo "$ALL_USERS" | grep -q "^${USER}$"; then
    SELECTED_USER="$USER"
  fi
  
  # If no valid user selected, run for all users
  if [[ -z "$SELECTED_USER" ]]; then
    echo "No user specified - checking in for all users:" | tee -a "$LOG_FILE"
    echo "$ALL_USERS" | sed 's/^/  - /' | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    
    for CURRENT_USER in $ALL_USERS; do
      checkin_for_user "$CURRENT_USER"
      echo "" | tee -a "$LOG_FILE"
    done
  else
    # Single user specified
    checkin_for_user "$SELECTED_USER"
  fi
else
  # Fallback to old behavior if USER_CONFIGS not set
  : "${APPSPACE_TOKEN:?Missing APPSPACE_TOKEN}"
  : "${RESOURCE_ID:?Missing RESOURCE_ID}"
  
  # Create a temporary user config for fallback mode
  export USER_CONFIGS="{\"fallback\":{\"APPSPACE_TOKEN\":\"$APPSPACE_TOKEN\",\"RESOURCE_ID\":\"$RESOURCE_ID\"}}"
  checkin_for_user "fallback"
fi

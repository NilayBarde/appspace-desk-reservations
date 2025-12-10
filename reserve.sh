#!/usr/bin/env bash

# Auto-reserve desk Monday through Friday when days become available

# Load local .env if it exists and variables aren't already set
CONFIG_FILE=".env"
if [[ -f "$CONFIG_FILE" ]]; then
  set -o allexport
  source "$CONFIG_FILE"
  set +o allexport
fi

# Ensure required environment variables exist
: "${APPSPACE_HOST:?Missing APPSPACE_HOST}"
: "${APPSPACE_TOKEN:?Missing APPSPACE_TOKEN}"
: "${RESOURCE_ID:?Missing RESOURCE_ID}"
: "${ORGANIZER_ID:?Missing ORGANIZER_ID}"
: "${ORGANIZER_NAME:?Missing ORGANIZER_NAME}"
: "${ORGANIZER_EMAIL:?Missing ORGANIZER_EMAIL}"
: "${BOOKING_START_UTC:?Missing BOOKING_START_UTC}"
: "${BOOKING_END_UTC:?Missing BOOKING_END_UTC}"

# Required environment variables:
#   APPSPACE_TOKEN
#   RESOURCE_ID
#   ORGANIZER_ID
#   ORGANIZER_NAME
#   ORGANIZER_EMAIL
#   BOOKING_START_UTC   (e.g. "14:00:00.000Z")
#   BOOKING_END_UTC     (e.g. "22:00:00.000Z")

LOG_FILE="./desk_reservation.log"

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

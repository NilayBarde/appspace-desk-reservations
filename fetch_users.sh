#!/usr/bin/env bash

# Fetch user configs from a public Google Sheet and convert to USER_CONFIGS.json
# The sheet must have columns: Name, Email, Desk, Appspace Token, Organizer ID
# Rows missing Organizer ID are skipped (required for reservations)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="${1:-$SCRIPT_DIR/USER_CONFIGS.json}"

# Load .env for GOOGLE_SHEET_ID if not already set
CONFIG_FILE="$SCRIPT_DIR/.env"
if [[ -z "${GOOGLE_SHEET_ID:-}" ]] && [[ -f "$CONFIG_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    if [[ "$line" =~ ^GOOGLE_SHEET_ID= ]]; then
      eval "export $line"
      break
    fi
  done < "$CONFIG_FILE"
fi

: "${GOOGLE_SHEET_ID:?Missing GOOGLE_SHEET_ID - set it in .env or as an environment variable}"

SHEET_URL="https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv"

echo "Fetching user configs from Google Sheet..." >&2

# Download CSV to a temp file
TEMP_CSV=$(mktemp)
trap 'rm -f "$TEMP_CSV"' EXIT

HTTP_CODE=$(curl -s -w "%{http_code}" -o "$TEMP_CSV" -L "$SHEET_URL")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "ERROR: Failed to fetch Google Sheet (HTTP $HTTP_CODE)" >&2
  exit 1
fi

# Verify we got CSV data (not an HTML error page)
if head -1 "$TEMP_CSV" | grep -qi "<!DOCTYPE\|<html"; then
  echo "ERROR: Google Sheet returned HTML instead of CSV. Is the sheet public?" >&2
  exit 1
fi

# Parse CSV and build USER_CONFIGS JSON
# Columns: Name, Email, Desk, Appspace Token, Organizer ID
# Skip header row, skip rows with empty Organizer ID
USER_JSON=$(awk -F',' '
BEGIN {
  first = 1
  printf "{"
}
NR == 1 { next }  # skip header
{
  # Strip surrounding quotes and whitespace from fields
  gsub(/^[[:space:]]*"?|"?[[:space:]]*$/, "", $1)  # Name
  gsub(/^[[:space:]]*"?|"?[[:space:]]*$/, "", $2)  # Email
  gsub(/^[[:space:]]*"?|"?[[:space:]]*$/, "", $3)  # Desk
  gsub(/^[[:space:]]*"?|"?[[:space:]]*$/, "", $4)  # Appspace Token
  gsub(/^[[:space:]]*"?|"?[[:space:]]*$/, "", $5)  # Organizer ID
  # Also strip carriage returns
  gsub(/\r/, "", $5)
  gsub(/\r/, "", $4)
  gsub(/\r/, "", $3)
  gsub(/\r/, "", $2)
  gsub(/\r/, "", $1)

  name = $1
  email = $2
  desk = $3
  token = $4
  org_id = $5

  # Skip empty rows
  if (email == "") next

  # Skip rows missing Organizer ID
  if (org_id == "") {
    printf "SKIPPED: %s (%s) - missing Organizer ID\n", name, email > "/dev/stderr"
    next
  }

  # Skip rows missing Appspace Token
  if (token == "") {
    printf "SKIPPED: %s (%s) - missing Appspace Token\n", name, email > "/dev/stderr"
    next
  }

  # Build email key (lowercase)
  key = tolower(email)

  if (!first) printf ","
  first = 0

  printf "\"%s\":{\"APPSPACE_TOKEN\":\"%s\",\"DESK_NAME\":\"%s\",\"ORGANIZER_ID\":\"%s\",\"ORGANIZER_NAME\":\"%s\",\"ORGANIZER_EMAIL\":\"%s\"}", key, token, desk, org_id, name, email
}
END {
  printf "}"
}
' "$TEMP_CSV")

# Validate JSON with jq
if ! echo "$USER_JSON" | jq . > /dev/null 2>&1; then
  echo "ERROR: Generated invalid JSON" >&2
  exit 1
fi

# Write compact JSON to output file
echo "$USER_JSON" | jq -c . > "$OUTPUT_FILE"

USER_COUNT=$(echo "$USER_JSON" | jq 'keys | length')
echo "SUCCESS: Wrote $USER_COUNT user(s) to $OUTPUT_FILE" >&2

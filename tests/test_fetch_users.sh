#!/usr/bin/env bash

# Tests for fetch_users.sh CSV parsing logic
# Uses a local fixture CSV instead of hitting Google Sheets

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_CSV="$SCRIPT_DIR/fixtures/sample_sheet.csv"
OUTPUT_JSON=$(mktemp)
trap 'rm -f "$OUTPUT_JSON"' EXIT

# Simulate the awk parsing from fetch_users.sh (same logic, different input source)
parse_csv_to_json() {
  local csv_file="$1"
  awk -F',' '
BEGIN { first = 1; printf "{" }
NR == 1 { next }
{
  gsub(/^[[:space:]]*"?|"?[[:space:]]*$/, "", $1)
  gsub(/^[[:space:]]*"?|"?[[:space:]]*$/, "", $2)
  gsub(/^[[:space:]]*"?|"?[[:space:]]*$/, "", $3)
  gsub(/^[[:space:]]*"?|"?[[:space:]]*$/, "", $4)
  gsub(/^[[:space:]]*"?|"?[[:space:]]*$/, "", $5)
  days = ""
  for (i = 6; i <= NF; i++) {
    if (i > 6) days = days ","
    days = days $i
  }
  gsub(/^[[:space:]]*"?|"?[[:space:]]*$/, "", days)
  gsub(/\r/, "", days)
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
  if (days == "") days = "Tue,Wed,Thu"
  if (email == "") next
  if (org_id == "") next
  if (token == "") next
  key = tolower(email)
  if (!first) printf ","
  first = 0
  printf "\"%s\":{\"APPSPACE_TOKEN\":\"%s\",\"DESK_NAME\":\"%s\",\"ORGANIZER_ID\":\"%s\",\"ORGANIZER_NAME\":\"%s\",\"ORGANIZER_EMAIL\":\"%s\",\"BOOKING_DAYS\":\"%s\"}", key, token, desk, org_id, name, email, days
}
END { printf "}" }
' "$csv_file"
}

TESTS_PASSED=0
TESTS_FAILED=0

echo "Testing fetch_users CSV parsing logic"
echo "======================================"

# Test 1: Parse fixture CSV
USER_JSON=$(parse_csv_to_json "$FIXTURE_CSV")
if echo "$USER_JSON" | jq . > /dev/null 2>&1; then
  echo "✓ Generated valid JSON"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo "✗ Generated invalid JSON"
  TESTS_FAILED=$((TESTS_FAILED + 1))
  exit 1
fi

# Test 2: Has expected users (lowercase email as key)
JOHN=$(echo "$USER_JSON" | jq -r '.["john@example.com"] // empty')
if [[ -n "$JOHN" ]]; then
  echo "✓ john@example.com present"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo "✗ john@example.com missing"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

JANE=$(echo "$USER_JSON" | jq -r '.["jane@example.com"] // empty')
if [[ -n "$JANE" ]]; then
  echo "✓ jane@example.com present"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo "✗ jane@example.com missing"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 3: Required fields present
for user in john@example.com jane@example.com; do
  for field in APPSPACE_TOKEN DESK_NAME ORGANIZER_ID ORGANIZER_NAME ORGANIZER_EMAIL BOOKING_DAYS; do
    VAL=$(echo "$USER_JSON" | jq -r ".\"$user\".$field // empty")
    if [[ -n "$VAL" ]]; then
      echo "✓ $user has $field"
      TESTS_PASSED=$((TESTS_PASSED + 1))
    else
      echo "✗ $user missing $field"
      TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
  done
done

# Test 4: Days column parsed correctly (Mon,Tue,Wed from first row)
JOHN_DAYS=$(echo "$USER_JSON" | jq -r '.["john@example.com"].BOOKING_DAYS')
if [[ "$JOHN_DAYS" == "Mon,Tue,Wed" ]]; then
  echo "✓ Days column parsed correctly for John"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo "✗ Days column wrong: expected 'Mon,Tue,Wed', got '$JOHN_DAYS'"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 5: Row with empty Organizer ID is skipped
echo ""
echo "Testing skip logic (empty Organizer ID)..."
SKIP_CSV=$(mktemp)
trap 'rm -f "$OUTPUT_JSON" "$SKIP_CSV"' EXIT
cat > "$SKIP_CSV" << 'EOF'
Name,Email,Desk,Appspace Token,Organizer ID,Days
Skip Me,skip@example.com,08W-999,,,Tue,Wed
Valid User,valid@example.com,08W-001,tok-1111-2222-3333-444455556666,org-1111-2222-3333-444455556666,Mon
EOF
SKIP_JSON=$(parse_csv_to_json "$SKIP_CSV")
SKIP_COUNT=$(echo "$SKIP_JSON" | jq 'keys | length')
if [[ "$SKIP_COUNT" -eq 1 ]] && echo "$SKIP_JSON" | jq -e '.["valid@example.com"]' > /dev/null 2>&1; then
  echo "✓ Rows with empty Organizer ID or Token are skipped"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo "✗ Skip logic failed: expected 1 user, got $SKIP_COUNT"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo ""
echo "======================================"
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
if [[ $TESTS_FAILED -gt 0 ]]; then
  exit 1
fi
exit 0

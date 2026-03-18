#!/usr/bin/env bash

# Tests for Eastern-to-UTC time conversion (DST-aware)
# Run: ./tests/test_time_conversion.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source the conversion function from reserve.sh by extracting it
# We define it here to avoid running the full reserve.sh
get_utc_time_for_eastern() {
  local date="$1"
  local eastern_time="$2"
  local result

  # GNU date (Linux, GitHub Actions) - TZ in date string is the correct syntax
  if result=$(date -d "TZ=\"America/New_York\" ${date} ${eastern_time}" -u +%H:%M:00.000Z 2>/dev/null); then
    echo "$result"
    return
  fi
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

TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
  local name="$1"
  local date="$2"
  local eastern_time="$3"
  local expected_pattern="$4"  # Regex pattern to match (e.g. "13:00:00.000Z" for EDT, "14:00:00.000Z" for EST)

  local result
  if result=$(get_utc_time_for_eastern "$date" "$eastern_time"); then
    if [[ "$result" =~ $expected_pattern ]]; then
      echo "✓ $name: $eastern_time Eastern on $date -> $result"
      TESTS_PASSED=$((TESTS_PASSED + 1))
      return 0
    else
      echo "✗ $name: expected pattern '$expected_pattern', got '$result'"
      TESTS_FAILED=$((TESTS_FAILED + 1))
      return 1
    fi
  else
    echo "✗ $name: get_utc_time_for_eastern failed"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

echo "Testing Eastern-to-UTC conversion (America/New_York)"
echo "===================================================="

# EDT dates (Mar 9 - Nov 1): 9:00 AM Eastern = 13:00 UTC, 5:00 PM Eastern = 21:00 UTC
run_test "9 AM EDT (summer)" "2025-03-18" "09:00" "^13:00:00\.000Z$"
run_test "5 PM EDT (summer)" "2025-03-18" "17:00" "^21:00:00\.000Z$"
run_test "9 AM EDT (July)" "2025-07-15" "09:00" "^13:00:00\.000Z$"

# EST dates (Nov - Mar): 9:00 AM Eastern = 14:00 UTC, 5:00 PM Eastern = 22:00 UTC
run_test "9 AM EST (winter)" "2026-01-15" "09:00" "^14:00:00\.000Z$"
run_test "5 PM EST (winter)" "2026-01-15" "17:00" "^22:00:00\.000Z$"
run_test "9 AM EST (December)" "2025-12-10" "09:00" "^14:00:00\.000Z$"

# Edge: DST transition day (March 9, 2025 - spring forward)
run_test "9 AM on DST start day" "2025-03-09" "09:00" "^13:00:00\.000Z$"

# Invalid input should fail
echo ""
echo "Testing invalid input handling..."
if get_utc_time_for_eastern "2025-03-18" "25:00" 2>/dev/null; then
  echo "✗ Invalid time 25:00 should have failed"
  TESTS_FAILED=$((TESTS_FAILED + 1))
else
  echo "✓ Invalid time 25:00 correctly rejected"
  TESTS_PASSED=$((TESTS_PASSED + 1))
fi

echo ""
echo "===================================================="
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
if [[ $TESTS_FAILED -gt 0 ]]; then
  exit 1
fi
exit 0

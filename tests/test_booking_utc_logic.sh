#!/usr/bin/env bash

# Tests for BOOKING_START_UTC/BOOKING_END_UTC format detection and resolution
# Simulates the logic in reserve.sh without making API calls

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Same function as reserve.sh
get_utc_time_for_eastern() {
  local date="$1"
  local eastern_time="$2"
  local result
  if result=$(date -d "TZ=\"America/New_York\" ${date} ${eastern_time}" -u +%H:%M:00.000Z 2>/dev/null); then
    echo "$result"
    return
  fi
  if result=$(date -d "${date} ${eastern_time} America/New_York" -u +%H:%M:00.000Z 2>/dev/null); then
    echo "$result"
    return
  fi
  local epoch
  if epoch=$(TZ=America/New_York date -j -f "%Y-%m-%d %H:%M" "${date} ${eastern_time}" +%s 2>/dev/null); then
    result=$(date -r "$epoch" -u +%H:%M:00.000Z 2>/dev/null)
    [[ -n "$result" ]] && echo "$result" && return
  fi
  return 1
}

# Simulate the booking UTC resolution logic from reserve_day
resolve_booking_utc() {
  local date="$1"
  local start_val="$2"
  local end_val="$3"
  local booking_start_utc
  local booking_end_utc

  if [[ "$start_val" == *"Z"* ]]; then
    booking_start_utc="$start_val"
  else
    booking_start_utc=$(get_utc_time_for_eastern "$date" "$start_val")
    [[ -z "$booking_start_utc" ]] && return 1
  fi

  if [[ "$end_val" == *"Z"* ]]; then
    booking_end_utc="$end_val"
  else
    booking_end_utc=$(get_utc_time_for_eastern "$date" "$end_val")
    [[ -z "$booking_end_utc" ]] && return 1
  fi

  echo "${booking_start_utc}|${booking_end_utc}"
}

TESTS_PASSED=0
TESTS_FAILED=0

assert_booking() {
  local name="$1"
  local date="$2"
  local start_val="$3"
  local end_val="$4"
  local expected_start="$5"
  local expected_end="$6"

  local result
  if result=$(resolve_booking_utc "$date" "$start_val" "$end_val"); then
    local got_start="${result%%|*}"
    local got_end="${result##*|}"
    if [[ "$got_start" == "$expected_start" ]] && [[ "$got_end" == "$expected_end" ]]; then
      echo "✓ $name"
      TESTS_PASSED=$((TESTS_PASSED + 1))
      return 0
    else
      echo "✗ $name: expected $expected_start|$expected_end, got $got_start|$got_end"
      TESTS_FAILED=$((TESTS_FAILED + 1))
      return 1
    fi
  else
    echo "✗ $name: resolve_booking_utc failed"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

echo "Testing BOOKING_START_UTC / BOOKING_END_UTC resolution"
echo "======================================================"

# Both HH:MM (Eastern) - DST-aware
assert_booking "Both Eastern in EDT" "2025-03-18" "09:00" "17:00" "13:00:00.000Z" "21:00:00.000Z"
assert_booking "Both Eastern in EST" "2026-01-15" "09:00" "17:00" "14:00:00.000Z" "22:00:00.000Z"

# Both literal UTC
assert_booking "Both literal UTC" "2025-03-18" "14:00:00.000Z" "22:00:00.000Z" "14:00:00.000Z" "22:00:00.000Z"

# Mixed: Eastern start, literal UTC end
assert_booking "Mixed: Eastern start + UTC end (EDT)" "2025-03-18" "09:00" "22:00:00.000Z" "13:00:00.000Z" "22:00:00.000Z"

# Mixed: literal UTC start, Eastern end
assert_booking "Mixed: UTC start + Eastern end (EST)" "2026-01-15" "14:00:00.000Z" "17:00" "14:00:00.000Z" "22:00:00.000Z"

echo ""
echo "======================================================"
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
if [[ $TESTS_FAILED -gt 0 ]]; then
  exit 1
fi
exit 0

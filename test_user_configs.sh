#!/usr/bin/env bash

# Test script to validate USER_CONFIGS format
# Usage: ./test_user_configs.sh

# Don't exit on error initially - we want to report all test failures
set +e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to print test results
test_pass() {
  echo -e "${GREEN}✓${NC} $1"
  ((TESTS_PASSED++))
}

test_fail() {
  echo -e "${RED}✗${NC} $1"
  ((TESTS_FAILED++))
}

test_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

echo "Testing USER_CONFIGS validation..."
echo "=================================="
echo ""

# Load .env file if it exists
CONFIG_FILE=".env"
if [[ -f "$CONFIG_FILE" ]]; then
  echo "Loading environment from $CONFIG_FILE"
  set -o allexport
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] && eval "export $line" 2>/dev/null || true
  done < "$CONFIG_FILE"
  set +o allexport
  echo ""
fi

# Test 1: Check if USER_CONFIGS is set
if [[ -z "$USER_CONFIGS" ]]; then
  test_fail "USER_CONFIGS is not set"
  echo "  Set USER_CONFIGS in your .env file or export it as an environment variable"
  exit 1
else
  test_pass "USER_CONFIGS is set"
fi

# Test 2: Check if jq is available
if ! command -v jq &> /dev/null; then
  test_fail "jq is not installed (required to parse USER_CONFIGS)"
  echo "  Install with: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
else
  test_pass "jq is installed"
fi

# Test 3: Validate USER_CONFIGS is valid JSON
if ! echo "$USER_CONFIGS" | jq . > /dev/null 2>&1; then
  test_fail "USER_CONFIGS is not valid JSON"
  echo "  Error: $(echo "$USER_CONFIGS" | jq . 2>&1 | head -1)"
  exit 1
else
  test_pass "USER_CONFIGS is valid JSON"
fi

# Test 4: Check if USER_CONFIGS has at least one user
USER_COUNT=$(echo "$USER_CONFIGS" | jq 'length')
if [[ "$USER_COUNT" -eq 0 ]]; then
  test_fail "USER_CONFIGS has no users"
  exit 1
else
  test_pass "USER_CONFIGS contains $USER_COUNT user(s)"
fi

# Test 5: Validate each user has required fields
REQUIRED_FIELDS=("APPSPACE_TOKEN" "RESOURCE_ID" "ORGANIZER_ID" "ORGANIZER_NAME" "ORGANIZER_EMAIL")
ALL_USERS=$(echo "$USER_CONFIGS" | jq -r 'keys[]')

for user in $ALL_USERS; do
  echo ""
  echo "Validating user: $user"
  
  USER_CONFIG=$(echo "$USER_CONFIGS" | jq -r ".\"$user\"")
  
  if [[ "$USER_CONFIG" == "null" ]] || [[ -z "$USER_CONFIG" ]]; then
    test_fail "User '$user' has invalid or empty config"
    continue
  fi
  
  USER_VALID=true
  
  for field in "${REQUIRED_FIELDS[@]}"; do
    VALUE=$(echo "$USER_CONFIG" | jq -r ".$field // empty")
    
    if [[ -z "$VALUE" ]] || [[ "$VALUE" == "null" ]]; then
      test_fail "User '$user' is missing required field: $field"
      USER_VALID=false
    else
      test_pass "User '$user' has $field"
    fi
  done
  
  # Test 6: Validate field formats
  if [[ "$USER_VALID" == true ]]; then
    # Check email format (basic validation)
    EMAIL=$(echo "$USER_CONFIG" | jq -r '.ORGANIZER_EMAIL')
    if [[ ! "$EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
      test_warn "User '$user' ORGANIZER_EMAIL format may be invalid: $EMAIL"
    else
      test_pass "User '$user' ORGANIZER_EMAIL format is valid"
    fi
    
    # Check IDs are UUIDs (basic validation - should be 36 chars with dashes)
    TOKEN=$(echo "$USER_CONFIG" | jq -r '.APPSPACE_TOKEN')
    RESOURCE_ID=$(echo "$USER_CONFIG" | jq -r '.RESOURCE_ID')
    ORGANIZER_ID=$(echo "$USER_CONFIG" | jq -r '.ORGANIZER_ID')
    
    UUID_PATTERN="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    
    if [[ ! "$TOKEN" =~ $UUID_PATTERN ]]; then
      test_warn "User '$user' APPSPACE_TOKEN format may be invalid (expected UUID format)"
    else
      test_pass "User '$user' APPSPACE_TOKEN format is valid"
    fi
    
    if [[ ! "$RESOURCE_ID" =~ $UUID_PATTERN ]]; then
      test_warn "User '$user' RESOURCE_ID format may be invalid (expected UUID format)"
    else
      test_pass "User '$user' RESOURCE_ID format is valid"
    fi
    
    if [[ ! "$ORGANIZER_ID" =~ $UUID_PATTERN ]]; then
      test_warn "User '$user' ORGANIZER_ID format may be invalid (expected UUID format)"
    else
      test_pass "User '$user' ORGANIZER_ID format is valid"
    fi
  fi
done

# Test 7: Verify USER_CONFIGS can be used by the scripts (dry run)
echo ""
echo "Testing script compatibility..."
if echo "$USER_CONFIGS" | jq -r 'keys[]' | head -1 | while read -r test_user; do
  USER_CONFIG=$(echo "$USER_CONFIGS" | jq -r ".\"$test_user\"")
  APPSPACE_TOKEN=$(echo "$USER_CONFIG" | jq -r '.APPSPACE_TOKEN // empty')
  RESOURCE_ID=$(echo "$USER_CONFIG" | jq -r '.RESOURCE_ID // empty')
  ORGANIZER_ID=$(echo "$USER_CONFIG" | jq -r '.ORGANIZER_ID // empty')
  ORGANIZER_NAME=$(echo "$USER_CONFIG" | jq -r '.ORGANIZER_NAME // empty')
  ORGANIZER_EMAIL=$(echo "$USER_CONFIG" | jq -r '.ORGANIZER_EMAIL // empty')
  
  if [[ -n "$APPSPACE_TOKEN" ]] && [[ -n "$RESOURCE_ID" ]] && [[ -n "$ORGANIZER_ID" ]] && [[ -n "$ORGANIZER_NAME" ]] && [[ -n "$ORGANIZER_EMAIL" ]]; then
    test_pass "USER_CONFIGS is compatible with script functions (tested with user: $test_user)"
  else
    test_fail "USER_CONFIGS extraction failed for user: $test_user"
  fi
done; then
  : # Test passed
else
  test_fail "Script compatibility test failed"
fi

# Summary
echo ""
echo "=================================="
echo "Test Summary:"
echo "  Passed: $TESTS_PASSED"
if [[ $TESTS_FAILED -gt 0 ]]; then
  echo -e "  Failed: ${RED}$TESTS_FAILED${NC}"
  exit 1
else
  echo -e "  Failed: ${GREEN}0${NC}"
  echo ""
  echo -e "${GREEN}All tests passed! USER_CONFIGS is valid and ready to use.${NC}"
  exit 0
fi


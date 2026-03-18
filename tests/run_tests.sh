#!/usr/bin/env bash

# Run all tests
# Usage: ./tests/run_tests.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "Running appspace-desk-reservations tests"
echo "========================================"
echo ""

FAILED=0

for test_script in "$SCRIPT_DIR"/test_*.sh; do
  if [[ -x "$test_script" ]]; then
    echo "--- $(basename "$test_script") ---"
    if "$test_script"; then
      echo ""
    else
      FAILED=$((FAILED + 1))
      echo ""
    fi
  fi
done

if [[ $FAILED -gt 0 ]]; then
  echo "========================================"
  echo "$FAILED test suite(s) failed"
  exit 1
fi

echo "========================================"
echo "All tests passed"
exit 0

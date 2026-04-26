#!/bin/bash
# E2E Test Runner Script
# Usage: npm run test:e2e

# Load environment variables
if [ -f tests/e2e/.env ]; then
  export $(cat tests/e2e/.env | grep -v '^#' | xargs)
fi

# Set defaults
export LLM_E2E=${LLM_E2E:-true}
export LLM_TEST_TIMEOUT=${LLM_TEST_TIMEOUT:-60000}

echo "Running E2E tests with:"
echo "  LLM_MODEL: $LLM_MODEL"
echo "  LLM_BASE_URL: $LLM_BASE_URL"
echo "  LLM_E2E: $LLM_E2E"
echo ""

# Run E2E tests
npx vitest run tests/e2e --reporter=verbose

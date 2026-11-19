#!/bin/bash
# Guard: no direct item.getFieldValue calls — use getFieldValue(item, key)
set -e
bad=$(grep -R --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" "item\.getFieldValue" apps/delivery-ops/client/src 2>/dev/null || true)
if [ -n "$bad" ]; then
  echo "FAIL: stale item.getFieldValue usage found:"
  echo "$bad"
  exit 1
fi
echo "PASS: no stale item.getFieldValue"

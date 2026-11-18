#!/usr/bin/env python3
"""Deprecated — use test-smtp.js (reads server/.env for smtp.ndb.team credentials).

  cd apps/delivery-ops/server && node test-smtp.js
  node test-smtp.js --send you@nutanix.com
"""
import sys

print(
    "test-smtp.py is deprecated. Use:\n"
    "  node test-smtp.js\n"
    "  node test-smtp.js --send you@nutanix.com\n"
    "(credentials from server/.env — SMTP_USER / SMTP_PASS)",
    file=sys.stderr,
)
sys.exit(2)

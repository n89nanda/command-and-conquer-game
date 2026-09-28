#!/bin/bash
pkill -f "vite.test.config" 2>/dev/null; sleep 0.5
cd "$(dirname "$0")/.." && (npx vite --config scripts/vite.test.config.ts > /tmp/claude-0/vite-test.log 2>&1 &)
sleep 2.5

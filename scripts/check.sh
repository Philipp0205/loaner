#!/usr/bin/env bash
# Quiet gate runner: npm ci, typecheck, test, test:ui. Stops at the first failure.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
for step in ci typecheck test test:ui; do
  log="/tmp/check-$(basename "$PWD")-${step//:/-}.log"
  if [ "$step" = ci ]; then cmd=(npm ci); else cmd=(npm run "$step"); fi
  if "${cmd[@]}" >"$log" 2>&1; then
    echo "ok $step"
  else
    echo "FAIL $step (full log: $log)"
    tail -n 30 "$log"
    exit 1
  fi
done

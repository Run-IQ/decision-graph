#!/usr/bin/env bash
# Runs `npm run <script>` and compares what it reports as failing with the baseline committed in
# .github/baseline/<step>.txt (absent means: nothing is expected to fail). The step is green only
# when the two sets are identical: a new failure is a regression, and a failure that disappeared
# means the baseline must shrink in the same pull request, so the file always tells the truth.
#
# usage: baseline-check.sh <step> <script>
#   step    typecheck | build | test   (how the failures are read from the output)
#   script  the npm script to run
# A failing command that reports nothing readable is itself a failure of the baseline: it is
# recorded as `exit <status> without diagnostics` and must be in the file to pass.
# BASELINE_RECORD=1 prints the failing set instead of comparing (to write the file).
set -uo pipefail

step="$1"
script="$2"
file=".github/baseline/$step.txt"
out="$(mktemp)"
found="$(mktemp)"

npm run "$script" 2>&1 | tee "$out"
status="${PIPESTATUS[0]}"

node -e '
  const fs = require("fs");
  const [, step, status, out] = process.argv;
  const text = fs.readFileSync(out, "utf8").replace(/\u001b\[[0-9;]*m/g, "");
  const found = new Set();
  if (step === "test") {
    for (const m of text.matchAll(/^\s*FAIL\s+(?:\|[^|]*\|\s+)?(.+?)\s*$/gm)) found.add(m[1]);
  } else {
    for (const m of text.matchAll(/^(?:##\[error\])?([^\s(][^()\n]*)\((\d+),\d+\): error (TS\d+)/gm)) {
      found.add(m[1] + ":" + m[2] + " " + m[3]);
    }
  }
  if (found.size === 0 && Number(status) !== 0) found.add("exit " + status + " without diagnostics");
  process.stdout.write([...found].sort().join("\n") + (found.size ? "\n" : ""));
' -- "$step" "$status" "$out" > "$found"

if [ "${BASELINE_RECORD:-}" = 1 ]; then
  echo "::group::baseline of $step"; cat "$found"; echo "::endgroup::"
  exit 0
fi

expected="$(mktemp)"
if [ -f "$file" ]; then LC_ALL=C sort "$file" > "$expected"; else : > "$expected"; fi
if diff -u --label "baseline $file" --label "this run" "$expected" "$found"; then
  echo "The failures of $step are exactly the baseline ($(wc -l < "$found") listed)."
else
  echo "::error::The failures of $step differ from $file (a - line is a failure that is gone: shrink the baseline; a + line is a new failure)."
  exit 1
fi

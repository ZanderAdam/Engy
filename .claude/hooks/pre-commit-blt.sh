#!/usr/bin/env bash
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd) || exit 1
cd "$ROOT" || exit 1

CMD=$(node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try {
    process.stdout.write(JSON.parse(s).tool_input?.command ?? "");
  } catch {
    process.exit(1);
  }
});
') || { echo "pre-commit-blt: could not parse hook input" >&2; exit 1; }

if ! grep -qE '\bgit\s+commit\b' <<<"$CMD"; then
  exit 0
fi

echo "Running pnpm blt before commit..." >&2
if pnpm blt; then
  exit 0
fi
echo "blt failed — commit blocked. Fix the issues above and retry." >&2
exit 2

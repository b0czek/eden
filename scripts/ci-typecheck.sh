#!/usr/bin/env bash

set -euo pipefail

pnpm run build:packages

while IFS= read -r -d '' tsconfig; do
  dir="$(dirname "$tsconfig")"

  if [[ ! -f "$dir/package.json" ]]; then
    continue
  fi

  if ! grep -q '"typescript"' "$dir/package.json"; then
    continue
  fi

  echo "Typechecking $dir"
  pnpm --dir "$dir" exec tsc --noEmit -p tsconfig.json
done < <(
  find packages \
    \( -path '*/dist' -o -path '*/node_modules' \) -prune \
    -o -name tsconfig.json -print0 | sort -z
)

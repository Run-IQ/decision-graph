#!/usr/bin/env bash
# Builds the `refonte/<name>` branch of sibling Run-IQ packages and links them in place of the
# published ones, the way core's CI does for spec: the registry has no version matching these
# repositories' ranges, and the siblings move with the phase.
#
# usage: link-refonte.sh <branch> <sibling>...   (siblings in dependency order, e.g. spec core)
# Each sibling is cloned from its `<branch>` into $RUNNER_TEMP/refonte/<sibling>, left out of the
# install of the siblings built after it, built there, and linked into the current repository
# after the published copies were left out of its install (package.json and package-lock.json of
# the runner's copy only). A sibling without that branch fails the run: nothing is skipped.
set -euo pipefail

branch="$1"
shift
root="${RUNNER_TEMP:?}/refonte"
mkdir -p "$root"

# Leaves the given @run-iq packages out of the install in the current directory.
drop() {
  node -e '
    const fs = require("fs");
    const names = process.argv.slice(1).map((n) => "@run-iq/" + n);
    const fields = ["dependencies", "peerDependencies", "devDependencies", "optionalDependencies"];
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    for (const f of fields) for (const n of names) if (pkg[f]) delete pkg[f][n];
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    const rootEntry = lock.packages[""];
    for (const f of fields) for (const n of names) if (rootEntry[f]) delete rootEntry[f][n];
    for (const n of names) delete lock.packages["node_modules/" + n];
    fs.writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
  ' -- "$@"
}

# Links the given siblings into node_modules/@run-iq of the current directory.
link() {
  local linked
  mkdir -p node_modules/@run-iq
  for linked in "$@"; do ln -sfn "$root/$linked" "node_modules/@run-iq/$linked"; done
}

built=()
for name in "$@"; do
  if ! git ls-remote --exit-code "https://github.com/Run-IQ/$name.git" "refs/heads/$branch" > /dev/null; then
    echo "::error::Run-IQ/$name has no branch $branch. This repository is checked against the branch named like its own."
    exit 1
  fi
  git clone --quiet --depth 1 --branch "$branch" "https://github.com/Run-IQ/$name.git" "$root/$name"
  (
    cd "$root/$name"
    if [ "${#built[@]}" -gt 0 ]; then drop "${built[@]}"; fi
    npm ci
    if [ "${#built[@]}" -gt 0 ]; then link "${built[@]}"; fi
    # A sibling that does not build is said, never hidden: what it did emit is still linked.
    if ! npm run build; then
      echo "::warning::The build of Run-IQ/$name@$branch failed; its partial output is linked."
    fi
  )
  built+=("$name")
done

# The repository itself: published copies out of the install, the built ones linked.
drop "${built[@]}"
npm ci
link "${built[@]}"

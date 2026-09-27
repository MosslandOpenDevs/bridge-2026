#!/usr/bin/env bash
# This repository is public, and so are its commit messages and pull request
# text. Fails when any of them carries a literal IPv4 address outside the
# ranges that are safe in examples (loopback, 0.0.0.0/8 and the RFC 5737
# documentation networks) or a tailnet host name. Prints where, never the
# value, so the public CI log does not repeat what it caught.
#
# Environment (all optional):
#   RANGE     commits whose messages to check, e.g. "<base>..<head>"
#   PR_TITLE  pull request title
#   PR_BODY   pull request body
set -euo pipefail

# perl -ne program: prints "<file>:<line>" (or just "<line>" for stdin) for
# each line that needs attention.
FLAG='
  my $hit = /[A-Za-z0-9-]+\.ts\.net\b/;
  while (!$hit && /(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?![\d.])/g) {
    $hit = $1 !~ /^(?:127\.|0\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/;
  }
  print(($ARGV eq "-" ? "" : "$ARGV:") . "$.\n") if $hit;
  close ARGV if eof;
'

found=0
report() {
  echo "::error::$1"
  found=1
}

while IFS= read -r loc; do
  report "file ${loc}"
done < <(
  git grep -I -l -z -E '([0-9]{1,3}\.){3}[0-9]{1,3}|\.ts\.net' -- . ':!oracle/pnpm-lock.yaml' \
    | xargs -0 -r perl -ne "${FLAG}"
)

if [ -n "${RANGE:-}" ]; then
  for sha in $(git rev-list "${RANGE}"); do
    while IFS= read -r n; do
      report "commit ${sha:0:12} message line ${n}"
    done < <(git log -1 --format=%B "${sha}" | perl -ne "${FLAG}")
  done
fi

if [ -n "${PR_TITLE:-}" ]; then
  while IFS= read -r _; do report "pull request title"; done < <(printf '%s\n' "${PR_TITLE}" | perl -ne "${FLAG}")
fi
if [ -n "${PR_BODY:-}" ]; then
  while IFS= read -r n; do report "pull request body line ${n}"; done < <(printf '%s\n' "${PR_BODY}" | perl -ne "${FLAG}")
fi

if [ "${found}" = "1" ]; then
  echo "A deployment address is in a public place. Use a placeholder such as <app-host> or an RFC 5737 address (192.0.2.x); see \"Deployment details stay private\" in CONTRIBUTING.md." >&2
  exit 1
fi
echo "No deployment addresses found."

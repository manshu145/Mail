#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

npm run release:sanitize

REVISION="${NEXIMAIL_RELEASE_REVISION:-HEAD}"
OUT_DIR="${NEXIMAIL_RELEASE_OUT_DIR:-dist}"
VERSION="$(node -p "require('./package.json').version")"
SHA="$(git rev-parse --verify "$REVISION^{commit}")"
SHORT_SHA="$(git rev-parse --short=12 "$SHA")"
ARCHIVE="$OUT_DIR/neximail-v${VERSION}-${SHORT_SHA}.tar.gz"

mkdir -p "$OUT_DIR"
rm -f "$ARCHIVE"

# git archive exports committed release content only. It never includes .git,
# local .env files, runtime databases, volumes, logs, or Git author history.
git archive --format=tar.gz --prefix="neximail/" -o "$ARCHIVE" "$SHA"

test -s "$ARCHIVE"
if tar -tzf "$ARCHIVE" | grep -Eq '(^|/)\.git(/|$)|(^|/)\.env($|\.)'; then
  echo "Release bundle contains forbidden Git/runtime environment material."
  exit 1
fi

sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
printf 'Release bundle created\nArtifact: %s\nRevision: %s\nChecksum: %s\n'   "$ARCHIVE" "$SHA" "$(cat "$ARCHIVE.sha256")"

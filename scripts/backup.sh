#!/bin/bash
# Pull a dated copy of the live database to this machine.
#
#   ./scripts/backup.sh                        # from http://umbrel.local:3737
#   ./scripts/backup.sh http://localhost:8777  # from a local instance
#   ./scripts/backup.sh "" ~/Documents/backups # somewhere other than ./backups
#
# Works over the app's own API, so it needs no SSH, no Docker and no knowledge
# of where the file physically lives. That matters on Umbrel, where the
# database sits in a named volume inside a containerised Docker daemon and is
# awkward to reach any other way.

set -euo pipefail

HOST="${1:-http://umbrel.local:3737}"
DEST="${2:-./backups}"
STAMP="$(date +%Y-%m-%d-%H%M)"
FILE="$DEST/printhour-$STAMP.sqlite"

mkdir -p "$DEST"

echo "PrintHour backup"
echo "  from: $HOST"
echo "  to  : $FILE"
echo

if ! curl -fsS --max-time 10 "$HOST/api/health" >/dev/null 2>&1; then
  echo "PROBLEM: no PrintHour server answering at $HOST"
  echo "Is the stack running? Is the address right?"
  exit 1
fi

curl -fsS --max-time 60 -o "$FILE" "$HOST/api/db"

# An empty database, an HTML error page or a truncated download would all be
# silent failures without this check.
if [ ! -s "$FILE" ]; then
  echo "PROBLEM: the server returned nothing. The database may still be empty."
  rm -f "$FILE"
  exit 1
fi

HEADER="$(head -c 15 "$FILE")"
if [ "$HEADER" != "SQLite format 3" ]; then
  echo "PROBLEM: that is not a SQLite file. First bytes: $HEADER"
  rm -f "$FILE"
  exit 1
fi

SIZE="$(du -h "$FILE" | cut -f1)"
echo "Done — $SIZE"
echo
echo "Open it with:  sqlite3 \"$FILE\" \"SELECT name FROM products;\""

# Keep the last 30, delete the rest.
KEEP=30
COUNT="$(ls -1 "$DEST"/printhour-*.sqlite 2>/dev/null | wc -l | tr -d ' ')"
if [ "$COUNT" -gt "$KEEP" ]; then
  ls -1t "$DEST"/printhour-*.sqlite | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old"
    echo "Removed old backup: $(basename "$old")"
  done
fi

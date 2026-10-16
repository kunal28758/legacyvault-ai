#!/usr/bin/env bash
# Encrypted logical backup of the LegacyVault database, then a restore test in an
# isolated throwaway container (docs/DEPLOYMENT.md § 7d-2 step 2).
#
#   scripts/backup/backup-verify.sh <destination-dir>                # rehearsal: the LOCAL database
#   scripts/backup/backup-verify.sh <destination-dir> --production   # the linked production project
#
# What it guarantees:
# - Every dump streams straight into gpg (AES-256). No plaintext dump touches
#   disk; a file only gets its final name once its whole pipeline succeeded,
#   and leftovers of a failed run (*.partial) are removed.
# - Each dump is decrypted again and must end with its completion marker (the
#   schema dump's pg_dump footer; the data dumps' closing RESET ALL).
# - Production: the passphrase is read without echo, held only in this shell
#   (never in arguments, files, traces or gpg-agent's cache); keep it in the
#   owner's password manager. Rehearsal: a random passphrase that dies with the run.
# - The restore container has no network and publishes no port, so restored
#   data cannot reach production or anything else; it is removed afterwards.
# - Verification compares per-table row counts and md5s (no data) measured
#   just before and just after the dump: stable tables must match exactly;
#   tables that changed during the dump are named (compare-checksums.mjs).
# - Output: file names, sizes, table counts, PASS/FAIL. In production mode psql
#   errors are withheld (they can quote rows); rehearse locally to debug.
#
# What it does NOT back up: Supabase Storage file contents, Clerk identities,
# Vault and other secrets, platform configuration. The restore test covers the
# public (application) schema; platform schemas restore only into a real
# Supabase project. The full data dump is only checked for completeness.
set -euo pipefail
set +x    # never trace: the passphrase lives in this shell
umask 077 # everything created here is owner-only

usage="usage: scripts/backup/backup-verify.sh <destination-dir> [--production]"
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then echo "$usage" >&2; exit 2; fi
dest="$1"
mode="${2:-rehearsal}"
case "$dest" in -*) echo "$usage" >&2; exit 2 ;; esac
case "$mode" in rehearsal | --production) ;; *) echo "unknown mode: $mode ($usage)" >&2; exit 2 ;; esac

repo="$(git rev-parse --show-toplevel)"
cd "$repo"

# Test hook: stands in for the Supabase CLI in rehearsals only.
supabase_bin="${LV_BACKUP_SUPABASE_BIN:-}"
if [ "$mode" = "--production" ]; then
  [ -z "$supabase_bin" ] || { echo "refusing: LV_BACKUP_SUPABASE_BIN is for rehearsals only" >&2; exit 1; }
  [ "$(cat supabase/.temp/project-ref)" = "zlgmthrdoxyfkldeaxyl" ] \
    || { echo "refusing: this checkout is not linked to the production project" >&2; exit 1; }
  [ -t 0 ] || { echo "refusing: run interactively (the passphrase is typed, not piped)" >&2; exit 1; }
fi

mkdir -p "$dest"
dest="$(cd "$dest" && pwd -P)"
case "$dest/" in
  "$(cd "$repo" && pwd -P)"/*) echo "refusing: the destination must be outside the repository" >&2; exit 1 ;;
esac
if [ -n "$(ls -A "$dest")" ]; then echo "refusing: the destination must be empty" >&2; exit 1; fi
chmod 700 "$dest" 2>/dev/null || true
free_kb="$(df -Pk "$dest" | awk 'NR == 2 { print $4 }')"
if [ "${free_kb:-0}" -lt 524288 ]; then echo "refusing: less than 512 MB free at the destination" >&2; exit 1; fi

if [ "$mode" = "--production" ]; then
  source_flag="--linked"
  read -rsp "Backup passphrase: " pass; echo
  read -rsp "Repeat passphrase: " again; echo
  if [ "$pass" != "$again" ] || [ "${#pass}" -lt 12 ]; then
    unset pass again
    echo "refusing: passphrases differ or are shorter than 12 characters" >&2; exit 1
  fi
  unset again
else
  source_flag="--local"
  pass="$(openssl rand -base64 32)"
fi

name=""
cleanup() {
  rm -f "$dest"/*.partial 2>/dev/null || true
  if [ -n "$name" ]; then docker rm -f -v "$name" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

supa() {
  if [ -n "$supabase_bin" ]; then "$supabase_bin" "$@"; else pnpm -s exec supabase "$@"; fi
}
gpg_common=(--batch --quiet --no-symkey-cache --pinentry-mode loopback --passphrase-fd 3)
encrypt() { gpg "${gpg_common[@]}" --symmetric --cipher-algo AES256 --output "$1" 3< <(printf '%s' "$pass"); }
decrypt() { gpg "${gpg_common[@]}" --decrypt "$1" 3< <(printf '%s' "$pass"); }

# dump <file> [options]: the final name only after the whole pipeline succeeded.
# The Supabase CLI prints its errors to stdout, which here goes into gpg, so a
# failure is reported by step, with the command to see the error on its own.
dump() {
  local file="$1"
  shift
  if ! supa db dump "$source_flag" "$@" | encrypt "$dest/$file.partial"; then
    echo "FAIL: dumping $file failed. To see why, run alone: pnpm exec supabase db dump $source_flag $*" >&2
    exit 1
  fi
  mv "$dest/$file.partial" "$dest/$file"
}
# complete <file> <marker>: decrypts again and requires the marker at the end.
complete() {
  local found
  found="$(decrypt "$dest/$1" | tail -c 4096 | grep -cF -- "$2" || true)"
  if [ "${found:-0}" -lt 1 ]; then echo "FAIL: $1 is incomplete or does not decrypt" >&2; exit 1; fi
}
# query_value <column> [--json-object] <db query args...>: the column of a one-row
# query. JSON is requested explicitly: without it a terminal gets a text table,
# and its shape differs between a terminal and an AI agent (query-value.mjs).
# A rejection names the reason only; the CLI's own errors stay withheld.
query_value() {
  local column="$1" check=""
  shift
  if [ "${1:-}" = "--json-object" ]; then check="$1"; shift; fi
  supa db query "$source_flag" --output-format json "$@" 2>/dev/null |
    node scripts/backup/query-value.mjs "$column" ${check:+"$check"}
}
checksums() {
  if ! query_value checksums --json-object -f scripts/region-migration/sql/table-checksums.sql >"$dest/$1"; then
    echo "FAIL: reading the source checksums ($1) failed" >&2
    exit 1
  fi
}

echo "source: ${source_flag#--}   destination: $dest   started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
dump schema.sql.gpg --keep-comments
# The restore-tested public data is bracketed by checksums taken right before and after it.
checksums checksums-before.json
dump data-public.sql.gpg --data-only --use-copy --schema public
checksums checksums-after.json
dump data.sql.gpg --data-only --use-copy
complete schema.sql.gpg "PostgreSQL database dump complete"
complete data-public.sql.gpg "RESET ALL;"
complete data.sql.gpg "RESET ALL;"
migration="$(query_value v "select max(version) as v from supabase_migrations.schema_migrations")" ||
  { echo "FAIL: reading the database migration version failed" >&2; exit 1; }
(cd "$dest" && sha256sum ./*.gpg checksums-before.json checksums-after.json >SHA256SUMS)
echo "encrypted (AES-256), complete: $(cd "$dest" && stat -c '%n=%s bytes' ./*.gpg | paste -sd ' ')"
echo "database migration at backup time: $migration"

# --- restore test: isolated container (no network, no published port) -----------
name="lv-restore-check-$$"
docker run -d --name "$name" --network none -e POSTGRES_PASSWORD="$(openssl rand -hex 18)" \
  public.ecr.aws/supabase/postgres:17.6.1.166 >/dev/null
ready=""
for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ -n "$ready" ] || { echo "FAIL: the restore container did not start" >&2; exit 1; }
# GoTrue normally creates auth.jwt(); the schema uses it, and only supabase_admin may write to auth.
docker exec -i "$name" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -c \
  "create or replace function auth.jwt() returns jsonb language sql stable as \$\$ select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb \$\$;" >/dev/null

load() {
  if [ "$mode" = "--production" ]; then
    decrypt "$dest/$1" | docker exec -i "$name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -1 >/dev/null 2>&1 ||
      { echo "FAIL: restoring $1 failed (psql errors withheld: they can quote rows)" >&2; exit 1; }
  else
    decrypt "$dest/$1" | docker exec -i "$name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -1 >/dev/null
  fi
}
load schema.sql.gpg
load data-public.sql.gpg
docker exec -i "$name" psql -U postgres -d postgres -At -c "set timezone = 'UTC'" -f - \
  <scripts/region-migration/sql/table-checksums.sql | tail -1 >"$dest/checksums-restored.json"

node scripts/backup/compare-checksums.mjs \
  "$dest/checksums-before.json" "$dest/checksums-after.json" "$dest/checksums-restored.json"
echo "finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)   integrity: $dest/SHA256SUMS"

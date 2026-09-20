#!/usr/bin/env bash
# [SEAM] Run tests/sql/*.test.sql against a real PostgreSQL.
#
# ── WHY THIS IS A SEPARATE GATE ──
# The other five gates need no services, which is what makes them runnable on a clean checkout with
# an empty environment. This one needs a database, so it cannot join `npm run gates` without taking
# that property away from every contributor. It runs in CI instead, where a postgres service is one
# line of yaml — and it is the only gate that can see a plpgsql contract at all.
#
# Locally: start any PostgreSQL and set DATABASE_URL (or the usual PG* variables), then
#   npm run test:sql
# Without one it prints how to run it and exits 0. That is a deliberate local convenience and NOT
# how it behaves in CI: SQL_SEAM_REQUIRED=1 turns a missing database into a failure, and the CI
# workflow sets it — so the gate can never go quietly green because nothing ran.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
required="${SQL_SEAM_REQUIRED:-}"

if ! command -v psql >/dev/null 2>&1; then
  msg="psql not found"
  if [ -n "$required" ]; then echo "✗ [SEAM] $msg — required in this environment." >&2; exit 1; fi
  echo "— [SEAM] skipped: $msg. Install postgresql-client to run the SQL gate locally."
  exit 0
fi

# A URL wins; otherwise fall back to whatever PG* the environment already has.
psql_base=(psql -v ON_ERROR_STOP=1 -X -q)
if [ -n "${DATABASE_URL:-}" ]; then psql_base+=(-d "$DATABASE_URL"); fi

# [SEAM-GUARD] Refused before a single connection is opened: a Supabase host is never scratch,
# whatever the database is called. The other refusals need the live connection; see below.
case "${DATABASE_URL:-}${PGHOST:-}" in
  *supabase.co*|*supabase.com*|*supabase.in*|*pooler.*)
    echo "✗ [SEAM] refusing to run: the connection points at a Supabase host — that is a real project, not a fixture." >&2
    echo "  This fixture DROPs schema public. Point DATABASE_URL at a throwaway PostgreSQL only." >&2
    exit 1 ;;
esac

if ! "${psql_base[@]}" -c 'SELECT 1' >/dev/null 2>&1; then
  msg="no reachable PostgreSQL (set DATABASE_URL or PGHOST/PGUSER)"
  if [ -n "$required" ]; then echo "✗ [SEAM] $msg — required in this environment." >&2; exit 1; fi
  echo "— [SEAM] skipped: $msg."
  echo "  To run it:  docker run -e POSTGRES_PASSWORD=x -e POSTGRES_DB=seamtest -p 5432:5432 -d postgres:16"
  echo "              DATABASE_URL=postgres://postgres:x@localhost:5432/seamtest npm run test:sql"
  exit 0
fi

# ── [SEAM-GUARD] The fixture's first statement is DROP SCHEMA public CASCADE ─────────────────────
#
# So this runner must never reach a database with real data, and the check that stood here was
# the database NAME alone, with 'postgres' on its allow-list. 'postgres' is the name of EVERY
# Supabase project's database. A DATABASE_URL copied from a project's settings page passed the
# check, and the next thing to run would have been the DROP — on production, with no confirmation
# and no undo. The instructions printed above even suggested a URL ending in /postgres.
#
# Three refusals now, independent of each other, so that any one of them is enough:
#   1. the NAME must say it is scratch ('postgres' is gone, and so is 'ci' — it matches too much);
#   2. the HOST must be local, and a Supabase host is refused outright;
#   3. the database must not carry a Supabase signature (auth.users). The fixture creates `auth`
#      with one stub function and nothing else, so that table can only mean a real project.
# None of them can be reasoned around by a URL that "looks fine"; they read the live connection.

seam_refuse() {
  echo "✗ [SEAM] refusing to run: $1" >&2
  echo "  This fixture DROPs schema public. Point DATABASE_URL at a throwaway PostgreSQL only:" >&2
  echo "    docker run -e POSTGRES_PASSWORD=x -e POSTGRES_DB=seamtest -p 5432:5432 -d postgres:16" >&2
  echo "    DATABASE_URL=postgres://postgres:x@localhost:5432/seamtest npm run test:sql" >&2
  exit 1
}

# 1. The name.
target="$("${psql_base[@]}" -t -A -c 'SELECT current_database()')"
case "$target" in
  *test*|*seam*|*scratch*) ;;
  *) seam_refuse "database '$target' does not say it is scratch (name must contain 'test', 'seam' or 'scratch')" ;;
esac

# 2. The host. The Supabase-host refusal already ran above, before any connection was opened.
#    Anything else non-local needs SQL_SEAM_ALLOW_REMOTE=1 said out loud — a CI service
#    container is local.
#    "Local" is a unix socket, loopback, or a private range — CI's postgres service container
#    answers from a Docker-internal address (172.16/12), not from 127.0.0.1, and a hosted
#    database answers from a public one. The classification is done by PostgreSQL itself on the
#    address it actually accepted the connection on, not on whatever the URL claims.
server_where="$("${psql_base[@]}" -t -A -c "SELECT CASE
    WHEN inet_server_addr() IS NULL THEN 'socket'
    WHEN inet_server_addr() <<= ANY (ARRAY['127.0.0.0/8','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','::1/128','fc00::/7']::inet[]) THEN 'local'
    ELSE 'remote ' || host(inet_server_addr()) END")"
case "$server_where" in
  socket|local) ;;
  *)
    if [ -z "${SQL_SEAM_ALLOW_REMOTE:-}" ]; then
      seam_refuse "the server is $server_where; set SQL_SEAM_ALLOW_REMOTE=1 only for a database you are certain is disposable"
    fi ;;
esac

# 3. The signature.
has_auth_users="$("${psql_base[@]}" -t -A -c "SELECT (to_regclass('auth.users') IS NOT NULL)::text")"
if [ "$has_auth_users" = "true" ]; then
  seam_refuse "database '$target' has auth.users — that is a Supabase project, not a fixture"
fi

failed=0
for test_file in "$here"/tests/sql/*.test.sql; do
  name="$(basename "$test_file")"
  echo ""
  echo "══ $name ══════════════════════════════════════════════"

  # Which migrations this test needs, declared in its own header:
  #   -- migrations: allocate_bank_payment.sql, factuur_b_numbering.sql
  # They are loaded from supabase/migrations so the file under test is the one that SHIPS — a copy
  # inside tests/ would be a second source of truth for money.
  migrations="$(sed -n 's/^-- migrations:[[:space:]]*//p' "$test_file" | head -1 | tr ',' ' ')"
  if [ -z "$migrations" ]; then
    echo "✗ $name declares no '-- migrations:' header — it would test nothing." >&2
    failed=1
    continue
  fi

  # [PRIVILEGE-REGISTRY] The loaded list travels into the privilege check as a psql variable, so
  # the check can tell a function whose whole ACL history was replayed (judged) from one whose
  # history is only partly here (reported, not judged).
  loaded="$(echo $migrations)"
  args=(-v "loaded=$loaded" -f "$here/tests/sql/fixture.sql")   # a clean schema per file
  missing=""
  for m in $migrations; do
    path="$here/supabase/migrations/$m"
    if [ ! -f "$path" ]; then missing="$missing $m"; continue; fi
    args+=(-f "$path")
  done
  if [ -n "$missing" ]; then
    echo "✗ $name names migrations that do not exist:$missing" >&2
    failed=1
    continue
  fi
  # [PRIVILEGE-REGISTRY] Between the migrations and the test: who can execute what, according to
  # the catalog, against the registry's intent. Before the test file, so the test's own helper
  # functions are not in public yet. privilege-intent.sql is generated from
  # scripts/privilege-registry.ts; a unit gate keeps it current.
  args+=(-f "$here/tests/sql/privilege-intent.sql" -f "$here/tests/sql/privilege-check.sql")
  args+=(-f "$test_file")

  if ! "${psql_base[@]}" "${args[@]}" 2>&1; then
    echo "✗ $name FAILED" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then exit 1; fi
echo ""
echo "✅ [SEAM] every SQL contract held."

# [GELIJKTIJDIG-VAST] Everything above ran on ONE connection per file, where a FOR UPDATE never
# waits. The concurrency driver is the other half: it drives the real doors from TWO connections
# and asserts the outcome. It runs from here rather than standing alone so it inherits the
# [SEAM-GUARD] refusals above — it rebuilds schema public too, and must never reach a real
# database on its own.
SQL_SEAM_GUARDED=1 bash "$here/scripts/sql-concurrency-test.sh" || exit 1

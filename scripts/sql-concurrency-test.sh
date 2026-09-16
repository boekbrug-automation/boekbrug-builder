#!/usr/bin/env bash
# =====================================================================
# [GELIJKTIJDIG-VAST] Two real connections against the real payment doors.
# Run: npm run test:sql   (scripts/sql-seam-test.sh invokes this after the seam contracts)
# =====================================================================
# ── WHY THIS EXISTS, AND WHAT IT ADDS TO THE SUITE BESIDE IT ──
#
# scripts/sql-seam-test.sh gives every .test.sql file ONE psql process. On one connection a
# FOR UPDATE never waits, so no contract in that suite can observe what a row lock DOES. That is
# not a guess: all 30 row-lock lines were stripped from a disposable copy of the migrations and
# the entire seam suite stayed green. The unit gates caught it — but they assert the lock's TEXT
# and POSITION in the migration file, never its EFFECT on a second caller.
#
# So this file is the missing half: the doors are driven by two connections that really contend,
# and the assertion is the FINAL TRANSACTIONAL OUTCOME.
#
# ── WHAT IT DOES NOT CLAIM ──
#
# It does not re-prove [BETAALD-GEDEKT]. That rule refuses ENTRY into 'paid' without a
# tenant-valid allocation at COMMIT, and it is satisfied in BOTH failure shapes below — every
# invoice there does have an allocation. The boundary here is a different one: a bank line that is
# spent twice, an invoice that takes the same instalment twice, and a total that disagrees with
# the links it is derived from.
#
# ── THE COORDINATION, AND WHY IT IS NOT A TIMER ──
#
# Elapsed time is never evidence here. Every step of the handoff is a state change that the
# driver OBSERVES before it takes the next one:
#
#   1. A opens a transaction and books through the real door, taking the row lock.
#   2. A then takes advisory lock 777. An advisory lock is visible to every other session in
#      pg_locks at once, without committing, so this is A saying "I am past the door" in a way the
#      driver can read while A's transaction is still open.
#   3. Only once the driver SEES that lock does it start B, which calls the same door and blocks.
#   4. The driver polls until it sees an UNGRANTED lock — the proof that the two really met — and
#      only then inserts the 'go' row.
#   5. A returns from conc_wait_for_go, commits, and B wakes, re-reads the committed state, decides.
#
# Why A is pinned as the winner rather than letting them race freely: the amounts are the same
# either way (the invariant has no preferred winner), but WHICH connection refuses is not. An
# earlier version launched both and let them fall where they may; B sometimes finished before A
# started, so the run asserted "the loser refused" against the connection that had actually won,
# and the rendezvous was missed entirely. Fixing the order makes B deterministically the loser.
#
# If a step is never observed, the run does NOT quietly pass: both "A reached the door first" and
# "the two really contended" are asserted for the locked runs, so a missed rendezvous is a
# failure, never a green.
#
# ── EACH SCENARIO PROVES ITS OWN DETECTION POWER ──
#
# A gate that has never been seen to fail is a gate nobody has tested. So every scenario runs
# three times: with the shipped lock (PASS), with exactly one targeted lock line removed from a
# DISPOSABLE COPY (RED, with the measured failure shape), and with the lock restored (PASS).
#
# The mutation is verified to have LANDED before its RED is believed — in the live pg_proc body,
# not in the file on disk. [HANDGESCHREVEN-BOEKING]'s R6 gate was green for the wrong reason
# twice; the lesson taken from it is that "the mutation was written" and "the mutation reached the
# function under test" are different facts.
#
# Nothing here writes to any migration the repository ships. The mutated file lives in a temp
# directory that is removed on exit.
# =====================================================================

set -uo pipefail

if [ "${SQL_SEAM_GUARDED:-}" != "1" ]; then
  echo "✗ [GELIJKTIJDIG-VAST] refusing to run directly." >&2
  echo "  This driver DROPs and rebuilds schema public. Run it through 'npm run test:sql', which" >&2
  echo "  applies the [SEAM-GUARD] refusals (scratch name, local host, no auth.users) first." >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

PSQL=(psql -X -q -v ON_ERROR_STOP=1)
if [ -n "${DATABASE_URL:-}" ]; then PSQL+=(-d "$DATABASE_URL"); fi

q()  { "${PSQL[@]}" -t -A -c "$1"; }                 # one scalar
run() { "${PSQL[@]}" "$@"; }

USER_ID=11111111-1111-4111-8111-111111111111
LINE=b0000000-0000-4000-8000-000000000001
INV1=a0000000-0000-4000-8000-000000000001
INV2=a0000000-0000-4000-8000-000000000002

failed=0
pass() { echo "  ok · $1"; }
fail() { echo "  ✗ FAIL · $1" >&2; failed=1; }
expect() { # label got want
  if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1 — got '$2', expected '$3'"; fi
}

# Build a clean schema: the shared fixture, then the migrations this scenario declares. One of
# them may be swapped for a mutated copy — that is the only thing that ever differs between the
# three runs of a scenario.
build_schema() { # $1 = "mig1.sql mig2.sql"  $2 = file to override (or "")  $3 = path of override
  local args=(-f "$here/tests/sql/fixture.sql") m
  for m in $1; do
    if [ -n "$2" ] && [ "$m" = "$2" ]; then args+=(-f "$3"); else args+=(-f "$here/supabase/migrations/$m"); fi
  done
  run "${args[@]}" > "$tmp/load.log" 2>&1 || { fail "schema load failed"; sed 's/^/      /' "$tmp/load.log" >&2; return 1; }
}

seed() { run -f "$here/tests/concurrency/seed.sql" > /dev/null 2>&1; }

# How many row locks the LIVE function body carries, and whether the one this scenario targets is
# still there. Read from pg_proc, because the file on disk is not what the door runs.
locks_in() { q "SELECT (length(p.prosrc) - length(replace(upper(p.prosrc), 'FOR UPDATE', ''))) / 10
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = '$1'"; }
targeted_lock_present() { q "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname='public' AND p.proname='$1' AND p.prosrc ~ '$2')"; }

# Remove exactly ONE row lock: the first '  FOR UPDATE;' after the given anchor, inside the given
# function. Exits non-zero unless precisely one was removed, so a migration that is reshaped later
# cannot silently turn this into a no-op mutation.
#
# Two details that are easy to get wrong, and did:
#   · the line is replaced by a bare ';', not deleted. 'FOR UPDATE;' carries the terminator of the
#     SELECT it ends — dropping the whole line glues the next statement onto it and the file fails
#     to load, which would have looked like a RED for the wrong reason.
#   · it disarms permanently after the first hit. These migration files declare several doors, and
#     the anchor occurs in more than one of them, so an un-disarmed pass strips several locks and
#     the mutation stops being targeted.
mutate_one_lock() { # $1 src  $2 dst  $3 function marker  $4 anchor line
  awk -v fn="$3" -v anchor="$4" '
    index($0, fn)                        { infn = 1 }
    infn && !done && index($0, anchor)   { armed = 1 }
    armed && $0 ~ /^[[:space:]]*FOR UPDATE;[[:space:]]*$/ {
      armed = 0; done = 1; removed++
      match($0, /^[[:space:]]*/); print substr($0, 1, RLENGTH) ";"
      next
    }
    { print }
    END { if (removed != 1) exit 3 }
  ' "$1" > "$2"
}

# ── the two-connection run itself ────────────────────────────────────────────────────────────
# $1 = SQL for connection A's door call, $2 = SQL for connection B's door call.
# Sets: CONTENDED=yes|no, and leaves B's output in $tmp/b.out.
run_pair() {
  seed

  # A goes first, and that is established as STATE rather than assumed from launch order: after
  # booking through the door it takes advisory lock 777, which is visible in pg_locks to every
  # other session immediately and without committing. B is not started until that lock is seen.
  #
  # Launch order alone is not enough. Without this handshake B sometimes finished before A began,
  # which flips who wins the race — the amounts still came out right (the invariant has no
  # preferred winner) but "the loser refuses" then names the wrong connection, and the rendezvous
  # is missed entirely. Pinning A as the winner makes B deterministically the one that must refuse.
  "${PSQL[@]}" > "$tmp/a.out" 2>&1 <<SQL &
BEGIN;
$1
SELECT pg_advisory_lock(777);
SELECT public.conc_wait_for_go();
COMMIT;
SELECT pg_advisory_unlock(777);
SQL
  local apid=$!

  A_READY=no
  local t=0
  while [ $t -lt 600 ]; do
    if [ "$(q "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted AND objid = 777
                AND database = (SELECT oid FROM pg_database WHERE datname = current_database())" 2>/dev/null)" != "0" ]; then
      A_READY=yes; break
    fi
    kill -0 $apid 2>/dev/null || break
    t=$((t + 1))
  done

  "${PSQL[@]}" > "$tmp/b.out" 2>&1 <<SQL &
BEGIN;
$2
COMMIT;
SQL
  local bpid=$!

  # Wait for the two to actually meet — a STATE check, repeated, never a sleep of N seconds.
  # Each probe is one round trip, so this loop is also its own pacing.
  #
  # Scoped through pg_stat_activity rather than pg_locks.database, which does NOT work here: a
  # transaction waiting for a row lock waits on the HOLDER'S transactionid, and a transactionid
  # lock carries database = NULL. Filtering on that column hid the one row this loop exists to
  # find, and the first run of this gate reported "never contended" while the outcome was right —
  # which is exactly the vacuous green the contention assertion is here to refuse.
  CONTENDED=no
  local tries=0
  while [ $tries -lt 600 ]; do
    if [ "$(q "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                WHERE NOT l.granted AND a.datname = current_database()" 2>/dev/null)" != "0" ]; then
      CONTENDED=yes; break
    fi
    kill -0 $bpid 2>/dev/null || break     # B already finished: nothing left to contend with
    tries=$((tries + 1))
  done

  q "INSERT INTO public.conc_signal(name) VALUES ('go') ON CONFLICT DO NOTHING" > /dev/null 2>&1
  wait $apid; wait $bpid
}

line_links()  { q "SELECT count(*) FROM public.bank_tx_invoices WHERE transaction_id = '$LINE'"; }
line_applied(){ q "SELECT coalesce(sum(amount_applied), 0)::numeric(12,2) FROM public.bank_tx_invoices WHERE transaction_id = '$LINE'"; }
inv_links()   { q "SELECT count(*) FROM public.bank_tx_invoices WHERE invoice_id = '$INV1'"; }
inv_applied() { q "SELECT coalesce(sum(amount_applied), 0)::numeric(12,2) FROM public.bank_tx_invoices WHERE invoice_id = '$INV1'"; }
inv_paid()    { q "SELECT coalesce(amount_paid, 0)::numeric(12,2) FROM public.invoices WHERE id = '$INV1'"; }

# =====================================================================
# SCENARIO 1 — two bookings contend for ONE bank line
# =====================================================================
S1_MIGS="invoice_partial_payments.sql bank_rpc_never_payable_states.sql"
S1_FILE="bank_rpc_never_payable_states.sql"
S1_FN="apply_bank_payment"
S1_MARKER="FUNCTION public.apply_bank_payment"
S1_ANCHOR="FROM public.bank_transactions"
S1_LOCK_RE="FROM public[.]bank_transactions[^;]*FOR UPDATE"

s1_run() {
  run_pair "SELECT * FROM public.apply_bank_payment('$USER_ID','$LINE','$INV1',100,current_date);" \
           "SELECT * FROM public.apply_bank_payment('$USER_ID','$LINE','$INV2',100,current_date);"
}

scenario_1() {
  echo ""
  echo "══ [GELIJKTIJDIG-VAST] 1 · one EUR 100 bank line, two EUR 100 invoices, two connections ══"

  # ── with the shipped lock ──
  build_schema "$S1_MIGS" "" "" || return
  expect "the shipped door carries the bank-line lock" "$(targeted_lock_present $S1_FN "$S1_LOCK_RE")" "t"
  local locks_before; locks_before="$(locks_in $S1_FN)"
  s1_run
  echo "  — with the lock:"
  expect "  connection A reached the door first" "$A_READY" "yes"
  expect "  the two connections really contended" "$CONTENDED" "yes"
  expect "  one allocation against the line" "$(line_links)" "1"
  expect "  EUR 100 applied against a EUR 100 line" "$(line_applied)" "100.00"

  # ── the same scenario, one lock line removed from a disposable copy ──
  mutate_one_lock "$here/supabase/migrations/$S1_FILE" "$tmp/$S1_FILE" "$S1_MARKER" "$S1_ANCHOR" \
    || { fail "the mutation did not remove exactly one lock line — the migration has been reshaped"; return; }
  build_schema "$S1_MIGS" "$S1_FILE" "$tmp/$S1_FILE" || return
  echo "  — mutation, verified in the live function body before its result is believed:"
  expect "  the bank-line lock is gone from pg_proc" "$(targeted_lock_present $S1_FN "$S1_LOCK_RE")" "f"
  expect "  exactly one row lock fewer" "$(locks_in $S1_FN)" "$((locks_before - 1))"
  s1_run
  echo "  — without the lock, the gate must go RED with the measured shape:"
  expect "  two allocations against the line" "$(line_links)" "2"
  expect "  EUR 200 applied against a EUR 100 line" "$(line_applied)" "200.00"

  # ── restored ──
  build_schema "$S1_MIGS" "" "" || return
  expect "the lock is back" "$(targeted_lock_present $S1_FN "$S1_LOCK_RE")" "t"
  s1_run
  echo "  — with the lock restored:"
  expect "  connection A reached the door first" "$A_READY" "yes"
  expect "  the two connections really contended" "$CONTENDED" "yes"
  expect "  one allocation against the line" "$(line_links)" "1"
  expect "  EUR 100 applied against a EUR 100 line" "$(line_applied)" "100.00"
}

# =====================================================================
# SCENARIO 2 — two manual instalments contend for ONE invoice
# =====================================================================
# No client_key on either call, deliberately: bank_tx_invoices_unique_pair is
# (transaction_id, invoice_id) and a manual instalment has a NULL transaction_id, which a unique
# index treats as distinct. So neither unique index can catch this shape — the row lock is the
# only thing standing in the way, which is exactly what the mutation below proves.
S2_MIGS="invoice_manual_payments.sql invoice_manual_payment_idempotency_scope.sql"
S2_FILE="invoice_manual_payment_idempotency_scope.sql"
S2_FN="apply_manual_payment"
S2_MARKER="FUNCTION public.apply_manual_payment"
S2_ANCHOR="FROM public.invoices i"
S2_LOCK_RE="FROM public[.]invoices i[^;]*FOR UPDATE"

s2_run() {
  run_pair "SELECT * FROM public.apply_manual_payment('$USER_ID','$INV1',100,current_date,'kas',ARRAY['sent','received'],NULL);" \
           "SELECT * FROM public.apply_manual_payment('$USER_ID','$INV1',100,current_date,'kas',ARRAY['sent','received'],NULL);"
}

scenario_2() {
  echo ""
  echo "══ [GELIJKTIJDIG-VAST] 2 · the same invoice, two manual instalments, no client_key ══"

  build_schema "$S2_MIGS" "" "" || return
  expect "the shipped door carries the invoice lock" "$(targeted_lock_present $S2_FN "$S2_LOCK_RE")" "t"
  local locks_before; locks_before="$(locks_in $S2_FN)"
  s2_run
  echo "  — with the lock:"
  expect "  connection A reached the door first" "$A_READY" "yes"
  expect "  the two connections really contended" "$CONTENDED" "yes"
  expect "  one instalment on the invoice" "$(inv_links)" "1"
  expect "  EUR 100 applied" "$(inv_applied)" "100.00"
  expect "  amount_paid agrees with the links it is derived from" "$(inv_paid)" "$(inv_applied)"
  if grep -q "already fully paid" "$tmp/b.out"; then
    pass "  the loser refused with the contracted wording (already fully paid)"
  else
    fail "  the loser did not refuse with the contracted 'already fully paid' wording"
    sed 's/^/      /' "$tmp/b.out" >&2
  fi

  mutate_one_lock "$here/supabase/migrations/$S2_FILE" "$tmp/$S2_FILE" "$S2_MARKER" "$S2_ANCHOR" \
    || { fail "the mutation did not remove exactly one lock line — the migration has been reshaped"; return; }
  build_schema "$S2_MIGS" "$S2_FILE" "$tmp/$S2_FILE" || return
  echo "  — mutation, verified in the live function body before its result is believed:"
  expect "  the invoice lock is gone from pg_proc" "$(targeted_lock_present $S2_FN "$S2_LOCK_RE")" "f"
  expect "  exactly one row lock fewer" "$(locks_in $S2_FN)" "$((locks_before - 1))"
  s2_run
  echo "  — without the lock, the gate must go RED with the measured shape:"
  expect "  two instalments on one invoice" "$(inv_links)" "2"
  expect "  EUR 200 applied on a EUR 100 invoice" "$(inv_applied)" "200.00"
  expect "  …while amount_paid still reads EUR 100 — the totals disagree" "$(inv_paid)" "100.00"

  build_schema "$S2_MIGS" "" "" || return
  expect "the lock is back" "$(targeted_lock_present $S2_FN "$S2_LOCK_RE")" "t"
  s2_run
  echo "  — with the lock restored:"
  expect "  connection A reached the door first" "$A_READY" "yes"
  expect "  the two connections really contended" "$CONTENDED" "yes"
  expect "  one instalment on the invoice" "$(inv_links)" "1"
  expect "  EUR 100 applied" "$(inv_applied)" "100.00"
  expect "  amount_paid agrees with the links it is derived from" "$(inv_paid)" "$(inv_applied)"
}

scenario_1
scenario_2

echo ""
if [ "$failed" -ne 0 ]; then
  echo "✗ [GELIJKTIJDIG-VAST] a concurrency contract did not hold." >&2
  exit 1
fi
echo "✅ [GELIJKTIJDIG-VAST] both races held under two real connections, and both gates proved they can see the failure."

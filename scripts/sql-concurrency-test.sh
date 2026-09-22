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

# =====================================================================
# SCENARIO 3 — two client links deleted CONCURRENTLY: does the listing come down?
# =====================================================================
# The sequential case has been green since the trigger was written, and it proved nothing about
# this one. Under READ COMMITTED each delete's trigger takes its OWN snapshot, in which the other
# transaction's uncommitted delete does not exist — so both can conclude "I am not the last one"
# and both can be right about what they saw. The committed result is zero links and a listing
# still on the public page.
#
# The correction is not a better predicate, it is serialization: one advisory lock per accountant,
# taken FIRST by every path that takes it, and the predicate re-read afterwards on a fresh snapshot.
# Scenarios 3–5 show each lock is necessary; 4b and 6–8 show the order they are taken in is safe.
KG_MIGS="accountant_directory.sql accountant_directory_talen.sql accountant_directory_publish_requires_client_link.sql accountant_directory_publication_follows_evidence.sql"
KG_FILE="accountant_directory_publication_follows_evidence.sql"
KG_A=0a000000-0000-4000-8000-00000000000a
KG_C=0c000000-0000-4000-8000-00000000000c
KG_D=0d000000-0000-4000-8000-00000000000d

kg_seed()      { run -f "$here/tests/concurrency/kantoorgids-seed.sql" > /dev/null 2>&1; }
kg_links()     { q "SELECT count(*) FROM public.accountant_clients WHERE accountant_id = '$KG_A'"; }
kg_published() { q "SELECT coalesce((SELECT published FROM public.accountant_directory WHERE accountant_id = '$KG_A'), false)::text"; }
kg_anon_sees() { q "SELECT count(*) FROM public.accountant_directory d WHERE d.published AND d.accountant_id = '$KG_A'"; }
# The invariant itself, as one number: published listings with no current evidence behind them.
kg_violations(){ q "SELECT count(*) FROM public.accountant_directory d WHERE d.published
                     AND NOT EXISTS (SELECT 1 FROM public.accountant_clients ac WHERE ac.accountant_id = d.accountant_id)"; }

# Does the LIVE function body carry the serializer? Read from pg_proc, never from the file.
kg_serialiser_in() { q "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname='public' AND p.proname='$1' AND p.prosrc ~ 'pg_advisory_xact_lock')"; }

# Strip serialization out of the unlink trigger in a disposable copy. Two modes, because the two
# locks close DIFFERENT races and a mutation that removes the wrong one reports a false green — as
# the first version of this scenario did:
#
#   all      both lines. This reproduces the function body exactly as it stood at 367242823, i.e.
#            the state the reviewer asked to see fail. The row lock alone already closes the
#            unlink-versus-unlink race, so removing only the advisory lock leaves scenario 3 green
#            and proves nothing.
#   advisory the advisory lock only, keeping the row lock. That isolates the one race the row lock
#            cannot close — a publish by INSERT, where there is no row to lock yet — and is how the
#            advisory lock earns its place rather than being decoration.
#
# Exits non-zero unless exactly the expected number of lines went, so a reshaped migration cannot
# quietly turn this into a no-op mutation.
kg_mutate_lock() { # $1 src  $2 dst  $3 function marker  $4 mode (all|advisory)
  awk -v fn="$3" -v mode="$4" '
    index($0, fn)                            { infn = 1 }
    # The row lock is THREE lines (PERFORM / WHERE / FOR UPDATE;), so it is skipped as a block.
    # A rule matching the bare "FOR UPDATE;" line first would cut the terminator off its own
    # statement and leave a dangling PERFORM — a file that fails to load, which reads as a RED for
    # entirely the wrong reason.
    infn && mode == "all" && !rowdone && /PERFORM 1 FROM public\.accountant_directory/ { skipping = 1; next }
    skipping && /FOR UPDATE;/                { skipping = 0; rowdone = 1; removed++; next }
    skipping                                 { next }
    infn && !advdone && /pg_advisory_xact_lock/ { advdone = 1; removed++; next }
    { print }
    END {
      want = (mode == "all") ? 2 : 1
      if (removed != want) exit 3
    }
  ' "$1" > "$2"
}

# Is the row lock still in the LIVE unlink body? Read from pg_proc, never from the file.
kg_rowlock_in() { q "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname='public' AND p.proname='accountant_directory_unpublish_on_last_unlink'
                        AND p.prosrc ~ 'FOR UPDATE')"; }

kg_run_pair() { # $1 = A's statement, $2 = B's statement
  kg_seed
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

  CONTENDED=no
  local tries=0
  while [ $tries -lt 600 ]; do
    if [ "$(q "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                WHERE NOT l.granted AND a.datname = current_database()" 2>/dev/null)" != "0" ]; then
      CONTENDED=yes; break
    fi
    kill -0 $bpid 2>/dev/null || break
    tries=$((tries + 1))
  done

  q "INSERT INTO public.conc_signal(name) VALUES ('go') ON CONFLICT DO NOTHING" > /dev/null 2>&1
  wait $apid; wait $bpid
}

s3_run() {
  kg_run_pair "DELETE FROM public.accountant_clients WHERE accountant_id = '$KG_A' AND zzper_id = '$KG_C';" \
              "DELETE FROM public.accountant_clients WHERE accountant_id = '$KG_A' AND zzper_id = '$KG_D';"
}

scenario_3() {
  echo ""
  echo "══ [KANTOORGIDS-BEWIJS] 3 · two clients unlink at the same time, two connections ══"

  build_schema "$KG_MIGS" "" "" || return
  expect "the shipped unlink trigger carries the serializer" "$(kg_serialiser_in accountant_directory_unpublish_on_last_unlink)" "t"
  s3_run
  echo "  — with the serializer:"
  expect "  connection A reached the delete first" "$A_READY" "yes"
  expect "  the two connections really contended" "$CONTENDED" "yes"
  expect "  no client link is left" "$(kg_links)" "0"
  expect "  the listing is no longer published" "$(kg_published)" "false"
  expect "  anon cannot see the office" "$(kg_anon_sees)" "0"
  expect "  no published listing without evidence" "$(kg_violations)" "0"

  # ── the same race, with the serializer removed from a disposable copy ──
  kg_mutate_lock "$here/supabase/migrations/$KG_FILE" "$tmp/$KG_FILE" "FUNCTION public.accountant_directory_unpublish_on_last_unlink" all \
    || { fail "the mutation did not strip exactly the two serialization lines — the migration has been reshaped"; return; }
  build_schema "$KG_MIGS" "$KG_FILE" "$tmp/$KG_FILE" || return
  echo "  — mutation, verified in the live function body before its result is believed:"
  expect "  the advisory lock is gone from pg_proc" "$(kg_serialiser_in accountant_directory_unpublish_on_last_unlink)" "f"
  expect "  …and so is the row lock — this is the 367242823 body" "$(kg_rowlock_in)" "f"
  s3_run
  echo "  — without it, the race must go RED with the measured shape:"
  expect "  no client link is left" "$(kg_links)" "0"
  expect "  …and the listing is STILL published" "$(kg_published)" "true"
  expect "  …so anon still sees an office with no clients" "$(kg_anon_sees)" "1"
  expect "  the invariant is violated" "$(kg_violations)" "1"

  build_schema "$KG_MIGS" "" "" || return
  expect "the serializer is back" "$(kg_serialiser_in accountant_directory_unpublish_on_last_unlink)" "t"
  s3_run
  echo "  — with the serializer restored:"
  expect "  connection A reached the delete first" "$A_READY" "yes"
  expect "  the two connections really contended" "$CONTENDED" "yes"
  expect "  the listing is no longer published" "$(kg_published)" "false"
  expect "  no published listing without evidence" "$(kg_violations)" "0"
}

# =====================================================================
# SCENARIO 4 — publish versus the last unlink
# =====================================================================
# One link, a draft listing. One connection publishes; the other removes the last client. Whatever
# order they settle in, the committed state must not be "published with no evidence".
#
# A publishes first here (the rendezvous pins that), so the publish is VALID when it is made and
# only becomes wrong while it is still uncommitted. That is the harder half: the write-time policy
# cannot refuse it, because at the moment it ran the evidence was there.
s4_run() {
  kg_seed
  # One link and a draft: the starting state this scenario is about.
  run -c "DELETE FROM public.accountant_clients WHERE accountant_id = '$KG_A' AND zzper_id = '$KG_D';
          UPDATE public.accountant_directory SET published = false WHERE accountant_id = '$KG_A';" > /dev/null 2>&1
  q "TRUNCATE public.conc_signal" > /dev/null 2>&1

  "${PSQL[@]}" > "$tmp/a.out" 2>&1 <<SQL &
BEGIN;
UPDATE public.accountant_directory SET published = true WHERE accountant_id = '$KG_A';
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
DELETE FROM public.accountant_clients WHERE accountant_id = '$KG_A' AND zzper_id = '$KG_C';
COMMIT;
SQL
  local bpid=$!
  CONTENDED=no
  local tries=0
  while [ $tries -lt 600 ]; do
    if [ "$(q "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                WHERE NOT l.granted AND a.datname = current_database()" 2>/dev/null)" != "0" ]; then
      CONTENDED=yes; break
    fi
    kill -0 $bpid 2>/dev/null || break
    tries=$((tries + 1))
  done

  q "INSERT INTO public.conc_signal(name) VALUES ('go') ON CONFLICT DO NOTHING" > /dev/null 2>&1
  wait $apid; wait $bpid
}

scenario_4() {
  echo ""
  echo "══ [KANTOORGIDS-BEWIJS] 4 · one publishes while the other removes the last client ══"

  build_schema "$KG_MIGS" "" "" || return
  s4_run
  echo "  — with the serializer:"
  expect "  connection A published first" "$A_READY" "yes"
  expect "  the two connections really contended" "$CONTENDED" "yes"
  expect "  no client link is left" "$(kg_links)" "0"
  expect "  the listing is not published" "$(kg_published)" "false"
  expect "  anon cannot see the office" "$(kg_anon_sees)" "0"
  expect "  no published listing without evidence" "$(kg_violations)" "0"

  kg_mutate_lock "$here/supabase/migrations/$KG_FILE" "$tmp/$KG_FILE" "FUNCTION public.accountant_directory_unpublish_on_last_unlink" all \
    || { fail "the mutation did not strip exactly the two serialization lines — the migration has been reshaped"; return; }
  build_schema "$KG_MIGS" "$KG_FILE" "$tmp/$KG_FILE" || return
  echo "  — mutation, verified in the live function body before its result is believed:"
  expect "  the advisory lock is gone from pg_proc" "$(kg_serialiser_in accountant_directory_unpublish_on_last_unlink)" "f"
  expect "  …and so is the row lock — this is the 367242823 body" "$(kg_rowlock_in)" "f"
  s4_run
  echo "  — without it, the race must go RED with the measured shape:"
  expect "  no client link is left" "$(kg_links)" "0"
  expect "  …and the listing is STILL published" "$(kg_published)" "true"
  expect "  the invariant is violated" "$(kg_violations)" "1"

  build_schema "$KG_MIGS" "" "" || return
  s4_run
  echo "  — with the serializer restored:"
  expect "  connection A published first" "$A_READY" "yes"
  expect "  the two connections really contended" "$CONTENDED" "yes"
  expect "  the listing is not published" "$(kg_published)" "false"
  expect "  no published listing without evidence" "$(kg_violations)" "0"
}

# =====================================================================
# SCENARIO 5 — publish by INSERT versus the last unlink
# =====================================================================
# This is the race the ROW lock cannot close, and therefore the one that shows why the advisory
# lock is there at all. A brand-new office whose first save IS a publish inserts the directory row;
# there is no pre-existing tuple, so the unlink trigger's `FOR UPDATE` finds nothing to wait on and
# sails straight past. Its UPDATE then matches zero rows, because the inserting transaction has not
# committed and its row is invisible — and a moment later it commits, published, with no evidence.
#
# The mutation here removes ONLY the advisory lock and keeps the row lock, so the RED below is
# attributable to that one line and nothing else.
s5_run() {
  kg_seed
  # One link, and NO directory row: the state a new office is in before its first save.
  run -c "DELETE FROM public.accountant_clients WHERE accountant_id = '$KG_A' AND zzper_id = '$KG_D';
          DELETE FROM public.accountant_directory WHERE accountant_id = '$KG_A';" > /dev/null 2>&1
  q "TRUNCATE public.conc_signal" > /dev/null 2>&1

  "${PSQL[@]}" > "$tmp/a.out" 2>&1 <<SQL &
BEGIN;
INSERT INTO public.accountant_directory
  (accountant_id, office_name, city, contact_email, languages, published)
VALUES ('$KG_A', 'Kantoor A', 'Utrecht', 'a@a.nl', ARRAY['nl'], true);
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
DELETE FROM public.accountant_clients WHERE accountant_id = '$KG_A' AND zzper_id = '$KG_C';
COMMIT;
SQL
  local bpid=$!
  CONTENDED=no
  local tries=0
  while [ $tries -lt 600 ]; do
    if [ "$(q "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                WHERE NOT l.granted AND a.datname = current_database()" 2>/dev/null)" != "0" ]; then
      CONTENDED=yes; break
    fi
    kill -0 $bpid 2>/dev/null || break
    tries=$((tries + 1))
  done

  q "INSERT INTO public.conc_signal(name) VALUES ('go') ON CONFLICT DO NOTHING" > /dev/null 2>&1
  wait $apid; wait $bpid
}

scenario_5() {
  echo ""
  echo "══ [KANTOORGIDS-BEWIJS] 5 · a first-save publish (INSERT) while the last client unlinks ══"

  build_schema "$KG_MIGS" "" "" || return
  s5_run
  echo "  — with the advisory lock:"
  expect "  connection A inserted first" "$A_READY" "yes"
  expect "  the two connections really contended" "$CONTENDED" "yes"
  expect "  no client link is left" "$(kg_links)" "0"
  expect "  the listing is not published" "$(kg_published)" "false"
  expect "  anon cannot see the office" "$(kg_anon_sees)" "0"
  expect "  no published listing without evidence" "$(kg_violations)" "0"

  # ONLY the advisory lock, so the RED is attributable to that one line. The row lock stays, and
  # is asserted to have stayed — otherwise this scenario would be re-proving scenario 3.
  kg_mutate_lock "$here/supabase/migrations/$KG_FILE" "$tmp/$KG_FILE" "FUNCTION public.accountant_directory_unpublish_on_last_unlink" advisory \
    || { fail "the mutation did not remove exactly one advisory lock — the migration has been reshaped"; return; }
  build_schema "$KG_MIGS" "$KG_FILE" "$tmp/$KG_FILE" || return
  echo "  — mutation, verified in the live function body before its result is believed:"
  expect "  the advisory lock is gone from pg_proc" "$(kg_serialiser_in accountant_directory_unpublish_on_last_unlink)" "f"
  expect "  …while the ROW lock is still there — only one line moved" "$(kg_rowlock_in)" "t"
  s5_run
  echo "  — without it, the row lock alone cannot see an uncommitted INSERT:"
  expect "  no client link is left" "$(kg_links)" "0"
  expect "  …and the listing is STILL published" "$(kg_published)" "true"
  expect "  the invariant is violated" "$(kg_violations)" "1"

  build_schema "$KG_MIGS" "" "" || return
  s5_run
  echo "  — with the advisory lock restored:"
  expect "  connection A inserted first" "$A_READY" "yes"
  expect "  the two connections really contended" "$CONTENDED" "yes"
  expect "  the listing is not published" "$(kg_published)" "false"
  expect "  no published listing without evidence" "$(kg_violations)" "0"
}

# =====================================================================
# SCENARIOS 6–8 — the lock ORDER, not only the locks
# =====================================================================
# Scenarios 3–5 prove that each lock is necessary. These prove that the order they are taken in
# cannot deadlock — under the statement the application really sends, and under the shapes that
# decide the order.
#
# The rule (see LOCK ORDER in the migration): ADVISORY LOCK → DIRECTORY TUPLE on every path, and a
# plain UPDATE, which PostgreSQL has already given the tuple, takes no advisory lock at all.
#
# Several windows below lie INSIDE one statement — after a BEFORE trigger has run, before
# PostgreSQL finds the upsert's conflict — where no barrier between statements can reach. The
# seed's test-only hold triggers pause a connection exactly there, and only a connection that
# asked for it (conc.hold). Each connection is named (application_name), so the driver reads THAT
# connection's locks in pg_locks rather than any lock anywhere.

# /api/kantoorgids never publishes with a bare UPDATE or a bare INSERT. It calls supabase-js
# .upsert(payload, { onConflict: 'accountant_id' }), which PostgREST sends as this statement, with
# the route's payload: every column the route writes, in the route's order.
KG_UPSERT="INSERT INTO public.accountant_directory
  (accountant_id, office_name, city, specialisms, accepting_clients, contact_email, website, published, languages, updated_at)
VALUES ('$KG_A', 'Kantoor A', 'Utrecht', '{}', false, 'a@a.nl', NULL, true, ARRAY['nl'], now())
ON CONFLICT (accountant_id) DO UPDATE SET
  office_name = EXCLUDED.office_name, city = EXCLUDED.city, specialisms = EXCLUDED.specialisms,
  accepting_clients = EXCLUDED.accepting_clients, contact_email = EXCLUDED.contact_email,
  website = EXCLUDED.website, published = EXCLUDED.published, languages = EXCLUDED.languages,
  updated_at = EXCLUDED.updated_at;"
KG_UNLINK_C="DELETE FROM public.accountant_clients WHERE accountant_id = '$KG_A' AND zzper_id = '$KG_C';"

# THIS accountant's advisory lock, as pg_locks shows a bigint key: high word in classid, low in objid.
KG_LOCK="l.locktype = 'advisory' AND l.objsubid = 1
  AND l.classid = ((hashtextextended('$KG_A', 0) >> 32) & 4294967295)::oid
  AND l.objid   = (hashtextextended('$KG_A', 0) & 4294967295)::oid"

kg_lock_of()  { # $1 application_name  $2 granted (true|false) → rows of this accountant's advisory lock
  q "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE a.application_name = '$1' AND l.granted = $2 AND $KG_LOCK"; }
kg_waits()    { q "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                    WHERE a.application_name = '$1' AND NOT l.granted"; }
kg_held()     { q "SELECT count(*) FROM pg_stat_activity WHERE application_name = '$1' AND wait_event = 'PgSleep'"; }
kg_barrier()  { q "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted AND objid = 777
                    AND database = (SELECT oid FROM pg_database WHERE datname = current_database())"; }
kg_signal()   { q "INSERT INTO public.conc_signal(name) VALUES ('$1') ON CONFLICT DO NOTHING" > /dev/null 2>&1; }

# Is the directory tuple locked by anyone right now? A NOWAIT probe, rolled back at once. Only
# called while every other connection is parked (asleep at a hold point, or queued for the
# advisory lock), so the probe's instant of holding it disturbs nothing.
kg_tuple() {
  if "${PSQL[@]}" -v ON_ERROR_STOP=1 > /dev/null 2>&1 <<SQL
BEGIN;
SELECT 1 FROM public.accountant_directory WHERE accountant_id = '$KG_A' FOR UPDATE NOWAIT;
ROLLBACK;
SQL
  then echo free; else echo locked; fi
}

# Poll until "$1" prints "$2", or until pid $3 has gone. Prints yes/no. A missed step is a failure.
kg_until() {
  local t=0
  while [ $t -lt 600 ]; do
    [ "$(eval "$1")" = "$2" ] && { echo yes; return; }
    kill -0 "$3" 2>/dev/null || { echo no; return; }
    t=$((t + 1))
  done
  echo no
}

# Every connection's output, classified: deadlocks, the contracted 42501 refusal, anything else.
kg_classify() {
  KG_DEADLOCK=$(cat "$tmp"/k_*.out | grep -ci 'deadlock detected')
  KG_REFUSED=$(cat "$tmp"/k_*.out | grep -c 'needs at least one consented client link')
  KG_UNEXPECTED=$(cat "$tmp"/k_*.out | grep 'ERROR' | grep -v 'needs at least one consented client link' | grep -vci 'deadlock detected')
}

kg_settled() { # the outcomes the review requires, whichever interleaving ran
  expect "  no deadlock" "$KG_DEADLOCK" "0"
  expect "  no unexpected transaction abort" "$KG_UNEXPECTED" "0"
  expect "  no client link is left" "$(kg_links)" "0"
  expect "  the listing is not published" "$(kg_published)" "false"
  expect "  anon cannot see the office" "$(kg_anon_sees)" "0"
  expect "  no published listing without evidence" "$(kg_violations)" "0"
}

# A connection, named, in the background. $1 name  $2 SQL. Its pid lands in KG_PID.
kg_conn() {
  rm -f "$tmp/k_$1.out"
  PGAPPNAME="$1" "${PSQL[@]}" -v ON_ERROR_STOP=0 > "$tmp/k_$1.out" 2>&1 <<SQL &
$2
SQL
  KG_PID=$!
}

kg_draft_one_link() { # an office with a draft and exactly one client — just before it publishes
  kg_seed
  run -c "DELETE FROM public.accountant_clients WHERE accountant_id = '$KG_A' AND zzper_id = '$KG_D';
          UPDATE public.accountant_directory SET published = false WHERE accountant_id = '$KG_A';" > /dev/null 2>&1
  rm -f "$tmp"/k_*.out; q "TRUNCATE public.conc_signal" > /dev/null 2>&1
}
kg_no_row_one_link() { # a new office: one client, and no directory row yet
  kg_seed
  run -c "DELETE FROM public.accountant_clients WHERE accountant_id = '$KG_A' AND zzper_id = '$KG_D';
          DELETE FROM public.accountant_directory WHERE accountant_id = '$KG_A';" > /dev/null 2>&1
  rm -f "$tmp"/k_*.out; q "TRUNCATE public.conc_signal" > /dev/null 2>&1
}

# ── what the LIVE function bodies say, read from pg_proc and never from the file ──
kg_unlink_order() { q "SELECT CASE WHEN strpos(prosrc, 'pg_advisory_xact_lock') < strpos(prosrc, 'FOR UPDATE')
                                   THEN 'advisory-first' ELSE 'tuple-first' END
                         FROM pg_proc WHERE proname = 'accountant_directory_unpublish_on_last_unlink'"; }
kg_publish_lock_when() { q "SELECT substring(prosrc FROM '\n\s*IF ([^\n]*) THEN\s*\n\s*PERFORM pg_advisory_xact_lock')
                              FROM pg_proc WHERE proname = 'accountant_directory_publication_needs_evidence'"; }
KG_ARRIVAL="TG_OP = 'INSERT' OR NEW.accountant_id IS DISTINCT FROM OLD.accountant_id"

# ── mutations, each into a disposable copy, each refusing to run unless it landed exactly once ──
# The unlink trigger with its two locks in the e8ea973 order: the tuple, then the advisory lock.
kg_mutate_unlink_order() { # $1 src  $2 dst
  awk '
    index($0, "CREATE OR REPLACE FUNCTION public.accountant_directory_unpublish_on_last_unlink") { infn = 1 }
    infn && held == "" && /pg_advisory_xact_lock/ { held = $0; next }
    infn && held != "" && !moved && /FOR UPDATE;/ { print; print held; moved = 1; next }
    { print }
    END { if (!moved) exit 3 }
  ' "$1" > "$2"
}
# The publish trigger's lock condition, replaced by $3. Exactly one line, or exit 3.
kg_mutate_arrival() { # $1 src  $2 dst  $3 new condition
  awk -v old="IF $KG_ARRIVAL THEN" -v new="IF $3 THEN" '
    { line = $0; sub(/^[ \t]+/, "", line) }
    line == old { print "  " new; n++; next }
    { print }
    END { if (n != 1) exit 3 }
  ' "$1" > "$2"
}

# =====================================================================
# SCENARIO 6 — the REAL writer: the route's UPSERT versus the last unlink
# =====================================================================
# An existing draft, one client, and the office publishes through the route while that client
# unlinks. The upsert publishes an existing row through ON CONFLICT DO UPDATE, and PostgreSQL fires
# the BEFORE INSERT trigger on the PROPOSED row before it finds that conflict — so the upsert takes
# the advisory lock BEFORE it touches the tuple. Scenario 4's plain UPDATE could not show this.
#
# At e8ea973 the unlink trigger took tuple → advisory, the reverse, and this is the pair that
# deadlocked on a real PostgreSQL: the office's save or the client's unlink aborted, whichever
# had waited longer.
#
#   6a  the upsert holds the advisory lock first and is parked right after its BEFORE INSERT
#       trigger — the e8ea973 deadlock window. The unlink must queue for the advisory lock holding
#       NO directory tuple. Released, the upsert publishes (valid: the delete is uncommitted), and
#       the unlink then takes the listing down.
#   6b  the unlink commits first. The upsert queues for the advisory lock, re-reads on a fresh
#       snapshot and is REFUSED with the contracted 42501 — which /api/kantoorgids answers with the
#       eligibility sentence, not with "Opslaan is niet gelukt."
#
# The mutation puts the unlink trigger back in the e8ea973 order, verified in pg_proc, and 6a must
# go RED with a deadlock.
s6a_run() {
  kg_draft_one_link
  kg_conn kg_upsert "SET conc.hold = 'after-evidence';
BEGIN;
$KG_UPSERT
COMMIT;"
  local apid=$KG_PID
  S6_A_PARKED=$(kg_until "kg_held kg_upsert" 1 $apid)
  S6_A_LOCK=$(kg_lock_of kg_upsert true)

  kg_conn kg_unlink "BEGIN;
$KG_UNLINK_C
COMMIT;"
  local bpid=$KG_PID
  S6_B_QUEUED=$(kg_until "kg_lock_of kg_unlink false" 1 $bpid)
  S6_TUPLE=$(kg_tuple)

  kg_signal hold-go
  wait $apid; wait $bpid
  kg_classify
}

s6b_run() {
  kg_draft_one_link
  kg_conn kg_unlink "BEGIN;
$KG_UNLINK_C
SELECT pg_advisory_lock(777);
SELECT public.conc_wait_for_go();
COMMIT;
SELECT pg_advisory_unlock(777);"
  local bpid=$KG_PID
  S6_B_FIRST=$(kg_until kg_barrier 1 $bpid)

  kg_conn kg_upsert "BEGIN;
$KG_UPSERT
COMMIT;"
  local apid=$KG_PID
  S6_A_QUEUED=$(kg_until "kg_lock_of kg_upsert false" 1 $apid)

  kg_signal go
  wait $apid; wait $bpid
  kg_classify
}

scenario_6() {
  echo ""
  echo "══ [KANTOORGIDS-BEWIJS] 6 · the route's real UPSERT (ON CONFLICT DO UPDATE) versus the last unlink ══"

  build_schema "$KG_MIGS" "" "" || return
  expect "the shipped unlink trigger takes the advisory lock before the tuple" "$(kg_unlink_order)" "advisory-first"

  s6a_run
  echo "  — 6a · the upsert holds the advisory lock first (the e8ea973 deadlock window):"
  expect "  the upsert is parked after its BEFORE INSERT trigger" "$S6_A_PARKED" "yes"
  expect "  …holding this accountant's advisory lock" "$S6_A_LOCK" "1"
  expect "  the unlink really queues for that lock" "$S6_B_QUEUED" "yes"
  expect "  …holding NO directory tuple the upsert will need" "$S6_TUPLE" "free"
  kg_settled
  expect "  nothing was refused — the publish was valid when made" "$KG_REFUSED" "0"

  s6b_run
  echo "  — 6b · the unlink commits first:"
  expect "  the unlink reached its delete first" "$S6_B_FIRST" "yes"
  expect "  the upsert really queues for the advisory lock" "$S6_A_QUEUED" "yes"
  kg_settled
  expect "  the upsert is refused with the contracted 42501" "$KG_REFUSED" "1"

  kg_mutate_unlink_order "$here/supabase/migrations/$KG_FILE" "$tmp/$KG_FILE" \
    || { fail "the mutation did not reorder the unlink trigger's locks — the migration has been reshaped"; return; }
  build_schema "$KG_MIGS" "$KG_FILE" "$tmp/$KG_FILE" || return
  echo "  — mutation, verified in the live function body before its result is believed:"
  expect "  the unlink trigger takes the tuple first again (the e8ea973 order)" "$(kg_unlink_order)" "tuple-first"
  s6a_run
  echo "  — in that order, 6a must go RED with the measured shape:"
  expect "  the unlink now HOLDS the tuple while it queues" "$S6_TUPLE" "locked"
  expect "  deadlock detected" "$KG_DEADLOCK" "1"
  expect "  …and the invariant still holds — a deadlock victim commits nothing" "$(kg_violations)" "0"

  build_schema "$KG_MIGS" "" "" || return
  expect "the shipped order is back" "$(kg_unlink_order)" "advisory-first"
  s6a_run
  echo "  — with the shipped order restored:"
  expect "  …holding NO directory tuple the upsert will need" "$S6_TUPLE" "free"
  kg_settled
}

# =====================================================================
# SCENARIO 7 — two first saves and an unlink: three connections
# =====================================================================
# A new office double-submits its first publish (two tabs, a retried request) while its client
# unlinks. Both upserts start as INSERTs. The second queues for the advisory lock behind the first;
# the first commits the row; the second then finds that row as a conflict and needs its tuple.
#
# This is the case that rules out the other obvious order. Taking the tuple FIRST inside the publish
# trigger cannot help the second save: when it asked for the lock there was no row to take. Found
# under stress with that order in place — one `deadlock detected` in 1 200 rounds — and pinned here
# deterministically: the second save is parked, holding the advisory lock, just before it finds the
# conflict, while the unlink arrives.
s7_run() {
  kg_no_row_one_link
  kg_conn kg_first "BEGIN;
$KG_UPSERT
SELECT pg_advisory_lock(777);
SELECT public.conc_wait_for_go();
COMMIT;
SELECT pg_advisory_unlock(777);"
  local xpid=$KG_PID
  S7_X_FIRST=$(kg_until kg_barrier 1 $xpid)

  kg_conn kg_second "SET conc.hold = 'after-evidence';
BEGIN;
$KG_UPSERT
COMMIT;"
  local ypid=$KG_PID
  S7_Y_QUEUED=$(kg_until "kg_lock_of kg_second false" 1 $ypid)

  kg_signal go
  wait $xpid
  S7_Y_PARKED=$(kg_until "kg_held kg_second" 1 $ypid)
  S7_Y_LOCK=$(kg_lock_of kg_second true)
  S7_ROW=$(q "SELECT count(*) FROM public.accountant_directory WHERE accountant_id = '$KG_A'")

  kg_conn kg_unlink "BEGIN;
$KG_UNLINK_C
COMMIT;"
  local upid=$KG_PID
  S7_U_QUEUED=$(kg_until "kg_lock_of kg_unlink false" 1 $upid)
  S7_TUPLE=$(kg_tuple)

  kg_signal hold-go
  wait $ypid; wait $upid
  kg_classify
}

scenario_7() {
  echo ""
  echo "══ [KANTOORGIDS-BEWIJS] 7 · two first-save UPSERTs and the last unlink, three connections ══"

  build_schema "$KG_MIGS" "" "" || return
  s7_run
  echo "  — with the shipped order:"
  expect "  the first save inserted and holds its transaction open" "$S7_X_FIRST" "yes"
  expect "  the second save queues behind it for the advisory lock" "$S7_Y_QUEUED" "yes"
  expect "  the first save's row is committed before the second goes on" "$S7_ROW" "1"
  expect "  the second save is parked, holding the advisory lock" "$S7_Y_PARKED/$S7_Y_LOCK" "yes/1"
  expect "  the unlink really queues for that lock" "$S7_U_QUEUED" "yes"
  expect "  …holding NO directory tuple the second save will need" "$S7_TUPLE" "free"
  kg_settled
  expect "  nothing was refused — both publishes were valid when made" "$KG_REFUSED" "0"

  kg_mutate_unlink_order "$here/supabase/migrations/$KG_FILE" "$tmp/$KG_FILE" \
    || { fail "the mutation did not reorder the unlink trigger's locks — the migration has been reshaped"; return; }
  build_schema "$KG_MIGS" "$KG_FILE" "$tmp/$KG_FILE" || return
  echo "  — mutation, verified in the live function body before its result is believed:"
  expect "  the unlink trigger takes the tuple first again" "$(kg_unlink_order)" "tuple-first"
  s7_run
  echo "  — in that order, the three-party case must go RED:"
  expect "  the unlink HOLDS the first save's tuple while it queues" "$S7_TUPLE" "locked"
  expect "  deadlock detected" "$KG_DEADLOCK" "1"
  expect "  …and the invariant still holds" "$(kg_violations)" "0"

  build_schema "$KG_MIGS" "" "" || return
  s7_run
  echo "  — with the shipped order restored:"
  expect "  …holding NO directory tuple the second save will need" "$S7_TUPLE" "free"
  kg_settled
}

# =====================================================================
# SCENARIO 4b — why the plain UPDATE takes NO advisory lock
# =====================================================================
# PostgreSQL locks the tuple before any BEFORE UPDATE trigger runs. A publish trigger that asked for
# the advisory lock on an UPDATE would therefore hold tuple → want advisory: the reverse of the
# unlink. The UPDATE is parked with the tuple in hand, before the evidence trigger, and the unlink
# arrives: it takes the advisory lock and queues for the tuple. Shipped, the UPDATE never asks for
# the advisory lock and both finish. Mutated so the UPDATE asks for it, they deadlock.
#
# This is the Data API's own publish shape too: the office may PATCH its row directly, and PostgREST
# sends that as a plain UPDATE.
s4b_run() {
  kg_draft_one_link
  kg_conn kg_update "SET conc.hold = 'before-evidence';
BEGIN;
UPDATE public.accountant_directory SET published = true WHERE accountant_id = '$KG_A';
COMMIT;"
  local apid=$KG_PID
  S4B_A_PARKED=$(kg_until "kg_held kg_update" 1 $apid)

  kg_conn kg_unlink "BEGIN;
$KG_UNLINK_C
COMMIT;"
  local bpid=$KG_PID
  S4B_B_LOCK=$(kg_until "kg_lock_of kg_unlink true" 1 $bpid)
  S4B_B_WAITS=$(kg_until "kg_waits kg_unlink" 1 $bpid)

  kg_signal hold-go
  wait $apid; wait $bpid
  kg_classify
}

scenario_4b() {
  echo ""
  echo "══ [KANTOORGIDS-BEWIJS] 4b · a plain UPDATE publish holds the tuple; the unlink holds the lock ══"

  build_schema "$KG_MIGS" "" "" || return
  expect "the shipped publish trigger locks only on arrival" "$(kg_publish_lock_when)" "$KG_ARRIVAL"
  s4b_run
  echo "  — shipped:"
  expect "  the UPDATE is parked holding the tuple, before the evidence trigger" "$S4B_A_PARKED" "yes"
  expect "  the unlink holds this accountant's advisory lock" "$S4B_B_LOCK" "yes"
  expect "  …and queues for the tuple" "$S4B_B_WAITS" "yes"
  kg_settled
  expect "  nothing was refused — the publish was valid when made" "$KG_REFUSED" "0"

  kg_mutate_arrival "$here/supabase/migrations/$KG_FILE" "$tmp/$KG_FILE" "true" \
    || { fail "the mutation did not replace the publish trigger's lock condition — the migration has been reshaped"; return; }
  build_schema "$KG_MIGS" "$KG_FILE" "$tmp/$KG_FILE" || return
  echo "  — mutation, verified in the live function body before its result is believed:"
  expect "  the publish trigger now locks on every write, UPDATE included" "$(kg_publish_lock_when)" "true"
  s4b_run
  echo "  — then a plain UPDATE holds tuple → wants advisory, and must go RED:"
  expect "  deadlock detected" "$KG_DEADLOCK" "1"
  expect "  …and the invariant still holds" "$(kg_violations)" "0"

  build_schema "$KG_MIGS" "" "" || return
  s4b_run
  echo "  — shipped, restored:"
  expect "  the unlink holds this accountant's advisory lock" "$S4B_B_LOCK" "yes"
  kg_settled
}

# =====================================================================
# SCENARIO 8 — a row that ARRIVES without a publishing INSERT
# =====================================================================
# An uncommitted row is invisible, so the unlink trigger's FOR UPDATE cannot wait on a row that is
# still arriving; only the advisory lock can order the two. That is why the publish trigger takes
# it on EVERY arrival, published or not:
#
#   8a  a draft INSERT, then a publishing UPDATE, in ONE transaction;
#   8b  an UPDATE that moves another office's draft to this accountant_id, and publishes it.
#
# Neither is reachable from a session — PostgREST runs one statement per request, and the UPDATE
# policy pins accountant_id — but the invariant is the database's, for every writer. Each case has
# its own mutation, removing exactly the half of the condition that covers it.
s8_run() { # $1 = the arriving transaction's statements
  kg_no_row_one_link
  if [ "${2:-}" = "rekey" ]; then
    run -c "INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages, published)
            VALUES ('$KG_D', 'Kantoor D', 'Utrecht', 'd@d.nl', ARRAY['nl'], false);" > /dev/null 2>&1
  fi
  kg_conn kg_arrive "BEGIN;
$1
SELECT pg_advisory_lock(777);
SELECT public.conc_wait_for_go();
COMMIT;
SELECT pg_advisory_unlock(777);"
  local xpid=$KG_PID
  S8_X_FIRST=$(kg_until kg_barrier 1 $xpid)

  kg_conn kg_unlink "BEGIN;
$KG_UNLINK_C
COMMIT;"
  local upid=$KG_PID
  # Shipped, the unlink queues for the lock. Mutated, it never does — it finishes on its own. So
  # wait for EITHER, and record which one it was.
  local t=0; S8_U_QUEUED=no
  while [ $t -lt 600 ]; do
    [ "$(kg_lock_of kg_unlink false)" = "1" ] && { S8_U_QUEUED=yes; break; }
    kill -0 $upid 2>/dev/null || break
    t=$((t + 1))
  done

  kg_signal go
  wait $xpid; wait $upid
  kg_classify
}
S8A="INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages, published)
VALUES ('$KG_A', 'Kantoor A', 'Utrecht', 'a@a.nl', ARRAY['nl'], false);
UPDATE public.accountant_directory SET published = true WHERE accountant_id = '$KG_A';"
S8B="UPDATE public.accountant_directory SET accountant_id = '$KG_A', published = true WHERE accountant_id = '$KG_D';"

scenario_8() {
  echo ""
  echo "══ [KANTOORGIDS-BEWIJS] 8 · a row that arrives without a publishing INSERT ══"

  build_schema "$KG_MIGS" "" "" || return
  s8_run "$S8A"
  echo "  — 8a · draft INSERT + publishing UPDATE in one transaction:"
  expect "  the arriving transaction holds its row open" "$S8_X_FIRST" "yes"
  expect "  the unlink queues for this accountant's lock" "$S8_U_QUEUED" "yes"
  kg_settled
  s8_run "$S8B" rekey
  echo "  — 8b · an UPDATE that re-keys a draft to this accountant and publishes it:"
  expect "  the arriving transaction holds its row open" "$S8_X_FIRST" "yes"
  expect "  the unlink queues for this accountant's lock" "$S8_U_QUEUED" "yes"
  kg_settled

  # Both halves are qualified by TG_OP: OLD is NULL on an INSERT, so an unqualified re-key test is
  # TRUE there and would quietly keep the lock this mutation means to remove. The first version of
  # this mutation made exactly that mistake and stayed green.
  kg_mutate_arrival "$here/supabase/migrations/$KG_FILE" "$tmp/$KG_FILE" \
      "(TG_OP = 'INSERT' AND NEW.published) OR (TG_OP = 'UPDATE' AND NEW.accountant_id IS DISTINCT FROM OLD.accountant_id)" \
    || { fail "the mutation did not replace the publish trigger's lock condition — the migration has been reshaped"; return; }
  build_schema "$KG_MIGS" "$KG_FILE" "$tmp/$KG_FILE" || return
  echo "  — mutation 1, verified live: a DRAFT insert takes no lock (the old WHEN (NEW.published)):"
  expect "  the live condition" "$(kg_publish_lock_when)" "(TG_OP = 'INSERT' AND NEW.published) OR (TG_OP = 'UPDATE' AND NEW.accountant_id IS DISTINCT FROM OLD.accountant_id)"
  s8_run "$S8A"
  expect "  8a · the unlink does not wait for the arriving row" "$S8_U_QUEUED" "no"
  expect "  8a · the listing is published with no client left" "$(kg_published)/$(kg_links)" "true/0"
  expect "  8a · the invariant is violated" "$(kg_violations)" "1"

  kg_mutate_arrival "$here/supabase/migrations/$KG_FILE" "$tmp/$KG_FILE" "TG_OP = 'INSERT'" \
    || { fail "the mutation did not replace the publish trigger's lock condition — the migration has been reshaped"; return; }
  build_schema "$KG_MIGS" "$KG_FILE" "$tmp/$KG_FILE" || return
  echo "  — mutation 2, verified live: a re-keying UPDATE takes no lock:"
  expect "  the live condition" "$(kg_publish_lock_when)" "TG_OP = 'INSERT'"
  s8_run "$S8B" rekey
  expect "  8b · the unlink does not wait for the arriving row" "$S8_U_QUEUED" "no"
  expect "  8b · the listing is published with no client left" "$(kg_published)/$(kg_links)" "true/0"
  expect "  8b · the invariant is violated" "$(kg_violations)" "1"

  build_schema "$KG_MIGS" "" "" || return
  expect "the shipped condition is back" "$(kg_publish_lock_when)" "$KG_ARRIVAL"
  s8_run "$S8A"
  echo "  — shipped, restored:"
  expect "  8a · the unlink queues for this accountant's lock" "$S8_U_QUEUED" "yes"
  kg_settled
  s8_run "$S8B" rekey
  expect "  8b · the unlink queues for this accountant's lock" "$S8_U_QUEUED" "yes"
  kg_settled
}

scenario_1
scenario_2
scenario_3
scenario_4
scenario_4b
scenario_5
scenario_6
scenario_7
scenario_8

echo ""
if [ "$failed" -ne 0 ]; then
  echo "✗ [GELIJKTIJDIG-VAST] a concurrency contract did not hold." >&2
  exit 1
fi
echo "✅ [GELIJKTIJDIG-VAST] every race held under real concurrent connections, and every gate proved it can see its failure."

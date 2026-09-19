-- tests/sql/notification_event_key.test.sql
-- migrations: ontvangen_melding_event_key.sql
--
-- [ONTVANGEN-MELDING] One event, at most one bell — proved against a real PostgreSQL.
--
-- The TypeScript side proves what the code DOES with a 23505. Only the database can prove that the
-- 23505 arrives at all, that it arrives for the right pair, and — the half a unit test cannot see —
-- that it does NOT arrive for the forty notifications that carry no key.

\set ON_ERROR_STOP on
\set QUIET on

do $$
declare
  owner_a  uuid := '11111111-1111-1111-1111-111111111111';
  owner_b  uuid := '22222222-2222-2222-2222-222222222222';
  doc_1    text := 'intake:auto-finished:0cbc765a-7244-4722-bbce-dc8e7ecfaeb3';
  doc_2    text := 'intake:auto-finished:9f1d2a44-0000-4000-8000-000000000000';
  hit      boolean;
  n        integer;
begin
  -- ── 1. The column exists and is nullable ────────────────────────────────────────────────────
  select is_nullable = 'YES' into hit
    from information_schema.columns
   where table_schema = 'public' and table_name = 'notifications' and column_name = 'event_key';
  if hit is distinct from true then
    raise exception '[ONTVANGEN-MELDING] event_key must exist and be nullable — forty callers write no key';
  end if;

  -- ── 2. The index is UNIQUE, VALID, and partial on exactly the right predicate ───────────────
  -- indisvalid = false is the dangerous outcome of a failed CONCURRENTLY: it looks like an index
  -- in \d and enforces nothing. The migration's rollout step 4 checks this by hand; this pins it.
  select i.indisunique and i.indisvalid and i.indisready and i.indislive
         and pg_get_expr(i.indpred, i.indrelid) = '(event_key IS NOT NULL)'
    into hit
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'uq_notifications_event_key';
  if hit is distinct from true then
    raise exception '[ONTVANGEN-MELDING] uq_notifications_event_key is missing, invalid, not unique, or not partial on (event_key IS NOT NULL)';
  end if;

  -- ── 3. The same event, twice, for the same owner → refused ──────────────────────────────────
  insert into public.notifications (user_id, title, type, event_key)
       values (owner_a, 'Klaar', 'status', doc_1);
  begin
    insert into public.notifications (user_id, title, type, event_key)
         values (owner_a, 'Klaar', 'status', doc_1);
    raise exception '[ONTVANGEN-MELDING] a repeated event key was ACCEPTED — the owner gets the same invoice announced twice';
  exception
    when unique_violation then null;   -- the 23505 the writer turns into a benign replay
  end;

  select count(*) into n from public.notifications where user_id = owner_a and event_key = doc_1;
  if n <> 1 then
    raise exception '[ONTVANGEN-MELDING] expected exactly one row for one event, found %', n;
  end if;

  -- ── 4. A DIFFERENT document is a different event ────────────────────────────────────────────
  insert into public.notifications (user_id, title, type, event_key)
       values (owner_a, 'Klaar', 'status', doc_2);

  -- ── 5. The SAME event key for a DIFFERENT owner is a different event ────────────────────────
  -- The index is per user. Two owners whose documents happen to produce the same key must not
  -- silence each other — and one owner must never be able to suppress another's notification.
  insert into public.notifications (user_id, title, type, event_key)
       values (owner_b, 'Klaar', 'status', doc_1);

  select count(*) into n from public.notifications where event_key is not null;
  if n <> 3 then
    raise exception '[ONTVANGEN-MELDING] expected three distinct keyed events, found %', n;
  end if;

  -- ── 6. The forty existing callers are untouched ─────────────────────────────────────────────
  -- No key at all, many times over, same owner, same everything. PostgreSQL does not constrain
  -- NULLs, and the WHERE clause keeps them out of the index entirely — but that is exactly the
  -- kind of "obviously fine" that is worth one insert to prove rather than to argue.
  insert into public.notifications (user_id, title, type) values (owner_a, 'Betaald', 'payment');
  insert into public.notifications (user_id, title, type) values (owner_a, 'Betaald', 'payment');
  insert into public.notifications (user_id, title, type) values (owner_a, 'Betaald', 'payment');

  select count(*) into n from public.notifications where user_id = owner_a and event_key is null;
  if n <> 3 then
    raise exception '[ONTVANGEN-MELDING] a notification WITHOUT an event key was refused — the boundary leaked onto forty callers (found %)', n;
  end if;

  raise notice '[ONTVANGEN-MELDING] ok — one event one bell, per owner, and keyless notifications unaffected';
end $$;

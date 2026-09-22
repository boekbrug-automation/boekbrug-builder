-- supabase/migrations/accountant_directory_talen.sql
-- [KANTOORGIDS-TAAL] The languages an office says it can help an ondernemer in.
--
-- ── WHY THIS FILE IS A RECOVERY, NOT A NEW MIGRATION ────────────────────────
-- This change is ALREADY IN PRODUCTION. It was recorded on 2026-09-13 as migration version
-- 20260913084506 `accountant_directory_talen`, but its artifact never reached this repository —
-- it was written on a branch that was not merged. So the repo described a table with ten columns
-- while the database had eleven, and nothing could see the difference: every gate over this
-- feature reads the migration files, and the file was not there to disagree.
--
-- The cost was not theoretical. `accountant_directory_published_has_language` below refuses a
-- published row with no language, and the write route knew nothing about the column, so it sent
-- `published = true` with `languages` left at its `'{}'` default. Every attempt by an office to
-- publish itself violated the constraint and came back as a bare 503. The directory held zero
-- rows.
--
-- The executable SQL here is byte-identical to the statements production recorded (compared
-- against supabase_migrations.schema_migrations before this file was restored). It is idempotent
-- and re-running it against production changes nothing — but it should not be re-applied, because
-- it is already applied. What this file repairs is the repository's knowledge of the schema, not
-- the schema.
--
-- ── WHY A CLOSED SET AND NOT FREE TEXT ──────────────────────────────────────
-- Because free text cannot be matched. "Arabisch", "arabic", "العربية" and "AR" are four values
-- for one language, and an owner looking for an office that speaks theirs would be told there is
-- none while three of them are sitting right there. The set is exactly the languages the PRODUCT
-- speaks (src/lib/i18n/locale.ts:LOCALES), so the gids can never offer one BoekBrug cannot serve
-- a client in.
--
-- The honest limit, written down rather than hidden: an office that also speaks Polish cannot say
-- so here. It can put it in its specialisms, which are free text precisely BECAUSE they carry no
-- closed-set promise.
--
-- ── A CLAIM, NOT A CHECKED FACT ─────────────────────────────────────────────
-- Nobody verifies this and the screens must never imply we did — the gids says what the office
-- says. Same three-state honesty as the KvK and VIES doors.
--
-- ── AND IT MUST NEVER RANK ──────────────────────────────────────────────────
-- There is still no rank, score, tier or paid-position column here, and language is not one
-- through the back door: the order comes from accountant-directory.ts on availability and name,
-- and nothing reads this column to sort. A list whose order can be moved by a field is a lever,
-- and a list with a lever is an advertisement.

ALTER TABLE public.accountant_directory
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}';

-- The closed set, in the database too. This is the copy that holds when a write arrives outside
-- the route, which is the whole reason this app has database guards.
--
-- Note it is NOT conditional on `published`: an unknown code is refused in a draft as well. The
-- route must therefore validate languages on every write, not only when publishing.
ALTER TABLE public.accountant_directory
  DROP CONSTRAINT IF EXISTS accountant_directory_languages_known;
ALTER TABLE public.accountant_directory
  ADD CONSTRAINT accountant_directory_languages_known CHECK (
    languages <@ ARRAY['nl', 'en', 'ar', 'tr']::text[]
  );

-- A published listing must be able to answer the question the owner came with. An entry with no
-- language cannot say it speaks anyone's, so it would sit in the list being passed over — worse
-- for the office than not being listed at all.
--
-- A constraint of ITS OWN, deliberately, rather than a wider version of
-- accountant_directory_published_is_complete. That name already exists in accountant_directory.sql,
-- and the migration inventory probes constraints by EXISTENCE: redefining it here would make THIS
-- file read as applied on every database where only the earlier one ever ran, which is the exact
-- silence the inventory exists to break. A new rule gets a new name, and then its presence is an
-- honest answer to "did this migration run".
ALTER TABLE public.accountant_directory
  DROP CONSTRAINT IF EXISTS accountant_directory_published_has_language;
ALTER TABLE public.accountant_directory
  ADD CONSTRAINT accountant_directory_published_has_language CHECK (
    NOT published OR coalesce(array_length(languages, 1), 0) > 0
  );

COMMENT ON COLUMN public.accountant_directory.languages IS
  '[KANTOORGIDS-TAAL] De talen waarin dit kantoor zegt een ondernemer te kunnen helpen. Gesloten set, gelijk aan de talen van BoekBrug zelf (nl/en/ar/tr). Een bewering, geen gecontroleerd feit. Filtert wel, rangschikt nooit.';

-- =====================================================================
-- CHECK — this migration is already applied in production. To confirm:
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='accountant_directory'
--      AND column_name='languages';                       -- expected: one row
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid='public.accountant_directory'::regclass
--      AND conname IN ('accountant_directory_languages_known',
--                      'accountant_directory_published_has_language');   -- expected: two rows
-- =====================================================================

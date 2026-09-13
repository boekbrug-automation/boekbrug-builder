-- supabase/migrations/accountant_directory_talen.sql
-- [KANTOORGIDS-TAAL] The languages an office says it can help an ondernemer in.
--
-- ── WHY THIS IS NOT A NICE-TO-HAVE COLUMN ───────────────────────────────────
-- An owner looking for a boekhouder asks one question before the town, before the specialism and
-- before the price: will this person understand me? BoekBrug publishes in four languages and the
-- first accountants on it read Arabic, so the gids was answering every question except the first
-- one. With this column /boekhouders stops being a list and starts being a match.
--
-- ── WHY A CLOSED SET AND NOT FREE TEXT ──────────────────────────────────────
-- Because free text cannot be filtered. "Arabisch", "arabic", "العربية" and "AR" are four values
-- for one language, and an owner ticking Arabisch would be told there are no offices while three
-- of them are sitting right there. The set is exactly the languages the PRODUCT speaks
-- (src/lib/i18n/locale.ts), so the gids can never offer one BoekBrug cannot serve a client in, and
-- gains any new one for free.
--
-- The honest limit, written down rather than hidden: an office that also speaks Polish cannot say
-- so here. It can put it in its specialisms, which are free text precisely BECAUSE they are not
-- filtered.
--
-- ── A CLAIM, NOT A CHECKED FACT ─────────────────────────────────────────────
-- Nobody verifies this and the screens must never imply we did — the gids says "dit kantoor zegt".
-- Same three-state honesty as the KvK and VIES doors.
--
-- ── AND IT MUST NEVER RANK ──────────────────────────────────────────────────
-- There is still no rank, score, tier or paid-position column here, and language is not one
-- through the back door: the order comes from accountant-directory.ts on availability and name,
-- and matchesFilter() returns a yes or a no, never a score. A filter that can also rank is a lever,
-- and a list with a lever is an advertisement.

ALTER TABLE public.accountant_directory
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}';

-- The closed set, in the database too. This is the copy that holds when a write arrives outside
-- the route, which is the whole reason this app has database guards.
ALTER TABLE public.accountant_directory
  DROP CONSTRAINT IF EXISTS accountant_directory_languages_known;
ALTER TABLE public.accountant_directory
  ADD CONSTRAINT accountant_directory_languages_known CHECK (
    languages <@ ARRAY['nl', 'en', 'ar', 'tr']::text[]
  );

-- A published listing must be able to answer the question the owner came with. An entry with no
-- language is invisible to every language filter, so it would sit in the list being passed over —
-- worse for the office than not being listed at all.
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

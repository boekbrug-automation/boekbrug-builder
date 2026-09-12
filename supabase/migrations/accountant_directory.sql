-- supabase/migrations/accountant_directory.sql
-- [KANTOORGIDS] The public list of offices that work with BoekBrug.
--
-- ── WHY THIS TABLE EXISTS ───────────────────────────────────────────────────
-- [GEEN-PROVISIE] settled that BoekBrug does not pay an office for bringing a client. This is the
-- other direction of the same relationship, and the reason that refusal is not simply a "no": an
-- owner who signs up without a boekhouder is a lead an office would otherwise have paid for. A
-- referral that runs both ways is worth more to an office than a share of a subscription, and it
-- takes nothing out of what a client pays.
--
-- ── WHY IT IS A TABLE OF ITS OWN AND NOT COLUMNS ON profiles ────────────────
-- Because it is PUBLIC data and profiles is not. profiles carries kvk, btw and iban behind a
-- strictly own-row policy; adding a publish flag there would mean writing an anon-readable policy
-- against a table full of things anon must never read, and getting that column list wrong once is
-- an identity leak. A separate table makes the public surface exactly the columns that are in it.
--
-- ── PUBLISHED IS AN ACT ─────────────────────────────────────────────────────
-- `published` defaults to false and the row only exists once the office writes it. Nothing is
-- listed because someone signed up: the office types what it wants shown and turns it on. An
-- accountant discovering a listing they never made is an accountant who leaves — and their name,
-- town and e-mail are theirs to publish, not ours.
--
-- ── WHAT anon MAY READ ──────────────────────────────────────────────────────
-- Only rows with published = true, and only these columns, because there are no others. The
-- e-mail here is a business contact the office typed for this purpose; it is not the account
-- e-mail, which lives in auth.users and is not reachable from this table.
--
-- ── THE ORDER IS NOT IN THIS TABLE ──────────────────────────────────────────
-- There is deliberately no rank, score, tier or paid-position column, and no payment status is
-- reachable from here. The order an owner sees is computed in accountant-directory.ts from
-- availability and name. A directory whose first rows can be bought is an advertisement, and the
-- refusal to pay for recommendations would become a technicality the day it became one.

CREATE TABLE IF NOT EXISTS public.accountant_directory (
  accountant_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  office_name       text        NOT NULL DEFAULT '',
  city              text        NOT NULL DEFAULT '',
  specialisms       text[]      NOT NULL DEFAULT '{}',
  accepting_clients boolean     NOT NULL DEFAULT false,
  contact_email     text        NOT NULL DEFAULT '',
  website           text,
  published         boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Lengths repeated from accountant-directory.ts:LIMITS. Two copies is one too many, and this is
-- the copy that holds when a write arrives outside the route — which is the whole reason the app
-- has database guards at all.
ALTER TABLE public.accountant_directory
  DROP CONSTRAINT IF EXISTS accountant_directory_lengths;
ALTER TABLE public.accountant_directory
  ADD CONSTRAINT accountant_directory_lengths CHECK (
    length(office_name)   <= 80  AND
    length(city)          <= 60  AND
    length(contact_email) <= 120 AND
    (website IS NULL OR length(website) <= 200) AND
    -- Parenthesised deliberately: AND binds tighter than OR, so writing this flat would parse as
    -- "(all the lengths) OR (six or fewer specialisms)" and pass any length at all on a short list.
    (array_length(specialisms, 1) IS NULL OR array_length(specialisms, 1) <= 6) AND
    -- A TOTAL bound, not a per-item one, and the difference is deliberate: a CHECK constraint may
    -- not contain a subquery, so "the longest element is at most 40" cannot be written here. Six
    -- items of forty plus the separators is the same ceiling in aggregate — it stops one
    -- specialism carrying a page, which is what this guard is for. The per-item rule lives in
    -- accountant-directory.ts:LIMITS, where the office is told which field to shorten.
    length(array_to_string(specialisms, ',')) <= 245
  );

-- A published row must be a complete one. Half a listing is worse than none: an owner writes to an
-- address that is not there, and the office never learns that it did not arrive.
ALTER TABLE public.accountant_directory
  DROP CONSTRAINT IF EXISTS accountant_directory_published_is_complete;
ALTER TABLE public.accountant_directory
  ADD CONSTRAINT accountant_directory_published_is_complete CHECK (
    NOT published OR (
      length(office_name) > 0 AND length(city) > 0 AND contact_email LIKE '%_@_%._%'
    )
  );

-- http:// is refused rather than upgraded, same as the module: a link we rewrote is a link the
-- office did not check, and it is their name under it.
ALTER TABLE public.accountant_directory
  DROP CONSTRAINT IF EXISTS accountant_directory_website_https;
ALTER TABLE public.accountant_directory
  ADD CONSTRAINT accountant_directory_website_https CHECK (
    website IS NULL OR website LIKE 'https://%'
  );

CREATE INDEX IF NOT EXISTS accountant_directory_published_idx
  ON public.accountant_directory (published)
  WHERE published;

ALTER TABLE public.accountant_directory ENABLE ROW LEVEL SECURITY;

-- Anyone, signed in or not, may read a PUBLISHED row. That is what publishing means.
DROP POLICY IF EXISTS accountant_directory_public_read ON public.accountant_directory;
CREATE POLICY accountant_directory_public_read ON public.accountant_directory
  FOR SELECT TO anon, authenticated USING (published);

-- The office reads its own row whether it is published or not — otherwise the form that edits it
-- cannot load a draft it has not turned on yet.
DROP POLICY IF EXISTS accountant_directory_own_read ON public.accountant_directory;
CREATE POLICY accountant_directory_own_read ON public.accountant_directory
  FOR SELECT TO authenticated USING (accountant_id = (select auth.uid()));

DROP POLICY IF EXISTS accountant_directory_own_write ON public.accountant_directory;
CREATE POLICY accountant_directory_own_write ON public.accountant_directory
  FOR INSERT TO authenticated WITH CHECK (accountant_id = (select auth.uid()));

DROP POLICY IF EXISTS accountant_directory_own_update ON public.accountant_directory;
CREATE POLICY accountant_directory_own_update ON public.accountant_directory
  FOR UPDATE TO authenticated USING (accountant_id = (select auth.uid()))
  WITH CHECK (accountant_id = (select auth.uid()));

-- Turning it off is not enough for an office that wants out; it must be able to remove the row.
DROP POLICY IF EXISTS accountant_directory_own_delete ON public.accountant_directory;
CREATE POLICY accountant_directory_own_delete ON public.accountant_directory
  FOR DELETE TO authenticated USING (accountant_id = (select auth.uid()));

COMMENT ON TABLE public.accountant_directory IS
  '[KANTOORGIDS] Kantoren die met BoekBrug werken, zoals het kantoor het zelf heeft ingevuld en aangezet. published = false is de standaard en de rij bestaat pas als het kantoor hem schrijft. Geen rang-, score- of betaalkolom: de volgorde komt uit accountant-directory.ts en is niet te koop.';

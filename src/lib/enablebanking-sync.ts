// src/lib/enablebanking-sync.ts
// [ENABLEBANKING] Pulling a connected account's transactions into the existing bank pipeline.
//
// This module is deliberately THIN. It does not decide anything about money: it fetches, hands the
// JSON to enablebanking-map.ts, and then walks the SAME dedup → insert → auto-confirm →
// auto-categorize path that an uploaded MT940 walks in bank-ingest.ts. A second, parallel pipeline
// for bank-fed transactions is exactly how the two entry points in bank-ingest's own header
// drifted apart, and money-truth is the last place to repeat that.
//
// ── What it does NOT do, on purpose ────────────────────────────────────────────────────────────
//
//   · PENDING transactions are never imported. A pending line has no final amount and no final
//     date; when it books a day later it arrives again, with different values, and would import a
//     SECOND time — the content fingerprint cannot save us, because the fingerprint itself
//     changed. Only booked money is money. The mapper counts what it passed over so the number is
//     visible rather than silently absent.
//   · No passthrough document is stored. There is no original file to store — the bank fed us
//     JSON. The closing package already says this out loud for such a quarter, which is the honest
//     outcome; a generated file would LOOK like a bank statement without being one, and an
//     accountant cannot tell the difference by eye.
//   · No statement balance check. That check proves an uploaded FILE is internally complete
//     (opening + Σtx = closing). A feed has no statement boundaries, so there is nothing to
//     reconcile against and a fabricated pass would be worse than no check at all.

import type { PipelineClient } from "./supabase-pipeline";
import { createPipelineClient } from "./supabase-pipeline";
import { fetchAllRows } from "./supabase-paginate";
import { dedupTransactions, mapToRows, dateRange, type ExistingTxKey } from "./bank-import";
import { runBankAutoConfirm } from "./bank-auto-confirm";
import { applyLearnedBankCategories } from "./bank-auto-categorize";
import { mapEnableBankingTransactions } from "./enablebanking-map";
import type { EnableBankingRawTransaction } from "./enablebanking-map";
import {
  createEnableBankingClient,
  dutchEnableBankingError,
  EnableBankingError,
  needsReconnect,
  shouldBackOffAfter,
  type EnableBankingClient,
  type EnableBankingErrorCode,
} from "./enablebanking-client";
import { claimAccountSync } from "./enablebanking-claim";
import {
  recordAccountSync,
  recordConnectionSync,
  setConnectionStatus,
  type BankConnection,
  type BankConnectionAccount,
} from "./enablebanking-connection";

/**
 * How long we wait between two reads of the SAME account.
 *
 * A bank allows a handful of transaction reads per day per account. Twenty hours is under a full
 * day — so a daily cron never skips a day by drifting a few minutes — while still leaving the
 * owner's manual "ververs" button room to work at all.
 */
export const SYNC_MIN_INTERVAL_HOURS = 20;

/**
 * How far BEFORE the last synced date the next pull starts.
 *
 * A transaction can book days after it happened, and a window that starts exactly where the last
 * one ended would step straight over it. Overlap is free — the content dedup in bank-import.ts
 * drops what we already have — and a missed transaction is not.
 */
export const SYNC_OVERLAP_DAYS = 7;

/** History to request on a FIRST sync when the bank told us nothing better. */
export const DEFAULT_FIRST_SYNC_DAYS = 365;

/** Nothing is asked for beyond this, whatever a bank claims to offer. */
export const MAX_HISTORICAL_DAYS_CAP = 730;

export interface AccountSyncResult {
  accountId: string;
  iban: string | null;
  /** [EB-TELLING] Pages the bank served for this window. 1 unless the feed paginated. */
  pages: number;
  /** Transactions the feed handed over, every status, before anything was decided. */
  fetched: number;
  /** [EB-TELLING] Booked entries the mapper accepted. fetched = booked + pending + unreadable. */
  booked: number;
  /** Rows actually written. */
  inserted: number;
  /** Duplicates the fingerprint recognised — almost always the intentional window overlap. */
  skipped: number;
  /** Entries the bank has not committed yet. Passed over on purpose, counted so it is visible. */
  pending: number;
  /** Lines we could NOT read. Dutch, owner-facing; never silently dropped. */
  warnings: string[];
  /** Dutch error when this account failed entirely, else null. */
  error: string | null;
  /**
   * The machine-readable cause behind `error`.
   *
   * Kept separate on purpose: the connection-level decision below ("is this a dead consent, or a
   * bank having a bad afternoon?") must never be made by comparing the DUTCH sentence to a
   * generated one. That works exactly until someone improves the wording, at which point every
   * expired connection silently starts being filed as a generic error and nobody is ever asked to
   * reconnect. A code cannot rot that way.
   */
  errorCode: EnableBankingErrorCode | null;
  /** True when the account was skipped because it was read recently (rate-limit guard). */
  skippedTooSoon: boolean;
  /**
   * [CSV-MUNT] True when the account was skipped because the bank holds it in another currency.
   *
   * Separate from `skippedTooSoon` because they mean different things to the owner, and separate
   * from `error` because nothing failed. It exists as a FIELD rather than as "a warning with a
   * certain wording" for the same reason `errorCode` does: the connection-level decision below
   * ("did anything read cleanly?") must never be made by matching a Dutch sentence. Without it, a
   * dollar account that we deliberately never read would count as a clean read and quietly mark a
   * connection with an expired consent as healthy.
   */
  skippedForeignCurrency: boolean;
  /**
   * [EB-RACE] True when another worker was already syncing THIS account and we stood down.
   *
   * Its own field, for the same reason `skippedForeignCurrency` has one: nothing failed, nothing
   * was read, and the connection-level verdict below must not count a stand-down as a clean read.
   * Without it, an account we never looked at would mark an expired connection healthy.
   */
  skippedBusy: boolean;
  /**
   * [EB-RACE] True when we could not ESTABLISH the one-worker guarantee, and therefore refused to
   * read or store anything.
   *
   * Separate from `skippedBusy` on purpose. "Another worker has it" is the mechanism working;
   * "the mechanism is broken" is not, and one boolean covering both would make a dead claim table
   * look exactly like a busy account — on every screen, in every counter and in every log line.
   *
   * Separate from `error` too: a failure of OUR infrastructure must not put the owner's
   * connection into an error or expired state, because there is nothing he can fix by
   * reconnecting his bank. It carries a calm Dutch warning instead, and the next run retries.
   */
  skippedClaimUnavailable: boolean;
}

export interface ConnectionSyncResult {
  connectionId: string;
  institutionName: string | null;
  accounts: AccountSyncResult[];
  inserted: number;
  /** Payments auto-booked against an invoice as a direct result of this sync. */
  autoBooked: number;
  /** Dutch error at the connection level (expired consent, dead credentials), else null. */
  error: string | null;
}

/** ISO date (YYYY-MM-DD) `days` before `from`. Pure — the date maths is tested, not the clock. */
export function isoDaysBefore(from: Date, days: number): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * May this account be read now? The rate-limit guard, as a pure decision.
 *
 * A never-synced account is always due. Otherwise it waits out SYNC_MIN_INTERVAL_HOURS. An
 * unparseable timestamp counts as due: refusing to sync on a corrupt column would stop the feed
 * forever and silently, which is worse than one extra read.
 */
export function isAccountDue(
  lastSyncedAt: string | null,
  now: Date,
  minIntervalHours = SYNC_MIN_INTERVAL_HOURS,
): boolean {
  if (!lastSyncedAt) return true;
  const last = Date.parse(lastSyncedAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= minIntervalHours * 3_600_000;
}

/**
 * The window to request for one account.
 *
 * First sync → as much history as the consent allows (capped). Later syncs → from
 * SYNC_OVERLAP_DAYS before the last synced date, so a late booking cannot slip through the seam.
 */
export function syncWindow(
  account: Pick<BankConnectionAccount, "lastSyncedThrough">,
  connection: Pick<BankConnection, "maxHistoricalDays">,
  now: Date,
): { dateFrom: string; dateTo: string } {
  const dateTo = now.toISOString().slice(0, 10);

  if (account.lastSyncedThrough) {
    return {
      dateFrom: isoDaysBefore(new Date(`${account.lastSyncedThrough}T00:00:00Z`), SYNC_OVERLAP_DAYS),
      dateTo,
    };
  }

  const requested = connection.maxHistoricalDays ?? DEFAULT_FIRST_SYNC_DAYS;
  const days = Math.min(Math.max(requested, 1), MAX_HISTORICAL_DAYS_CAP);
  return { dateFrom: isoDaysBefore(now, days), dateTo };
}

/**
 * Store a mapped batch through the SAME gate an uploaded statement passes.
 *
 * Extracted so the dedup discipline is one call, not a copy: fetch every existing row in the
 * window (paginated — PostgREST's silent ~1000-row first page truncated this exact SELECT once
 * before, and a truncated "existing" set means duplicates get inserted while the import honestly
 * reports "N skipped"), multiset-diff against it, insert the remainder.
 */
async function storeTransactions(args: {
  pipeline: PipelineClient;
  userId: string;
  /** [BANK-TX-SOURCE-ID] The account's STABLE identity (identification_hash), not its uid.
   *
   *  It names the row's provenance in `source`, and it is the SCOPE the dedup's exact layer would
   *  use if this door ever had an id to key on. [EB-IDENTITEIT] it does not: the feed's
   *  entry_reference turned out to be the bank's non-unique entry id, so every row this door
   *  writes stores external_id NULL and the exact layer is dark here. What stands instead is the
   *  content fingerprint, plus [EB-RACE] around the whole read-decide-insert sequence.
   *
   *  The uid would still be the wrong scope on the day an id does arrive: it dies with the session,
   *  so every already-stored row would sit under the old scope, match nothing, and the layer would
   *  be doing nothing at the one moment it is needed most — the post-reconnect re-sync, which
   *  deliberately re-reads history. The hash outlives the reconnect. */
  accountKey: string;
  transactions: ReturnType<typeof mapEnableBankingTransactions>["transactions"];
}): Promise<{ inserted: number; skipped: number }> {
  const { pipeline, userId, accountKey, transactions } = args;
  if (transactions.length === 0) return { inserted: 0, skipped: 0 };

  const source = `enablebanking:${accountKey}`;
  const { min, max } = dateRange(transactions);
  let existing: ExistingTxKey[] = [];
  if (min && max) {
    const readExisting = (columns: string) =>
      fetchAllRows((from, to) =>
        pipeline
          .from("bank_transactions")
          .select(columns)
          .eq("user_id", userId)
          .gte("date", min)
          .lte("date", max)
          .order("id", { ascending: true })
          .range(from, to),
      );
    const BASE_COLUMNS = "date, amount, description, counterpart_name, reference";
    try {
      existing = (await readExisting(`${BASE_COLUMNS}, source, external_id`)) as unknown as ExistingTxKey[];
    } catch {
      // [BANK-TX-SOURCE-ID] bank_tx_source_identity.sql not applied yet. fetchAllRows THROWS on a
      // query error, and letting that escape would empty the dedup gate — every already-stored
      // line would find no match and the daily sync would re-insert the whole window. Degrade to
      // the fingerprint alone, which is what this door had before the column existed.
      existing = (await readExisting(BASE_COLUMNS)) as unknown as ExistingTxKey[];
    }
  }

  const dd = dedupTransactions(transactions, existing, source);
  if (dd.toInsert.length === 0) return { inserted: 0, skipped: dd.skipped };

  const rows = mapToRows(dd.toInsert, userId, source);
  // [BANK-TX-SOURCE-ID] upsert-ignore, kept in the shape the upload door uses — but read what it
  // does NOT do here. Every row this door writes carries external_id NULL ([EB-IDENTITEIT]), and
  // PostgreSQL does not constrain NULLs, so ON CONFLICT (user_id, source, external_id) can never
  // fire for a feed row. The unique index is a real backstop for an uploaded MT940 and NOT for
  // this one. That is why [EB-RACE] exists: for this door the serialization is the account claim
  // in enablebanking-claim.ts, taken in syncOneAccount and held across this whole function.
  //
  // The clause stays because it costs nothing and becomes live the day a bank hands us an id we
  // can trust — but nothing may be argued from it while external_id is null.
  let { data: insData, error } = await pipeline
    .from("bank_transactions")
    // [DD-SIGNAL] type_code/mandate_id/creditor_id arrive with bank_tx_direct_debit.sql and are not
    // yet in the generated types — the 42703 branch below is what makes the write safe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert(rows as any, { onConflict: "user_id,source,external_id", ignoreDuplicates: true })
    .select("id");
  // Resilient to a half-applied schema, exactly as bank-ingest is, and for the same reason: a
  // failed insert here is not a missing hint, it is a day of the owner's money that never lands.
  //   · 42703 — the columns do not exist. Strip them and plain-insert. [BANK-IBAN] rides along.
  //   · 42P10 — the columns exist but uniq_bank_tx_source_identity does not, so there is no
  //     constraint for ON CONFLICT to match. Keep the values, drop the conflict clause.
  const failureCode = (error as { code?: string } | null)?.code;
  if (failureCode === "42703") {
    const stripped = rows.map(({ counterpart_iban: _iban, source: _src, external_id: _ext, type_code: _tc, mandate_id: _mid, creditor_id: _cid, ...r }) => r);
    ({ data: insData, error } = await pipeline.from("bank_transactions").insert(stripped).select("id"));
  } else if (failureCode === "42P10") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ data: insData, error } = await pipeline.from("bank_transactions").insert(rows as any).select("id"));
  }
  if (error) {
    console.error("[ENABLEBANKING] inserting transactions failed", { userId, rows: rows.length, error });
    return { inserted: 0, skipped: dd.skipped };
  }
  // Rows the unique index refused are raced duplicates: written by the other writer, not by us.
  // Counting them as inserted would report money that this run did not add. With a NULL
  // external_id nothing is ever refused, so on the feed door this arithmetic is a no-op that stays
  // correct for the day it is not.
  const written = insData?.length ?? rows.length;
  const racedAway = rows.length > 1000 ? 0 : rows.length - written;
  return { inserted: rows.length - racedAway, skipped: dd.skipped + racedAway };
}

interface SyncOneArgs {
  client: EnableBankingClient;
  pipeline: PipelineClient;
  connection: BankConnection;
  account: BankConnectionAccount;
  now: Date;
  force: boolean;
}

/** Sync ONE account. Never throws: the caller is a loop over accounts and one failure must not
 *  take the others down with it. */
async function syncOneAccount(args: SyncOneArgs): Promise<AccountSyncResult> {
  const { connection, account, now, force } = args;
  const base: AccountSyncResult = {
    accountId: account.accountId,
    iban: account.iban,
    pages: 0,
    fetched: 0,
    booked: 0,
    inserted: 0,
    skipped: 0,
    pending: 0,
    warnings: [],
    error: null,
    errorCode: null,
    skippedTooSoon: false,
    skippedForeignCurrency: false,
    skippedBusy: false,
    skippedClaimUnavailable: false,
  };

  if (!force && !isAccountDue(account.lastSyncedAt, now)) {
    return { ...base, skippedTooSoon: true };
  }

  // [CSV-MUNT] Een rekening die de bank zelf in een andere munt aanmeldt, wordt niet opgehaald.
  //
  // Niet als fout: er is niets kapot, en de verbinding hoort niet op "error" te springen omdat
  // iemand naast zijn euro-rekening een dollarrekening heeft. Wel als waarschuwing, want stil
  // overslaan is precies zo misleidend als stil verkeerd boeken — het paneel zou dan "0 nieuwe
  // transacties" zeggen over een rekening waar wél iets op gebeurde. En het scheelt de eigenaar
  // een van zijn paar dagelijkse leesbeurten bij de bank, die hier niets kan opleveren.
  const accountCurrency = (account.currency || "").toUpperCase();
  if (accountCurrency && accountCurrency !== "EUR") {
    return {
      ...base,
      skippedForeignCurrency: true,
      warnings: [
        `Deze rekening staat bij de bank in ${accountCurrency}. Deze boekhouding werkt in euro's, ` +
        `dus we halen er geen transacties op — anders zouden die bedragen als euro's worden geboekt.`,
      ],
    };
  }

  // [EB-RACE] Everything below reads the stored rows, decides in application memory what is new,
  // and inserts the remainder. That sequence is safe for ONE worker at a time; two of them both
  // read "not present" and both write. Nothing on the account row says "busy", so the claim is
  // taken here and given back in the finally — see enablebanking-claim.ts for why not last_synced_at.
  const claim = await claimAccountSync(connection.userId, account.id, now);
  if (!claim.claimed) {
    if (claim.outcome === "busy") return { ...base, skippedBusy: true };
    // We could not establish the guarantee. Refuse the financial read rather than perform it
    // unprotected: a delayed sync is recoverable, a doubled quarter is a wrong tax return. Nothing
    // is written — last_synced_at and last_synced_through stay where they were, so the next run is
    // due immediately and the 7-day overlap window means nothing is lost.
    return {
      ...base,
      skippedClaimUnavailable: true,
      warnings: [
        "We konden deze rekening nu niet veilig ophalen. Dat ligt aan ons, niet aan je bank — " +
        "je hoeft niets opnieuw te koppelen. De volgende ronde pikt hem vanzelf op.",
      ],
    };
  }
  try {
    return await readAndStoreAccount(args, base);
  } finally {
    await claim.release();
  }
}

/**
 * The critical section: read the bank, map, dedup against what is stored, insert.
 *
 * Its own function so the claim around it cannot be sidestepped by an early return added later —
 * every exit from here passes through syncOneAccount's finally.
 */
async function readAndStoreAccount(
  args: SyncOneArgs,
  base: AccountSyncResult,
): Promise<AccountSyncResult> {
  const { client, pipeline, connection, account, now } = args;
  const { dateFrom, dateTo } = syncWindow(account, connection, now);

  let pages = 0;
  let raw: EnableBankingRawTransaction[];
  try {
    // The client follows continuation keys to the end, so this is the WHOLE window, not a page.
    raw = (await client.getTransactions(account.accountId, {
      dateFrom,
      dateTo,
      // [EB-TELLING] Counted where the pages actually turn. A one-page import of a two-page window
      // is the quiet failure this whole door is built to make visible, and "1" next to 611
      // transactions is what shows it.
      onPage: (n) => {
        pages = n;
      },
    })) as EnableBankingRawTransaction[];
  } catch (err) {
    const code = err instanceof EnableBankingError ? err.code : null;
    const dutch = code ? dutchEnableBankingError(code) : "Ophalen bij de bank mislukt.";
    console.warn("[ENABLEBANKING] fetching transactions failed", {
      accountId: account.accountId,
      code: code ?? "UNKNOWN",
    });
    await recordAccountSync({
      accountRowId: account.id,
      syncedThrough: null,
      lastError: dutch,
      // A bank that is down, or our own network, must not spend the owner's daily read —
      // otherwise his first sync after connecting greys out the button until tomorrow for
      // something that fixes itself in minutes.
      backOff: shouldBackOffAfter(code),
    });
    // [EB-TELLING] pages rides along: a failure on page 4 of 5 is a different event from a
    // failure on the first call, and only the counter can tell them apart afterwards.
    return { ...base, pages, error: dutch, errorCode: code };
  }

  const { transactions, warnings, skipped: pending } = mapEnableBankingTransactions(raw);
  const { inserted, skipped } = await storeTransactions({
    pipeline,
    userId: connection.userId,
    accountKey: account.identificationHash,
    transactions,
  });

  await recordAccountSync({ accountRowId: account.id, syncedThrough: dateTo, lastError: null });

  // [EB-TELLING] The same numbers the JSON carries, written where the cron door can be read too:
  // /api/cron/bank-sync answers a scheduler, not a browser, so without this line half the traffic
  // through this function reports nothing at all. `unreadable` is derived, never counted twice —
  // if it is not zero, exactly that many lines are missing from the owner's books.
  console.info("[EB-TELLING] account sync", {
    accountId: account.accountId,
    window: `${dateFrom}..${dateTo}`,
    pages,
    fetched: raw.length,
    booked: transactions.length,
    pending,
    inserted,
    skipped,
    unreadable: raw.length - transactions.length - pending,
    warnings: warnings.length,
  });

  return { ...base, pages, fetched: raw.length, booked: transactions.length, inserted, skipped, pending, warnings };
}

/**
 * Sync every account of one connection.
 *
 * `force` is the owner pressing "ververs" — it bypasses the 20-hour guard but NOT the bank's own
 * daily budget, which answers 429 and surfaces as a calm Dutch line rather than an error state.
 */
export async function syncBankConnection(args: {
  connection: BankConnection;
  pipeline?: PipelineClient;
  client?: EnableBankingClient;
  now?: Date;
  force?: boolean;
}): Promise<ConnectionSyncResult> {
  const connection = args.connection;
  const pipeline = args.pipeline ?? createPipelineClient();
  const now = args.now ?? new Date();
  const force = args.force ?? false;

  const result: ConnectionSyncResult = {
    connectionId: connection.id,
    institutionName: connection.institutionName ?? connection.aspspName,
    accounts: [],
    inserted: 0,
    autoBooked: 0,
    error: null,
  };

  if (connection.status === "revoked") {
    result.error = "Deze bankkoppeling is losgekoppeld.";
    return result;
  }

  let client: EnableBankingClient;
  try {
    client = args.client ?? createEnableBankingClient();
  } catch (err) {
    result.error =
      err instanceof EnableBankingError
        ? dutchEnableBankingError(err.code)
        : "De bankkoppeling is niet beschikbaar.";
    return result;
  }

  for (const account of connection.accounts) {
    const one = await syncOneAccount({ client, pipeline, connection, account, now, force });
    result.accounts.push(one);
    result.inserted += one.inserted;
  }

  // An expired consent shows up as a failure on EVERY account at once — the whole session died,
  // not one account. Promote it to the connection so the card asks the owner to reconnect instead
  // of showing four identical account errors he cannot act on.
  const errored = result.accounts.filter((a) => a.error);
  if (errored.length > 0 && errored.length === result.accounts.length) {
    result.error = errored[0].error;
    // 'expired' is the status that makes the panel offer "Opnieuw koppelen" instead of a "Ververs"
    // button that can only fail — so it must cover every cause that only a fresh consent can fix
    // (lapsed consent, an invalidated session, an account gone at the bank), not just the literal
    // expiry. Decided on the CODE, never on the Dutch sentence.
    const dead = errored[0].errorCode !== null && needsReconnect(errored[0].errorCode);
    await setConnectionStatus({
      connectionId: connection.id,
      status: dead ? "expired" : "error",
      lastError: errored[0].error,
    });
  } else if (
    result.accounts.some(
      (a) =>
        !a.error &&
        !a.skippedTooSoon &&
        !a.skippedForeignCurrency &&
        !a.skippedBusy &&
        !a.skippedClaimUnavailable,
    )
  ) {
    // At least one account read cleanly — the connection is alive again whatever it said before.
    if (connection.status !== "linked") {
      await setConnectionStatus({ connectionId: connection.id, status: "linked", lastError: null });
    }
  }

  // [BANK-CIRCLE-SERVER] Close the circle the moment new transactions land, exactly as the upload
  // path does: book the near-certain payments (reference printed + amount to the cent) without
  // waiting for the owner to open /dashboard/bank. Best-effort — a reconcile hiccup must never
  // undo a successful import.
  if (result.inserted > 0) {
    try {
      const confirmed = await runBankAutoConfirm({ payClient: pipeline, pipeline, userId: connection.userId });
      result.autoBooked = confirmed.length;
    } catch (e) {
      console.error("[ENABLEBANKING] auto-confirm after sync failed (non-fatal)", e);
    }
    try {
      await applyLearnedBankCategories({ pipeline, userId: connection.userId });
    } catch (e) {
      console.error("[ENABLEBANKING] auto-categorize after sync failed (non-fatal)", e);
    }
  }

  const anyRead = result.accounts.some(
    (a) => !a.skippedTooSoon && !a.skippedBusy && !a.skippedClaimUnavailable,
  );
  if (anyRead) await recordConnectionSync(connection.id, result.error);

  return result;
}

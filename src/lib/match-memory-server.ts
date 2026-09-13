// src/lib/match-memory-server.ts
// [GEHEUGEN] The read half of the confirmed-match memory. Fetches, decides nothing.
//
// What the memory MEANS, and the rule that keeps a single mistaken confirmation from doing harm,
// is argued in match-memory.ts. This file only assembles the rows it is built from:
//
//     bank_tx_invoices        the confirmation itself — this transaction settled this invoice
//       → bank_transactions   what the bank called the counterparty, and from which account
//       → invoices            which party that invoice bills
//
// Three reads, all id-keyed, all chunked and paged the way every other id-keyed read here is: a
// silent truncation would drop confirmations, which reads as "this counterparty is new" — a wrong
// answer that looks exactly like a right one.
//
// Best-effort by the same contract as the supplier registry: a failed or empty read yields an
// empty memory, and an empty memory leaves the matcher reasoning purely from the payment, exactly
// as it did before this existed. The degradation removes evidence and never invents it.

import { fetchAllRowsForIds } from "./supabase-paginate";
import { buildMatchMemory, MATCH_MEMORY_LIMIT, type ConfirmedLink, type MatchMemory } from "./match-memory";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type LinkRow = { transaction_id: string | null; invoice_id: string };
type TxRow = {
  id: string;
  counterpart_name: string | null;
  counterpart_iban: string | null;
  // [INCASSO-IDENTITEIT] The two direct-debit handles the confirmation also settled under.
  mandate_id?: string | null;
  creditor_id?: string | null;
};
type InvRow = { id: string; client_name: string | null };

/**
 * The owner's confirmed counterpart → party pairs, most recent first.
 *
 * The cap is on the LINK rows rather than on the pairs they fold into: an administration that
 * settles the same three suppliers all year should still remember those three, and one that
 * settles two hundred should remember the recent ones. Reaching back further would be a memory of
 * supplier relationships that may have ended.
 */
export async function loadMatchMemory(client: AnyClient, userId: string): Promise<MatchMemory> {
  const { data: linkRows, error } = (await client
    .from("bank_tx_invoices")
    .select("transaction_id, invoice_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MATCH_MEMORY_LIMIT)) as { data: LinkRow[] | null; error: { message: string } | null };
  if (error || !linkRows || linkRows.length === 0) return buildMatchMemory([]);

  const txIds = [...new Set(linkRows.map((r) => r.transaction_id).filter((v): v is string => !!v))];
  const invIds = [...new Set(linkRows.map((r) => r.invoice_id).filter(Boolean))];
  if (txIds.length === 0 || invIds.length === 0) return buildMatchMemory([]);

  const [txRows, invRows] = await Promise.all([
    fetchAllRowsForIds<TxRow, string>(txIds, (chunk, from, to) =>
      client
        .from("bank_transactions")
        .select("id, counterpart_name, counterpart_iban, mandate_id, creditor_id")
        .eq("user_id", userId)
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRowsForIds<InvRow, string>(invIds, (chunk, from, to) =>
      client
        .from("invoices")
        .select("id, client_name")
        // Ownership is checked the way every other invoice read in this line checks it: an
        // administration can be on either side of a document.
        //
        // [VOLGORDE] .or() comes AFTER .select(), and that is not a style choice. .from() returns
        // a query builder that can only start a verb — select/insert/update/delete; the filters
        // live on what .select() returns. Called one line earlier it is not a filter that fails,
        // it is `undefined is not a function`, and it took the whole read down:
        // "TypeError: e.from(...).or is not a function", six times on /api/bank/match.
        //
        // Nothing caught it before production. The client here is AnyClient — deliberately
        // relaxed, because these tables are not in the generated types — so tsc had no method
        // list to check against, and the caller catches and continues without the memory. The
        // result was the quietest possible failure: bank matching ran, produced answers, and
        // silently never used a single thing the owner had already confirmed.
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const txById = new Map(txRows.map((r) => [r.id, r]));
  const invById = new Map(invRows.map((r) => [r.id, r]));
  const links: ConfirmedLink[] = [];
  for (const row of linkRows) {
    const tx = row.transaction_id ? txById.get(row.transaction_id) : undefined;
    const inv = invById.get(row.invoice_id);
    // A link whose transaction or invoice we could not read teaches nothing. Skipped rather than
    // half-recorded: a pair with an empty side would enter the index as a second party under the
    // same counterpart, which is exactly the shape that makes the memory stop speaking.
    if (!tx || !inv) continue;
    links.push({
      counterpartName: tx.counterpart_name,
      counterpartIban: tx.counterpart_iban,
      // [INCASSO-IDENTITEIT] A confirmation on an incasso line teaches the mandate too. Optional
      // on the row type and null-coalesced here, so a database without bank_tx_direct_debit.sql
      // applied yields a memory with two empty indexes rather than a failed read — the same
      // degradation this whole file already promises: less evidence, never invented evidence.
      mandateId: tx.mandate_id ?? null,
      creditorId: tx.creditor_id ?? null,
      partyName: inv.client_name,
    });
  }
  return buildMatchMemory(links);
}

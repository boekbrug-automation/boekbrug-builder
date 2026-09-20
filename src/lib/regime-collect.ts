// src/lib/regime-collect.ts
// [REGIME-FLAGS] The ONE I/O collector shared by /api/readiness, /api/aangifte and the closing
// package, so all three detect the same regimes from the same evidence and never disagree. It
// fetches the owner's invoice line texts (phrase source) and hands them to the pure
// detectRegimeFlags. Kept out of regime-flags.ts so that module stays pure + node-testable.

import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRowsForIds } from "./supabase-paginate";
import { detectRegimeFlags, type RegimeFlag, type RegimeLineSignal } from "./regime-flags";

export interface RegimeInvoiceRef {
  id: string;
  direction: "incoming" | "outgoing";
  label: string | null; // invoice_number, for the flag's evidence
}

/**
 * Gather the regime flags for one owner/quarter. Tenant-safe: invoice lines are fetched ONLY
 * by invoice_id IN the caller's own quarter invoice ids (never a broad scan), so an accountant
 * path scoped to a client sees only that client's lines. Best-effort on the line fetch (a query
 * hiccup yields no phrase flags, never a crash) — the KOR flags don't depend on lines anyway.
 */
export async function collectRegimeFlags(args: {
  client: PipelineClient;
  korActive: boolean;
  omzetForKorCheck: number;
  invoices: RegimeInvoiceRef[];
}): Promise<RegimeFlag[]> {
  return (await collectRegimeFlagsChecked(args)).flags;
}

/**
 * [READINESS-DEGRADE] The same collection, saying whether the line read happened. `linesRead` is
 * false when the invoice_lines fetch failed: the KOR flag is still decided (it needs no lines),
 * the phrase flags are absent — and a caller that decides "klaar" must not read that absence as
 * "no verlegd, no marge".
 */
export async function collectRegimeFlagsChecked(args: {
  client: PipelineClient;
  korActive: boolean;
  omzetForKorCheck: number;
  invoices: RegimeInvoiceRef[];
}): Promise<{ flags: RegimeFlag[]; linesRead: boolean }> {
  let linesRead = true;
  const refById = new Map<string, RegimeInvoiceRef>();
  for (const inv of args.invoices) if (inv.id) refById.set(inv.id, inv);
  const ids = [...refById.keys()];

  const lines: RegimeLineSignal[] = [];
  if (ids.length > 0) {
    // [IN-CHUNK] `ids` is every invoice in the quarter, so the id list travels in the URL and a
    // few hundred uuids outgrow the request line (414) — a silent ceiling next to the row cap,
    // documented in supabase-paginate.ts:22-31. It landed in the catch below, which is quiet by
    // design, so on a busy quarter the phrase-based regime flags (BTW verlegd, margeregeling)
    // disappeared without a trace on exactly the accounts most likely to have them.
    // [PAGE-KEY] Ordered by id, not invoice_id: several lines per invoice is the normal case, and
    // Postgres gives no order among ties — across .range() windows a line could repeat or vanish.
    const rows = await fetchAllRowsForIds<{ invoice_id: string | null; description: string | null }, string>(
      ids,
      (chunk, from, to) =>
        args.client
          .from("invoice_lines")
          .select("invoice_id, description")
          .in("invoice_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
    ).catch((e: unknown) => {
      // Best-effort by contract (the KOR flags do not depend on lines) — but no longer silent.
      console.error("[REGIME-FLAGS] invoice_lines read failed — phrase flags omitted", {
        invoiceCount: ids.length,
        error: e instanceof Error ? e.message : String(e),
      });
      linesRead = false;
      return [] as Array<{ invoice_id: string | null; description: string | null }>;
    });
    for (const r of rows) {
      if (!r.invoice_id || !r.description) continue;
      const ref = refById.get(r.invoice_id);
      if (!ref) continue;
      lines.push({ direction: ref.direction, text: r.description, invoiceLabel: ref.label ?? undefined });
    }
  }

  const flags = detectRegimeFlags({
    korActive: args.korActive,
    omzetForKorCheck: args.omzetForKorCheck,
    lines,
  });
  return { flags, linesRead };
}

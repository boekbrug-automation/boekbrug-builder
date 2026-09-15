// src/app/api/grootboek/route.ts
// [GROOTBOEK] Which cost account each purchase invoice belongs on: what still has to be answered,
// and the owner's answer.
//
// GET lists the incoming invoices that carry no account yet, each with a SUGGESTION and what that
// suggestion rests on. The suggestion is computed here and stored nowhere — see grootboek.ts for
// why it may never book on its own. What IS stored is only ever what a human confirmed.
//
// PATCH records one answer. It writes a single column on a single row, guarded on ownership, and
// accepts only an account that exists in the rekeningschema — an accID that is not in the chart
// makes the whole auditfile invalid, so it is refused at the door rather than at export time.
//
// [NO-SILENT-EMPTY] A failed read is a 503 with a sentence. "Everything has an account" and "we
// could not look" are opposite answers, and the first is the dangerous direction here: it tells
// the owner their administratie is finished.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows, chunkIds } from "@/lib/supabase-paginate";
import { logAuditAction } from "@/lib/audit";
// [CENT] The app has exactly one rounding to cents, and this is it.
import { round2 } from "@/lib/invoice-totals";
import {
  suggestLedgerAccount, isLedgerAccount, LEDGER_ACCOUNTS,
  type LedgerSuggestion,
} from "@/lib/grootboek";

export const dynamic = "force-dynamic";

/** One request, one supplier. Bigger sets are two taps, never one request that half-lands. */
const MAX_PER_CALL = 500;

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  client_name: string | null;
  supplier_id: string | null;
  total_ex_btw: number | null;
  total_inc_btw: number | null;
  ledger_account: string | null;
}

/** The supplier key an invoice is remembered under: its link first, else its printed name. */
function supplierKey(row: { supplier_id: string | null; client_name: string | null }): string {
  const id = (row.supplier_id ?? "").trim();
  if (id) return `id:${id}`;
  const name = (row.client_name ?? "").trim().toLowerCase();
  return name ? `name:${name}` : "";
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const pipeline = createPipelineClient();

  try {
    // Every incoming invoice, decided or not: the DECIDED ones are what the suggestion for the
    // undecided ones rests on. Reading only the open ones would throw away the owner's own
    // history, which is the strongest signal this endpoint has.
    const rows = await fetchAllRows<InvoiceRow>((from, to) =>
      // [GROOTBOEK] ledger_account is newer than the generated types → relaxed client.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pipeline as any)
        .from("invoices")
        .select("id, invoice_number, invoice_date, client_name, supplier_id, total_ex_btw, total_inc_btw, ledger_account")
        .eq("receiver_id", user.id)
        .eq("direction", "incoming")
        .not("status", "in", "(draft,archived,cancelled)")
        .order("id", { ascending: true })
        .range(from, to));

    // What this owner has actually done, per supplier. Only real accounts count — a stored value
    // this app no longer knows is not evidence of a habit.
    const historyBySupplier = new Map<string, string[]>();
    for (const r of rows) {
      const account = (r.ledger_account ?? "").trim();
      if (!isLedgerAccount(account)) continue;
      const key = supplierKey(r);
      if (!key) continue;
      historyBySupplier.set(key, [...(historyBySupplier.get(key) ?? []), account]);
    }

    // [GROOTBOEK-PER-LEVERANCIER] Grouped by supplier, not listed by invoice — and that is a
    // measurement, not a preference. On the live administration 550 invoices wait for an account
    // across 101 suppliers, and 511 of them belong to the 62 suppliers with more than one; the
    // largest has 102 invoices on its own. Answering per invoice is 550 decisions about the same
    // handful of questions, which is a list nobody finishes, and an unfinished list means the
    // auditfile keeps writing 4000 for everything.
    //
    // The group carries its COUNT and its total, so the owner always sees the size of what they
    // are deciding. A supplier whose invoices genuinely differ — a landlord who also bills for
    // cleaning — is visible as a large group, and a different answer per invoice stays possible
    // through the same door afterwards.
    const groups = new Map<string, {
      key: string; vendor: string | null; ids: string[];
      count: number; gross: number; newest: string | null;
    }>();
    for (const r of rows) {
      if (isLedgerAccount(r.ledger_account)) continue;
      const key = supplierKey(r) || `row:${r.id}`;
      const g = groups.get(key) ?? {
        key, vendor: r.client_name, ids: [], count: 0, gross: 0, newest: null,
      };
      g.ids.push(r.id);
      g.count += 1;
      // [CENT-VEILIG] An amount that is not there is not zero — it is left out of the sum.
      if (typeof r.total_inc_btw === "number" && Number.isFinite(r.total_inc_btw)) {
        g.gross += Math.abs(r.total_inc_btw);
      }
      const day = r.invoice_date ?? null;
      if (day && (!g.newest || day > g.newest)) g.newest = day;
      groups.set(key, g);
    }

    const open = [...groups.values()]
      .map((g) => ({
        key: g.key,
        vendor: g.vendor,
        ids: g.ids,
        count: g.count,
        gross: round2(g.gross),
        newest: g.newest,
        suggestion: suggestLedgerAccount({
          vendor: g.vendor,
          supplierHistory: historyBySupplier.get(g.key) ?? [],
        }) as LedgerSuggestion,
      }))
      // Biggest first: the supplier with 102 invoices is the one tap worth most.
      .sort((a, b) => b.count - a.count || (b.newest ?? "").localeCompare(a.newest ?? ""));

    const openInvoices = open.reduce((n, g) => n + g.count, 0);
    return NextResponse.json({
      ok: true,
      accounts: LEDGER_ACCOUNTS,
      open,
      openInvoices,
      decided: rows.length - openInvoices,
      total: rows.length,
    });
  } catch (e) {
    console.error("[GROOTBOEK] openstaande rekeningen lezen mislukt", {
      userId: user.id, error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "We konden nu niet ophalen welke facturen nog een rekening nodig hebben." },
      { status: 503 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json().catch(() => null) as
    { id?: string; ids?: string[]; account?: string | null } | null;
  // One invoice or a supplier's whole open set — the same decision either way, so the same door.
  const ids = [...new Set(
    (Array.isArray(body?.ids) ? body.ids : [body?.id])
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean),
  )];
  if (ids.length === 0) return NextResponse.json({ error: "Geen factuur opgegeven" }, { status: 400 });
  // A ceiling on one request, not on the feature: a supplier with more open invoices than this is
  // answered in two taps rather than in one request that times out halfway and leaves the set
  // half-decided.
  if (ids.length > MAX_PER_CALL) {
    return NextResponse.json(
      { error: "Te veel facturen in één keer.", code: "too_many" },
      { status: 400 },
    );
  }

  // null clears the answer — an owner who realises they picked the wrong account must be able to
  // put the invoice back on the list rather than having to pick a second wrong one.
  const raw = body?.account === null ? null : (body?.account ?? "").trim();
  if (raw !== null && !isLedgerAccount(raw)) {
    return NextResponse.json(
      { error: "Die grootboekrekening kennen we niet.", code: "unknown_account" },
      { status: 400 },
    );
  }

  const pipeline = createPipelineClient();
  // [IN-CHUNK] The id list travels in the URL, so past a few hundred the whole UPDATE dies on a
  // 414 — and then nothing is written while the owner was told it would be. Per chunk.
  const changed: string[] = [];
  for (const chunk of chunkIds(ids)) {
    // Guarded on receiver_id AND direction: this column means nothing on a sales invoice, and a
    // route that would write it there is a route that can be pointed at somebody else's row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (pipeline as any)
      .from("invoices")
      .update({ ledger_account: raw })
      .in("id", chunk)
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .select("id");

    if (error) {
      console.error("[GROOTBOEK] rekening opslaan mislukt", { count: chunk.length, error: error.message });
      // Say what DID land. A partial write reported as a clean failure sends the owner back to
      // re-answer invoices that are already answered.
      return NextResponse.json(
        { error: "Opslaan mislukt — probeer het nog een keer.", changed: changed.length },
        { status: 500 },
      );
    }
    for (const row of (data ?? []) as { id: string }[]) changed.push(row.id);
  }
  if (changed.length === 0) return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });

  // The account decides where money lands in the auditfile, so the change is part of the trail —
  // one entry per invoice, because that is the row a boekhouder looks up later.
  for (const id of changed) {
    await logAuditAction({
      userId: user.id,
      action: "invoice.ledger_account_set",
      entityType: "invoice",
      entityId: id,
      newValue: { ledger_account: raw },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, changed: changed.length, account: raw });
}

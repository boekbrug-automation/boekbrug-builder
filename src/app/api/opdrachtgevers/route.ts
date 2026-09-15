// src/app/api/opdrachtgevers/route.ts
// [OPDRACHTGEVER] Who this year's money came from — the owner's own invoices, added up.
//
// Their OWN administration only: no clientId parameter, so an accountant looking at a client's
// year does not get this panel. That is deliberate rather than unfinished — these figures are
// about the owner's own position as an ondernemer, and an accountant who needs them asks for the
// auditfile, which already carries every invoice.
//
// [NO-SILENT-EMPTY] A failed read is a 503 with a sentence, never an empty year: "you invoiced
// nobody" and "we could not look" are opposite answers, and on this screen the first one is the
// dangerous direction.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { amsterdamToday } from "@/lib/format-nl";
import { opdrachtgeverDossier, type OpdrachtgeverInvoice, type OpdrachtgeverHours, type OpdrachtgeverAgreedRate } from "@/lib/opdrachtgevers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const asked = Number(req.nextUrl.searchParams.get("year"));
  const thisYear = Number(amsterdamToday().slice(0, 4));
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= thisYear ? asked : thisYear;
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  try {
    // Only documents that are revenue: a factuur, or the creditnota that nets against one. An
    // offerte is not money, and a concept was never issued.
    // [VOL-GELEZEN] Paged: a busy year passes the 1000-row cap, and a truncated year would
    // understate the biggest client's share — the one figure this panel exists to state.
    const [invoices, hours, rates] = await Promise.all([
      // [DBA-DOSSIER] No year filter any more, deliberately. "Since when" and "won this year" are
      // both answers about the history, and a query cut at 1 January cannot give either: an
      // opdrachtgever of four years and one of six weeks look identical inside one year. The cut is
      // made in opdrachtgeverDossier instead, on the same rule the query used — an invoice with no
      // readable date belongs to no year — so the year's own totals are exactly what they were.
      fetchAllRows<OpdrachtgeverInvoice>((lo, hi) =>
        supabase.from("invoices")
          .select("client_id, client_name, total_ex_btw, invoice_date")
          .eq("sender_id", user.id).eq("direction", "outgoing")
          .in("invoice_type", ["factuur", "creditnota"])
          .not("status", "in", "(draft,archived,cancelled)")
          .lte("invoice_date", end)
          .order("id", { ascending: true }).range(lo, hi)),
      fetchAllRows<OpdrachtgeverHours>((lo, hi) =>
        supabase.from("time_entries")
          .select("client_id, hours")
          .eq("user_id", user.id)
          .gte("worked_on", start).lte("worked_on", end)
          .order("id", { ascending: true }).range(lo, hi)),
      // [DBA-DOSSIER] The rate the owner AGREED per klant. Read, never derived: revenue divided by
      // hours folds in every product line and every unbilled hour, and would print a price nobody
      // ever quoted. The column is newer than the generated types, hence the relaxed client.
      fetchAllRows<OpdrachtgeverAgreedRate>((lo, hi) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("clients")
          .select("client_id:id, default_hourly_rate")
          .eq("user_id", user.id)
          .order("id", { ascending: true }).range(lo, hi)),
    ]);
    return NextResponse.json({ ok: true, ...opdrachtgeverDossier({ year, invoices, hours, rates }) });
  } catch (e) {
    console.error("[OPDRACHTGEVER] jaar lezen mislukt", { year, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "We konden je opdrachtgevers nu niet ophalen." }, { status: 503 });
  }
}

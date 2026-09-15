// src/app/api/geleerd/route.ts
// [GELEERD-SINDSDIEN] The ignored purchase invoices that were read before the reader learned what
// they needed.
//
// Read-only, on purpose. Putting an invoice back is the owner's tap, through the restore door that
// already exists (PATCH /api/email/confirm/[id]) — they archived it deliberately, and a route that
// un-archives on its own would overrule a decision it has no standing to overrule. This one only
// says: the evidence changed.
//
// [NO-SILENT-EMPTY] A failed read is a 503 with a sentence. An empty list means "nothing to look
// at again", which is a claim, and it may not be made by a query that fell over.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { learnedSince } from "@/lib/geleerd-sindsdien";
// [CENT] The app has exactly one rounding to cents, and this is it.
import { round2 } from "@/lib/invoice-totals";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  client_name: string | null;
  total_inc_btw: number | null;
  status: string | null;
  direction: string | null;
  pdf_url: string | null;
  field_confidence: unknown;
}

/** The stored hold, read defensively: this JSON was written by older versions of the app. */
function safecoreOf(fc: unknown): { flags: string[]; heldAt: string | null } {
  if (!fc || typeof fc !== "object") return { flags: [], heldAt: null };
  const core = (fc as { _safecore?: unknown })._safecore;
  if (!core || typeof core !== "object") return { flags: [], heldAt: null };
  const raw = (core as { flags?: unknown }).flags;
  const heldAt = (core as { held_at?: unknown }).held_at;
  return {
    flags: Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string") : [],
    heldAt: typeof heldAt === "string" ? heldAt : null,
  };
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const pipeline = createPipelineClient();

  try {
    const rows = await fetchAllRows<Row>((from, to) =>
      pipeline
        .from("invoices")
        .select("id, invoice_number, invoice_date, client_name, total_inc_btw, status, direction, pdf_url, field_confidence")
        .eq("receiver_id", user.id)
        .eq("direction", "incoming")
        .eq("status", "archived")
        .order("id", { ascending: true })
        .range(from, to));

    const items = rows
      .map((r) => {
        const { flags, heldAt } = safecoreOf(r.field_confidence);
        const verdict = learnedSince({
          status: r.status, direction: r.direction,
          hasFile: Boolean((r.pdf_url ?? "").trim()),
          flags, heldAt,
        });
        return { r, verdict };
      })
      .filter(({ verdict }) => verdict.worthOffering)
      .map(({ r, verdict }) => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        vendor: r.client_name,
        totalIncBtw: r.total_inc_btw,
        gained: verdict.gained,
      }))
      .sort((a, b) => Math.abs(b.totalIncBtw ?? 0) - Math.abs(a.totalIncBtw ?? 0));

    // The total is the point: one invoice is a curiosity, forty is a quarter's worth of costs.
    // [CENT-VEILIG] An amount that is not there is not zero — it is left out of the sum entirely.
    const gross = items.reduce((s, i) => s + (typeof i.totalIncBtw === "number" ? Math.abs(i.totalIncBtw) : 0), 0);

    return NextResponse.json({ ok: true, items, gross: round2(gross) });
  } catch (e) {
    console.error("[GELEERD-SINDSDIEN] genegeerde facturen lezen mislukt", {
      userId: user.id, error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "We konden je genegeerde facturen nu niet nakijken." },
      { status: 503 },
    );
  }
}

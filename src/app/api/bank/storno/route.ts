// src/app/api/bank/storno/route.ts
// [STORNO] POST { stornoTxId, originTxId } — the owner confirms that this credit is the reversal
// of that incasso. Three things happen, each through the door that already owns it:
//   1. the origin is UNLINKED (/api/bank/unlink's own handler): the invoice goes back to open,
//      amount_paid lowered by exactly what this payment applied, the category cleared;
//   2. the origin is set aside with reason 'storno' (/api/bank/ignore's handler);
//   3. the storno line is set aside with reason 'storno' (same handler).
// Both lines then sit outside the books — they net to zero — and the invoice stands open again,
// which is the one fact a storno exists to state. Nothing here writes invoices or categories.
//
// The pairing is re-proved on the server with the same pure rule the screen used, on the rows as
// they are NOW: a proposal the screen made a minute ago must not un-pay an invoice that a newer
// payment has meanwhile settled.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { requireOwnerPermission } from "@/lib/access/context";
import { findStornoOrigin } from "@/lib/bank-storno";
import { POST as unlinkLine } from "@/app/api/bank/unlink/route";
import { POST as setAside } from "@/app/api/bank/ignore/route";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT = "id, status, invoice_id, amount, date, counterpart_iban, counterpart_name, description, reference, type_code, mandate_id, creditor_id";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  { const w = await requireOwnerPermission("payment.allocate", "Een teruggeboekte incasso terugdraaien"); if (w.response) return w.response; }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const stornoTxId = typeof body?.stornoTxId === "string" ? body.stornoTxId : "";
  const originTxId = typeof body?.originTxId === "string" ? body.originTxId : "";
  if (!UUID.test(stornoTxId) || !UUID.test(originTxId) || stornoTxId === originTxId) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // type_code, mandate_id and creditor_id are hand-applied columns → relaxed client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any;
  const { data: rows, error } = await pipeline
    .from("bank_transactions").select(SELECT).eq("user_id", user.id).in("id", [stornoTxId, originTxId]);
  if (error) return NextResponse.json({ error: "tx_lookup_failed", detail: error.message }, { status: 500 });
  type Row = { id: string; status: string | null; invoice_id: string | null; amount: number | null; date: string | null; counterpart_iban: string | null; counterpart_name: string | null; description: string | null; reference: string | null; type_code: string | null; mandate_id: string | null; creditor_id: string | null };
  const storno = ((rows ?? []) as Row[]).find((r) => r.id === stornoTxId);
  const origin = ((rows ?? []) as Row[]).find((r) => r.id === originTxId);
  if (!storno || !origin) return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  if (storno.status !== "pending") return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });

  const proved = findStornoOrigin(
    {
      id: storno.id, amount: storno.amount, date: storno.date, counterpartIban: storno.counterpart_iban, counterpartName: storno.counterpart_name,
      description: storno.description, reference: storno.reference, typeCode: storno.type_code, mandateId: storno.mandate_id, creditorId: storno.creditor_id,
    },
    [{ id: origin.id, amount: origin.amount, date: origin.date, counterpartIban: origin.counterpart_iban, counterpartName: origin.counterpart_name, status: origin.status, invoiceId: origin.invoice_id }],
  );
  if (!proved) return NextResponse.json({ error: "not_a_storno_pair", code: "not_a_storno_pair" }, { status: 409 });
  const invoiceId = origin.invoice_id;

  const door = (path: string, payload: unknown) =>
    new NextRequest(new URL(path, req.url), {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "", "x-real-ip": req.headers.get("x-real-ip") ?? "" },
      body: JSON.stringify(payload),
    });

  // 1. Unlink the origin — the invoice goes back to open.
  const unlinked = await unlinkLine(door("/api/bank/unlink", { transactionId: originTxId }));
  if (!unlinked.ok) {
    const j = await unlinked.json().catch(() => ({}));
    return NextResponse.json({ error: "unlink_refused", detail: j?.error ?? null }, { status: unlinked.status });
  }
  // 2 + 3. Both lines aside, reason 'storno'. The origin is 'pending' now (unlink put it there).
  const asideOrigin = await setAside(door("/api/bank/ignore", { transactionId: originTxId, action: "ignore", reason: "storno" }));
  const asideStorno = await setAside(door("/api/bank/ignore", { transactionId: stornoTxId, action: "ignore", reason: "storno" }));
  const partial = !asideOrigin.ok || !asideStorno.ok;
  if (partial) {
    console.error("[STORNO] invoice re-opened but a line could not be set aside", { userId: user.id, stornoTxId, originTxId, origin: asideOrigin.status, storno: asideStorno.status });
  }
  await logAuditAction({
    userId: user.id, action: "bank.storno_applied", entityType: "bank_transaction", entityId: stornoTxId,
    newValue: { origin_tx_id: originTxId, invoice_id: invoiceId, amount: storno.amount, lines_set_aside: !partial },
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, invoiceId, linesSetAside: !partial });
}

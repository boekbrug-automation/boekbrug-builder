// src/app/api/wachtkoppeling/route.ts
// [WACHTKOPPELING] "Ik heb dit betaald — de bank laat het over twee dagen zien."
//
//   GET    → the owner's open waiting links, each with the bank line that fits it (if one does)
//   POST   → record one: what was paid, when, to whom, and which invoices it settles
//   PATCH  → { id, actie: 'gekoppeld' | 'ingetrokken' } — record the OUTCOME, after the fact
//
// ── THIS ROUTE NEVER MOVES MONEY ──
//
// Not once, on any path. A waiting link is a note about an intention; the booking goes through
// /api/bank/confirm exactly as it always has, with the transactionId this route found and the
// invoiceIds the owner recorded. PATCH is called AFTERWARDS to write down what happened.
//
// That separation is not tidiness. /api/bank/confirm carries the whole of this app's money
// discipline — [BANK-MULTI-CONFIRM]'s "a booking may only spend what the payment still has",
// the session-client pay so the verwerkt trigger fires, the pinned pipeline update. A second
// door that also pays would have to reproduce every one of those, and the day it drifted from
// the first the two would disagree about how much of a payment is still assignable.
//
// ── THE PROPOSAL IS DERIVED, NEVER STORED ──
//
// GET computes the fit live from the bank lines as they are now. Storing a proposal would mean
// keeping it true as transactions arrive, get linked elsewhere, or are deleted — a second state
// to age badly. The same argument the grootboek makes about the journal: derive it.

import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { amsterdamToday } from "@/lib/format-nl";
import {
  wachtVoorTransactie, isVerlopen, defaultVerlooptOp,
  type Wachtkoppeling, type WachtTransactie,
} from "@/lib/wachtkoppeling";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The row as stored. The new table is not in the generated types yet. */
interface Row {
  id: string; richting: string; bedrag: number | string; betaald_op: string;
  tegenpartij: string | null; factuur_ids: string[]; notitie: string | null;
  status: string; transaction_id: string | null; verloopt_op: string;
}

function toDomain(r: Row): Wachtkoppeling {
  return {
    id: r.id,
    richting: r.richting === "in" ? "in" : "uit",
    bedrag: Number(r.bedrag),
    betaaldOp: String(r.betaald_op).slice(0, 10),
    tegenpartij: r.tegenpartij,
    factuurIds: Array.isArray(r.factuur_ids) ? r.factuur_ids : [],
    verlooptOp: String(r.verloopt_op).slice(0, 10),
  };
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("wachtkoppelingen")
    .select("id, richting, bedrag, betaald_op, tegenpartij, factuur_ids, notitie, status, transaction_id, verloopt_op")
    .eq("user_id", user.id)
    .in("status", ["wachtend", "voorgesteld"])
    .order("betaald_op", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "De openstaande koppelingen konden niet worden gelezen." }, { status: 503 });
  }

  const today = amsterdamToday();
  const open = (data ?? []) as Row[];
  const links = open.map(toDomain);

  // [RITME] A link past its window stops asking. It is reported as expired rather than hidden:
  // the owner said they paid something, and quietly dropping that claim would lose the only
  // record that the payment was ever expected.
  const verlopen = links.filter((w) => isVerlopen(w, today));
  const levend = links.filter((w) => !isVerlopen(w, today));

  let voorstellen: { wachtId: string; transactionId: string; reasons: string[] }[] = [];
  let ambigu: { wachtId: string }[] = [];
  let bankUnavailable = false;

  if (levend.length > 0) {
    try {
      const rows = await fetchAllRows<{
        id: string; date: string | null; amount: number | null;
        counterpart_name: string | null; counterpart_iban: string | null;
        invoice_id: string | null; status: string | null;
      }>((from, to) => supabase
        .from("bank_transactions")
        .select("id, date, amount, counterpart_name, counterpart_iban, invoice_id, status")
        .eq("user_id", user.id)
        .is("invoice_id", null)
        .order("id", { ascending: true })
        .range(from, to));

      const txs: WachtTransactie[] = rows
        .filter((r) => r.date != null && r.amount != null && r.status !== "ignored")
        .map((r) => ({
          id: r.id, date: String(r.date), amount: Number(r.amount),
          counterpartName: r.counterpart_name, counterpartIban: r.counterpart_iban,
          invoiceId: r.invoice_id,
        }));

      // One transaction may only ever be proposed to ONE waiting link, and a link takes at most
      // one transaction. Anything else would offer the same euros twice.
      const takenTx = new Set<string>();
      const takenWacht = new Set<string>();
      for (const tx of txs) {
        if (takenTx.has(tx.id)) continue;
        const hit = wachtVoorTransactie(levend.filter((w) => !takenWacht.has(w.id)), tx);
        if (hit == null) continue;
        if ("ambiguous" in hit) { for (const a of hit.ambiguous) ambigu.push({ wachtId: a.id }); continue; }
        takenTx.add(tx.id);
        takenWacht.add(hit.match.id);
        voorstellen.push({ wachtId: hit.match.id, transactionId: tx.id, reasons: hit.reasons });
      }
    } catch {
      // [NO-SILENT-EMPTY] "no bank line fits" and "we could not look" render identically, and the
      // first one tells the owner their administration is caught up.
      bankUnavailable = true;
      voorstellen = [];
      ambigu = [];
    }
  }

  return NextResponse.json({
    wachtend: levend,
    verlopen,
    voorstellen,
    ambigu,
    ...(bankUnavailable ? { bankUnavailable: true } : {}),
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 }); }

  const richting = body.richting === "in" ? "in" : "uit";
  const bedrag = Number(body.bedrag);
  const betaaldOp = typeof body.betaaldOp === "string" ? body.betaaldOp.slice(0, 10) : "";
  const tegenpartij = typeof body.tegenpartij === "string" && body.tegenpartij.trim() ? body.tegenpartij.trim() : null;
  const notitie = typeof body.notitie === "string" && body.notitie.trim() ? body.notitie.trim() : null;
  const factuurIds = Array.isArray(body.factuurIds)
    ? [...new Set((body.factuurIds as unknown[]).filter((x): x is string => typeof x === "string" && UUID.test(x)))]
    : [];

  // The amount is the whole point of the record and is never guessed from anything else.
  if (!Number.isFinite(bedrag) || bedrag <= 0) {
    return NextResponse.json({ error: "Vul het bedrag in dat je hebt betaald." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(betaaldOp)) {
    return NextResponse.json({ error: "Vul de datum in waarop je betaalde." }, { status: 400 });
  }
  if (factuurIds.length > 50) {
    return NextResponse.json({ error: "Te veel facturen in één betaling." }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("wachtkoppelingen")
    .insert({
      user_id: user.id,
      richting,
      bedrag,
      betaald_op: betaaldOp,
      tegenpartij,
      notitie,
      factuur_ids: factuurIds,
      verloopt_op: defaultVerlooptOp(betaaldOp),
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: "De koppeling kon niet worden bewaard." }, { status: 503 });
  }

  await logAuditAction({
    userId: user.id,
    action: "wachtkoppeling.created",
    entityType: "wachtkoppeling",
    entityId: data.id,
    ipAddress: getClientIP(req),
    newValue: { bedrag, richting, facturen: factuurIds.length },
  });

  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 }); }

  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  const actie = body.actie === "gekoppeld" || body.actie === "ingetrokken" ? body.actie : null;
  const transactionId = typeof body.transactionId === "string" && UUID.test(body.transactionId) ? body.transactionId : null;
  if (!id || !actie) return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });

  // A link that says it is linked must name what to. The database says the same thing in a CHECK
  // constraint; this says it earlier, so the owner gets a sentence instead of a 500.
  if (actie === "gekoppeld" && !transactionId) {
    return NextResponse.json({ error: "Er is geen bankregel meegegeven." }, { status: 400 });
  }

  const pipeline = createPipelineClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = pipeline as any;
  const { data, error } = await db
    .from("wachtkoppelingen")
    .update({
      status: actie,
      transaction_id: actie === "gekoppeld" ? transactionId : null,
      resolved_at: new Date().toISOString(),
    })
    // Pinned to this owner: a pipeline client carries no RLS of its own.
    .eq("user_id", user.id)
    .eq("id", id)
    .in("status", ["wachtend", "voorgesteld"])
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "De koppeling kon niet worden bijgewerkt." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Deze koppeling is al afgehandeld." }, { status: 409 });

  await logAuditAction({
    userId: user.id,
    action: actie === "gekoppeld" ? "wachtkoppeling.linked" : "wachtkoppeling.withdrawn",
    entityType: "wachtkoppeling",
    entityId: id,
    ipAddress: getClientIP(req),
    newValue: transactionId ? { transactionId } : {},
  });

  return NextResponse.json({ ok: true });
}

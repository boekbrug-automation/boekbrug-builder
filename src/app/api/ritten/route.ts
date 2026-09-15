// src/app/api/ritten/route.ts
// [RITTEN] The kilometre log — read, write, correct, throw away.
//
//   GET    /api/ritten?year=2026 → the year's trips, newest first (default: this year)
//   POST   /api/ritten           → write down one trip
//   PATCH  /api/ritten           → correct one trip — only while it is NOT on an invoice
//   DELETE /api/ritten?id=…      → throw one away — same condition
//
// THE RULE THAT KEEPS COMING BACK
//
// A trip that is on an invoice is no longer an input field. The customer holds that document and
// the line on it is a claim about what was driven; changing the row underneath makes an invoice
// that no longer agrees with its own evidence, and art. 52 AWR expects that evidence to still be
// there. Hence `.is('invoice_id', null)` on every write: the database gives the answer, not us.
//
// Throw the concept invoice away and ON DELETE SET NULL hands the kilometres back — they were
// still driven.
//
// WHOSE TRIPS
//
// The ADMINISTRATION's (ownerId), like the hours: an accountant acting for an owner writes into
// that owner's log, and a trip filed under an employee id would be invisible to the year that
// computes the deduction.
//
// [TAAL] Every sentence comes from the catalogue, in the language of whoever is typing.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { getActingFor } from "@/lib/acting-for-server";
import { invoiceOwnerId, isActingForOther } from "@/lib/acting-for";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { amsterdamToday } from "@/lib/format-nl";
import { normalizeMileageInput, MAX_KM_PER_TRIP, type MileageRefusal } from "@/lib/ritten";
import { RITTEN_REFUSAL_KEY } from "@/lib/ritten-refusal";
import { serverTranslator } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/t";

export const dynamic = "force-dynamic";

const COLUMNS =
  "id, client_id, driven_on, from_place, to_place, purpose, kilometers, rate_per_km, business, invoice_id, created_at";

function refusalSentence(t: Translator, code: MileageRefusal): string {
  return t(RITTEN_REFUSAL_KEY[code], { max: MAX_KM_PER_TRIP });
}

async function context() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const acting = await getActingFor();
  if (!acting) return null;
  const t = await serverTranslator();
  const ownerId = invoiceOwnerId(acting);
  // mileage_entries has one RLS policy (user_id = auth.uid()) and it knows no employee, so acting
  // for another administration goes through the pipeline client with an explicit owner filter —
  // the same choice as /api/uren and /api/articles ([RLS-UIT]).
  const db = isActingForOther(acting) ? createPipelineClient() : supabase;
  return { db, ownerId, actorId: acting.actorId, t };
}

const unauthorized = async () =>
  NextResponse.json({ error: (await serverTranslator())("uren.fout.nietIngelogd"), code: "unauthorized" }, { status: 401 });

export async function GET(req: NextRequest) {
  const ctx = await context();
  if (!ctx) return unauthorized();

  const asked = Number(req.nextUrl.searchParams.get("year"));
  const thisYear = Number(amsterdamToday().slice(0, 4));
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= thisYear + 1 ? asked : thisYear;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db as any)
    .from("mileage_entries")
    .select(COLUMNS)
    .eq("user_id", ctx.ownerId)
    .gte("driven_on", `${year}-01-01`)
    .lte("driven_on", `${year}-12-31`)
    .order("driven_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);

  // [NO-SILENT-EMPTY] A failed read is not an empty log. Returning [] would tell an owner whose
  // database is down that they drove nowhere this year — and that is the figure their deduction
  // hangs on.
  if (error) {
    console.error("[RITTEN] ritten lezen mislukt", { error });
    return NextResponse.json({ error: ctx.t("ritten.fout.laden"), code: "load_failed" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, year, entries: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await context();
  if (!ctx) return unauthorized();

  const limit = await checkRateLimit({
    userId: ctx.actorId, endpoint: "/api/ritten", ...RATE_LIMITS.UREN_WRITE,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const body = await req.json().catch(() => null);
  const parsed = normalizeMileageInput(body && typeof body === "object" ? body : {});
  if (!parsed.ok) {
    return NextResponse.json({ error: refusalSentence(ctx.t, parsed.code), code: parsed.code }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db as any)
    .from("mileage_entries")
    .insert({ ...parsed.entry, user_id: ctx.ownerId })
    .select(COLUMNS)
    .single();

  if (error || !data) {
    // The customer reference is the one field the database can refuse while this route accepted
    // it: somebody else's client_id exists, but not here.
    console.error("[RITTEN] rit opslaan mislukt", { error });
    return NextResponse.json({ error: ctx.t("ritten.fout.opslaan"), code: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, entry: data });
}

export async function PATCH(req: NextRequest) {
  const ctx = await context();
  if (!ctx) return unauthorized();

  const body = await req.json().catch(() => null);
  const id = body && typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: ctx.t("ritten.fout.welkeRit"), code: "missing_id" }, { status: 400 });

  const parsed = normalizeMileageInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: refusalSentence(ctx.t, parsed.code), code: parsed.code }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db as any)
    .from("mileage_entries")
    .update({ ...parsed.entry, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", ctx.ownerId)
    // See the header: a billed trip is no longer an input field.
    .is("invoice_id", null)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[RITTEN] rit bijwerken mislukt", { error });
    return NextResponse.json({ error: ctx.t("ritten.fout.aanpassen"), code: "update_failed" }, { status: 500 });
  }
  // Zero rows means something specific, and the owner should read WHICH of the two it is.
  if (!data) {
    return NextResponse.json({ error: ctx.t("ritten.fout.alGefactureerd"), code: "already_billed" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, entry: data });
}

export async function DELETE(req: NextRequest) {
  const ctx = await context();
  if (!ctx) return unauthorized();

  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: ctx.t("ritten.fout.welkeRit"), code: "missing_id" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db as any)
    .from("mileage_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.ownerId)
    .is("invoice_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[RITTEN] rit verwijderen mislukt", { error });
    return NextResponse.json({ error: ctx.t("ritten.fout.verwijderenMislukt"), code: "delete_failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: ctx.t("ritten.fout.alGefactureerd"), code: "already_billed" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, id: data.id });
}

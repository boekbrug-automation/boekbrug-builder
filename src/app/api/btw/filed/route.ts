// src/app/api/btw/filed/route.ts
// [JAARSTAND] Which quarters of a year are filed. One SELECT, no recompute.
//
// GET /api/btw/filed?year=2026 → { ok: true, filed: [1, 3], gediend: [{ quarter: 1, filedAt: "2026-04-11" }, …] }
//
// [CORRECTIE-TIJDVAK] `gediend` carries the day each quarter went out, for the notice shown BEFORE
// a correction lands in a filed quarter. `filed` stays exactly what the year strip already reads.
//
// Deliberately NOT part of /api/btw/file: that route answers about ONE quarter and recomputes the
// live figures to report divergence against the frozen snapshot. Calling it four times to draw a
// year strip would run the reconcile engine four times for an answer that is a list of integers.
//
// Reads through the SESSION client, so RLS scopes it to the caller — the year strip is the owner's
// own, and this route never takes a user id from the request.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { readFiledQuartersDetailOfYear } from "@/lib/filed-quarter";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { rows, failed } = await readFiledQuartersDetailOfYear(supabase as any, user.id, year);
  // [NO-SILENT-EMPTY] A failed read is a 503, never `filed: []`. An empty list means "none are
  // filed", and the strip draws a very different year from that than from "we could not look".
  if (failed) return NextResponse.json({ error: "filings_read_failed" }, { status: 503 });

  return NextResponse.json({ ok: true, year, filed: rows.map((r) => r.quarter), gediend: rows });
}

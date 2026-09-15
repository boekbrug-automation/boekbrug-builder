// src/app/api/onderhanden-werk/route.ts
// [ONDERHANDEN-WERK] The uninvoiced work the owner was carrying on the last day of a book year.
//
// Their OWN administration only, for the same reason as /api/opdrachtgevers: no clientId, so an
// accountant reading a client's year does not get this door. What an accountant needs is in the
// closing package and the auditfile.
//
// Two reads, and the second is what makes the figure right: the hours of the year, and the DATES
// of the invoices those hours ended up on. An hour worked in December and billed in January was
// still work in progress on 31 December, and without the invoice date it would look settled.
//
// [NO-SILENT-EMPTY] A failed read is a 503 with a sentence. "You were carrying nothing" and "we
// could not look" are opposite answers, and this one ends up in a profit figure.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { amsterdamToday } from "@/lib/format-nl";
import { workInProgress, endOfYear, type WipEntry } from "@/lib/onderhanden-werk";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const asked = Number(req.nextUrl.searchParams.get("year"));
  const thisYear = Number(amsterdamToday().slice(0, 4));
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= thisYear ? asked : thisYear;
  const until = endOfYear(year);

  try {
    // Every hour up to and including the cutoff, not only this year's: an hour from 2024 that was
    // never invoiced is still being carried, and dropping it would understate the asset.
    // [VOL-GELEZEN] Paged — a year of hours passes the 1000-row cap easily.
    // [DECLARABEL] billable is newer than the generated types, hence the cast on the read.
    const entries = await fetchAllRows<WipEntry>((lo, hi) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from("time_entries")
        .select("client_id, worked_on, hours, hourly_rate, invoice_id, billable")
        .eq("user_id", user.id)
        .lte("worked_on", until)
        .order("id", { ascending: true }).range(lo, hi));

    // The dates of the invoices those hours point at. Only the ones we actually need, chunked.
    const invoiceIds = [...new Set(entries.map((e) => e.invoice_id).filter((id): id is string => Boolean(id)))];
    const invoiceRows = await fetchAllRowsForIds<{ id: string; invoice_date: string | null }, string>(
      invoiceIds,
      (chunk, lo, hi) =>
        supabase.from("invoices")
          .select("id, invoice_date")
          .in("id", chunk)
          .eq("sender_id", user.id)
          .order("id", { ascending: true }).range(lo, hi),
    );
    const invoiceDateById: Record<string, string | null> = {};
    for (const row of invoiceRows) invoiceDateById[row.id] = row.invoice_date;

    const wip = workInProgress({ entries, until, invoiceDateById });

    // The names, so the panel does not have to fetch the customer list to print three rows. A name
    // that cannot be read is left out and the row falls back to "geen klant" — a missing name never
    // removes an amount from the figure.
    const clientIds = wip.clients.map((c) => c.clientId).filter((id): id is string => Boolean(id));
    const names: Record<string, string> = {};
    try {
      const rows = await fetchAllRowsForIds<{ id: string; name: string | null }, string>(
        clientIds,
        (chunk, lo, hi) =>
          supabase.from("clients")
            .select("id, name")
            .in("id", chunk)
            .order("id", { ascending: true }).range(lo, hi),
      );
      for (const row of rows) if (row.name) names[row.id] = row.name;
    } catch (e) {
      console.error("[ONDERHANDEN-WERK] klantnamen lezen mislukt", { error: e instanceof Error ? e.message : String(e) });
    }

    return NextResponse.json({ ok: true, year, names, ...wip });
  } catch (e) {
    console.error("[ONDERHANDEN-WERK] lezen mislukt", { year, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "We konden je onderhanden werk nu niet ophalen." }, { status: 503 });
  }
}

// src/lib/ubl-inputs.ts
// [E-FACTUUR] The database rows an e-factuur is built from, mapped once.
// Run: npx tsx --test src/lib/ubl-inputs.test.ts
//
// ── WHY THIS IS ITS OWN MODULE ──
//
// buildInvoiceUbl() is pure and well tested, and for a long time it had exactly one caller: the
// download button behind /api/export/ubl. That route therefore owned both the SELECT literals and
// the row → generator mapping, which was fine while it was alone.
//
// It is not alone any more. The quarter package hands the accountant the same e-factuur next to
// the invoice's PDF, and a second copy of this mapping is the kind of duplication that does not
// announce itself: the two would agree on the day they were written and drift on the first column
// anybody adds, producing two e-facturen of one invoice that differ — the exact document where
// "nearly the same" is worthless.
//
// ── AND WHY THE MAPPING IS THE DANGEROUS HALF, NOT THE SELECT ──
//
// A forgotten column in a SELECT fails loudly: PostgREST answers 42703 and nothing is exported.
// A column that is SELECTED and then not passed on fails silently — the generator reads
// `undefined`, takes its "this deployment does not have that column yet" branch, and writes a
// valid file with a fact missing from it.
//
// That has now happened twice in this codebase. `vat_treatment` was selected and not passed, so
// an exempt line (art. 11 Wet OB) exported as category Z — a 0%-TAXED supply, which the receiver
// books differently. The comment that records that fix sits directly above `discount_type` and
// `discount_value`, which were selected and not passed either: every line discount was invisible
// in the e-factuur, so BG-27 was never written and the agreed unit price was replaced by a price
// per line that reproduces the discounted amount. The file stayed valid and stayed wrong.
//
// So the mapping lives here, once, with a test that walks the whole optional group.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { UblInvoiceHeader, UblInvoiceLine } from "./ubl-export";
// [CREDITNOTA-EXTERN] The typed reference of a standalone creditnota, trimmed the one way.
import { creditReferenceOf } from "./creditnota";

/**
 * The invoice columns an e-factuur needs. One string literal, because a template literal or an
 * array join gives PostgREST's types a `GenericStringError` (BOEK-014).
 */
export const UBL_INVOICE_SELECT =
  // [KORTING-KOP] discount_type/discount_value zijn de korting op DOCUMENTniveau. buildInvoiceUbl
  // leest ze al van de header sinds [REGEL-KORTING] — en geen enkele aanroeper selecteerde of
  // mapte ze, dus `korting` was altijd null en elke e-factuur met een documentkorting factureerde
  // het ONGEKORTE bedrag: opgeslagen/PDF zeiden 2.070, de XML zei 2.300. Beide kolommen bestaan
  // in elke uitrol (gegenereerde typen), dus horen ze in de basis-select, niet achter de
  // 42703-terugval van de regelkolommen.
  // [CREDIT-REF] original_invoice_id is niet voor de kop zelf — het is de sleutel waarmee
  // originalInvoiceRef() hieronder de BillingReference van een creditnota ophaalt (BG-3).
  "id, sender_id, direction, invoice_number, invoice_date, due_date, invoice_type, total_ex_btw, btw_amount, total_inc_btw, client_name, client_address, client_postal_code, client_city, client_btw_number, discount_type, discount_value, original_invoice_id" as const;

/**
 * The line columns, including the OPTIONAL group.
 *
 * `unit`, `vat_treatment`, `discount_type` and `discount_value` each arrive with their own
 * migration, and selecting a column that does not exist yet fails the WHOLE query (42703) — which
 * would leave an accountant unable to export any e-factuur at all. Hence the narrow fallback
 * below, and hence both being exported: a caller that catches "unknown column" must retry with
 * exactly the same reduced list, never with one it invents on the spot.
 */
export const UBL_LINES_SELECT =
  "description, quantity, unit_price, btw_rate, line_total, unit, vat_treatment, discount_type, discount_value" as const;

/** The same read on a database where none of the optional migrations have been applied. */
export const UBL_LINES_SELECT_MINIMAL =
  "description, quantity, unit_price, btw_rate, line_total" as const;

/**
 * The same two reads with the owning invoice's id, for a caller that reads MANY invoices' lines in
 * one query and has to sort them out afterwards — the quarter package.
 *
 * Written out rather than composed with a template literal on purpose: PostgREST's generated types
 * collapse a non-literal select into `GenericStringError`, and then every column on the result is
 * typed `never` (BOEK-014). The consistency test in ubl-inputs.test.ts is what keeps these four
 * literals from drifting apart.
 */
export const UBL_LINES_SELECT_KEYED =
  "invoice_id, description, quantity, unit_price, btw_rate, line_total, unit, vat_treatment, discount_type, discount_value" as const;

/** The keyed read on a database where none of the optional migrations have been applied. */
export const UBL_LINES_SELECT_KEYED_MINIMAL =
  "invoice_id, description, quantity, unit_price, btw_rate, line_total" as const;

/**
 * The supplier profile — the SELLER's, never the exporting user's.
 *
 * kor_active belongs here for a reason that is easy to lose: under the KOR no BTW is charged for a
 * reason that has nothing to do with reverse charge, so a 0% invoice to an EU customer is then NOT
 * a verlegde prestatie. Same question the PDF asks of the same field.
 */
export const UBL_PROFILE_SELECT =
  "company_name, full_name, kvk_number, btw_number, iban, address, postal_code, city, kor_active" as const;

/** One `invoices` row, as much of it as the generator's header needs. */
export type UblInvoiceRow = {
  // [CREDITNOTA-EXTERN] The row's own id: what originalInvoiceRef() reads the typed reference by.
  id?: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  invoice_type: string | null;
  total_ex_btw: number | null;
  btw_amount: number | null;
  total_inc_btw: number | null;
  client_name: string | null;
  client_address: string | null;
  client_postal_code: string | null;
  client_city: string | null;
  client_btw_number: string | null;
  discount_type: string | null;
  discount_value: number | null;
  // [CREDIT-REF] The key originalInvoiceRef() resolves — never header content itself.
  original_invoice_id?: string | null;
};

/** What a creditnota's BillingReference (BG-3) carries, resolved from original_invoice_id. */
export type UblOriginalRef = {
  original_invoice_number: string | null;
  original_invoice_date: string | null;
};

/**
 * [CREDIT-REF] Resolve the invoice a creditnota corrects, best-effort. A booking system pairs a
 * credit note to its original by this reference; without it the credit lands as an orphan someone
 * matches by hand. Best-effort ON PURPOSE: a failed read here costs the reference, never the
 * document — the creditnota itself is complete and valid without BG-3.
 */
export async function originalInvoiceRef(
  supabase: SupabaseClient,
  row: Pick<UblInvoiceRow, "id" | "invoice_type" | "original_invoice_id">,
): Promise<UblOriginalRef | null> {
  if (row.invoice_type !== "creditnota") return null;
  if (row.original_invoice_id) {
    const { data } = await supabase
      .from("invoices")
      .select("invoice_number, invoice_date")
      .eq("id", row.original_invoice_id)
      .maybeSingle();
    if (!data?.invoice_number) return null;
    return { original_invoice_number: data.invoice_number, original_invoice_date: data.invoice_date ?? null };
  }
  // [CREDITNOTA-EXTERN] A standalone creditnota carries its reference itself — the number and
  // date the owner typed for an invoice issued outside BoekBrug. Read apart, untyped: the two
  // columns are newer than the generated types and than some installations, and a missing column
  // costs the BillingReference, never the e-factuur (best-effort, like the linked read above).
  if (!row.id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: typed, error } = await (supabase as any)
    .from("invoices")
    .select("credited_invoice_number, credited_invoice_date")
    .eq("id", row.id)
    .maybeSingle();
  if (error) return null;
  const ref = creditReferenceOf({
    creditedNumber: (typed as { credited_invoice_number?: string | null } | null)?.credited_invoice_number,
    creditedDate: (typed as { credited_invoice_date?: string | null } | null)?.credited_invoice_date,
  });
  if (!ref.originalNumber) return null;
  return { original_invoice_number: ref.originalNumber, original_invoice_date: ref.originalDate };
}

/** One `invoice_lines` row. The optional group is optional here too — see the SELECT above. */
export type UblLineRow = {
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  btw_rate: number | null;
  line_total: number | null;
  unit?: string | null;
  vat_treatment?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
};

/**
 * The header the generator expects.
 *
 * `extra` carries the three (now four) free customer lines from their own failable read — a
 * database where client_extra_lines.sql is still open yields null here and the XML is what it
 * always was. Present, they are REQUIRED in the file: a receiving desk books an invoice against
 * exactly the reference those lines carry.
 */
export function ublHeaderFrom(
  row: UblInvoiceRow,
  extra?: Record<string, string | null> | null,
  // [CREDIT-REF] From originalInvoiceRef() — its own failable read, like `extra`.
  originalRef?: UblOriginalRef | null,
): UblInvoiceHeader {
  return {
    ...(originalRef ?? {}),
    invoice_number: row.invoice_number,
    invoice_date: row.invoice_date,
    due_date: row.due_date,
    invoice_type: row.invoice_type,
    total_ex_btw: row.total_ex_btw,
    btw_amount: row.btw_amount,
    total_inc_btw: row.total_inc_btw,
    client_name: row.client_name,
    client_address: row.client_address,
    client_postal_code: row.client_postal_code,
    client_city: row.client_city,
    client_btw_number: row.client_btw_number,
    // [KORTING-KOP] De documentkorting, eindelijk aan de generator gegeven die haar leest.
    discount_type: row.discount_type ?? null,
    discount_value: row.discount_value ?? null,
    ...((extra ?? {}) as Record<string, string | null>),
  };
}

/**
 * The lines the generator expects.
 *
 * Every optional field is forwarded WITH ITS ABSENCE PRESERVED: `undefined` means "this column is
 * not in this deployment", and `null` means "the column exists and this line has no value". The
 * generator branches on exactly that difference, so collapsing the two — writing `?? null` over
 * an absent column — would tell it a column exists that does not.
 */
export function ublLinesFrom(rows: readonly UblLineRow[]): UblInvoiceLine[] {
  return rows.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    btw_rate: l.btw_rate,
    line_total: l.line_total,
    // [UNIT] Absent → the generator falls back to C62, exactly as before the column existed.
    unit: l.unit ?? null,
    // [E-FACTUUR] The exemption flag. Absent → the behaviour from before the flag.
    ...(l.vat_treatment !== undefined ? { vat_treatment: l.vat_treatment } : {}),
    // [REGEL-KORTING] The line's own discount. It changes NO amount in the file — line_total is
    // already net — it explains the difference: without it the export has to state a unit price
    // that reproduces the reduced amount, and then the file carries a price nobody agreed to.
    ...(l.discount_type !== undefined ? { discount_type: l.discount_type } : {}),
    ...(l.discount_value !== undefined ? { discount_value: l.discount_value } : {}),
  }));
}

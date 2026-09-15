// src/lib/offerte-send.ts
// [OFFERTE-VERSTUREN] May this document be e-mailed to the customer AS A QUOTE? Pure, no I/O.
// Run: npx tsx --test src/lib/offerte-send.test.ts
//
// WHY THIS EXISTS
// The app could not send a quote. Every path through /api/invoice/send either CONVERTS the quote
// into an official factuur (isConversion → a number from the gapless series, Art. 35, no way back),
// converts it without sending, or re-delivers an invoice that already has a number. So the owner's
// only way to get a quote in front of a customer was to turn it into an invoice first — which is
// the opposite of what a quote is for.
//
// WHY A SEPARATE DOOR AND NOT A FLAG ON THE SEND ROUTE
// That route exists to mint numbers: it holds the atomic allocator, the Art. 35 guards, the
// conversion, the CAS on issuance. A boolean threading through it would put "never mint a number"
// one wrong branch away from "mint one", on the one action in this app that cannot be undone.
// A door that CANNOT mint is a stronger guarantee than a door that decides not to.

/** The two spellings invoices.invoice_type accepts for a quote (database.sql CHECK). */
const QUOTE_TYPES = new Set(["pro_forma", "offerte"]);

export interface OfferteSendInput {
  invoiceType: string | null | undefined;
  /** A quote that carries one is not a quote any more — it was converted. */
  invoiceNumber: string | null | undefined;
  clientEmail: string | null | undefined;
  /** Sending an empty document to a customer is worse than not sending. */
  lineCount: number;
}

export type OfferteSendCheck =
  | { ok: true }
  | { ok: false; code: OfferteRefusal; error: string };

export type OfferteRefusal =
  | "not_a_quote"
  | "already_invoice"
  | "no_client_email"
  | "no_lines";

/**
 * Decide whether this document may go out as a quote.
 *
 * Every refusal has its OWN code and its own Dutch sentence: the four reasons need four different
 * actions from the owner, and "versturen mislukt" would leave them guessing which one they hit.
 */
export function checkOfferteSendable(input: OfferteSendInput): OfferteSendCheck {
  const type = (input.invoiceType ?? "").trim();
  if (!QUOTE_TYPES.has(type)) {
    return {
      ok: false,
      code: "not_a_quote",
      error: "Dit is geen offerte. Een factuur verstuur je via de factuurknop.",
    };
  }
  // A number means the send route already converted it. Mailing it as a quote afterwards would put
  // a document in the customer's inbox that says "vrijblijvend" while the books hold an issued,
  // numbered invoice for the same work.
  if ((input.invoiceNumber ?? "").trim().length > 0) {
    return {
      ok: false,
      code: "already_invoice",
      error: "Deze offerte is al omgezet naar een factuur en kan niet meer als offerte worden verstuurd.",
    };
  }
  if (!isPlausibleEmail(input.clientEmail)) {
    return {
      ok: false,
      code: "no_client_email",
      error: "Vul eerst een e-mailadres van de klant in — daar sturen we de offerte naartoe.",
    };
  }
  if (!Number.isFinite(input.lineCount) || input.lineCount < 1) {
    return {
      ok: false,
      code: "no_lines",
      error: "Deze offerte heeft nog geen regels. Vul ze in voordat je hem verstuurt.",
    };
  }
  return { ok: true };
}

/**
 * Enough of an address to be worth attempting.
 *
 * Deliberately loose: the mail provider is the real judge, and a stricter pattern here would refuse
 * valid addresses (plus-tags, long TLDs, IDN) that Resend delivers without complaint. What this
 * catches is the empty field and the obvious typo — the cases where attempting a send would only
 * produce a bounce the owner has to interpret.
 */
function isPlausibleEmail(value: string | null | undefined): boolean {
  const s = (value ?? "").trim();
  if (s.length < 5 || /\s/.test(s)) return false;
  const at = s.indexOf("@");
  if (at < 1 || at !== s.lastIndexOf("@")) return false;
  const domain = s.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

/**
 * The subject line for the e-mail.
 *
 * The company name, because a quote arrives at someone who asked several suppliers the same
 * question and needs to see whose it is before opening anything.
 */
export function offerteSubject(senderName: string): string {
  const name = (senderName ?? "").trim();
  return name ? `Offerte van ${name}` : "Offerte";
}

/** What to call the attachment. Not "factuur-…", which is what it is not. */
export function offerteFileName(clientName: string | null | undefined, dateIso: string | null | undefined): string {
  const safe = (clientName ?? "").trim().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const date = (dateIso ?? "").trim().slice(0, 10);
  return ["offerte", safe || null, date || null].filter(Boolean).join("-") + ".pdf";
}

// ─── [OFFERTE-MAILTEKST] The body of the quote e-mail, as a pure function ──────────────────────
//
// It was built inline inside sendOfferteToClient, which does I/O, so the only way to see what a
// customer would read was to intercept the network. Three defects reached a customer that way:
// the mail asked for a yes and carried no reply-to; the heading printed "Offerte van" with nothing
// after it; and the validity line vanished silently when no date was set.
//
// The subject and the file name already live here. This is the third thing the customer reads, so
// it belongs beside them — and now every one of them can be asserted without sending anything.

import { escapeHtml } from "./escape-html";
import { formatDateNL } from "./format-nl";
// [MERK-VOET] The sign-off, from the one place that defines it.
import { merkVoet } from "./mail-merk";

export interface OfferteEmailFields {
  clientName: string;
  senderName: string;
  /** Where the yes should go. Empty when the owner has no address on file at all. */
  senderEmail?: string | null;
  totalInc: number;
  /** ISO date. A quote need not carry one — but the mail must then SAY it does not. */
  validUntil?: string | null;
  offerteDate?: string | null;
  /**
   * [OFFERTE-AKKOORD] De link waarop de klant ja of nee kan zeggen.
   *
   * Optioneel, en dat is geen luiheid: op een installatie waar offerte_akkoord.sql nog open staat
   * bestaat het token niet, en dan hoort deze mail exact de mail te zijn die hij altijd was — met
   * de zin "antwoord op deze mail". Een knop die naar een pagina wijst die niet bestaat is erger
   * dan geen knop.
   */
  akkoordUrl?: string | null;
}

/**
 * The HTML the customer opens.
 *
 * Every field degrades to a sentence that is still true rather than to a blank: no amount means no
 * amount row (never "€ 0,00" beside a thousand-euro quote), no reply address means "laat het ons
 * dan weten" instead of a dangling mailto, and no company name falls back through offerteSubject.
 */
export function offerteEmailHtml(f: OfferteEmailFields): string {
  // Geen bedrag is beter dan een verkeerd bedrag: is het totaal onbekend, dan zwijgt deze regel en
  // staat het echte bedrag nog steeds in de PDF.
  const heeftBedrag = Number.isFinite(f.totalInc) && f.totalInc !== 0;
  const bedrag = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(f.totalInc);
  const antwoordAdres = (f.senderEmail ?? "").trim();

  // [OFFERTE-KOP] Letterlijk het onderwerp, zodat kop en onderwerp niet uit elkaar kunnen lopen.
  // Er stond `Offerte van ${senderName}` zonder wacht: bij een leeg bedrijfsnaamveld las de klant
  // "Offerte van" met niets erachter, terwijl het onderwerp keurig terugviel op "Offerte".
  const kopregel = offerteSubject(f.senderName);

  const datumRegel = f.offerteDate
    ? `<p style="margin:4px 0; color:#202124;"><strong>Datum:</strong> ${formatDateNL(f.offerteDate)}</p>`
    : "";

  // [OFFERTE-GELDIGHEID] Deze regel staat er ALTIJD. Hij verdween stilzwijgend als er geen datum
  // was, en dan las de klant een aanbod zonder einde — daar kan hij een jaar later mee terugkomen,
  // en dan staat de ondernemer tussen weigeren en werken voor een oude prijs. De PDF zegt sinds
  // [OFFERTE-IS-GEEN-PROFORMA] wat er aan de hand is; de mail is wat de klant als eerste opent.
  const geldigRegel = `<p style="margin:4px 0; color:#202124;"><strong>Geldig tot:</strong> ${
    f.validUntil ? formatDateNL(f.validUntil) : "niet afgesproken"
  }</p>`;

  // [OFFERTE-AKKOORD] Eén knop, en alleen als er een link IS. Hij belooft niets meer dan wat er
  // gebeurt: je laat weten wat je ervan vindt. Geen "bestel", geen "betaal" — er komt geen factuur
  // uit deze knop, en de pagina erachter zegt dat ook.
  const akkoordLink = (f.akkoordUrl ?? "").trim();
  const akkoordBlok = akkoordLink
    ? `<p style="margin:24px 0;">
          <a href="${escapeHtml(akkoordLink)}" style="display:inline-block; background:#1a73e8; color:#ffffff; text-decoration:none; padding:13px 22px; border-radius:10px; font-weight:600;">Bekijk en reageer op de offerte</a>
        </p>`
    : "";

  return `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">${escapeHtml(kopregel)}</h2>
        <p style="color: #555;">Beste ${escapeHtml(f.clientName)},</p>
        <p style="color: #555;">Hierbij onze offerte. Je vindt hem als PDF in de bijlage.</p>
        <div style="background:#f8f9fa; border-radius:12px; padding:16px; margin:20px 0; border-left: 3px solid #1a73e8;">
          ${datumRegel}
          ${geldigRegel}
          ${heeftBedrag ? `<p style="margin:4px 0; color:#202124;"><strong>Totaal incl. btw:</strong> ${bedrag}</p>` : ""}
        </div>
        ${akkoordBlok}
        <p style="color: #555;">
          Deze offerte is <strong>vrijblijvend</strong>: er hoeft nog niets betaald te worden en er
          is nog geen factuur. Ga je akkoord, ${akkoordLink
            ? "gebruik dan de knop hierboven"
            : antwoordAdres
              ? `antwoord dan op deze mail of stuur een bericht naar <a href="mailto:${escapeHtml(antwoordAdres)}" style="color:#1a73e8;">${escapeHtml(antwoordAdres)}</a>`
              : "laat het ons dan weten"} — dan sturen we de factuur.
        </p>
        ${merkVoet()}
      </div>
    `;
}

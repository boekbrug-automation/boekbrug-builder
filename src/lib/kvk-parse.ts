// src/lib/kvk-parse.ts
// [KVK-OPTIONEEL] Read a KvK Basisprofiel — and work perfectly when there is no key at all.
// Pure: no I/O. Run: npx tsx --test src/lib/kvk-parse.test.ts
//
// ── THE ONE PAID REGISTER, AND WHAT THAT CHANGES ────────────────────────────────────────────
//
// VIES and PDOK are free and keyless, so they are on for everyone from the first day. KvK is not:
// the Zoeken API is free, but the Basisprofiel that actually returns a company's name and address
// costs a subscription plus a fee per request. That is a fair price for what it does and exactly
// the wrong thing to make a signup depend on — an owner whose onboarding stalls because an API key
// was never installed is an owner who leaves, and he never learns why.
//
// So the whole design of this file is "absent is a normal state". No key means unknown("KvK", …),
// the field stays typeable, and nothing anywhere waits for an answer. The moment a key exists it
// starts answering, and not one screen has to change.
//
// ── AND THE SAME PARANOIA AS THE OTHERS ─────────────────────────────────────────────────────
//
// The response shape could not be verified from here (developers.kvk.nl is unreachable from this
// environment), so every field is checked and anything unexpected is null. A wrong company name
// would be printed on an invoice under our name.

/** What a Basisprofiel gives that this app has any use for. */
export interface KvkCompany {
  /** Eight digits, as registered. */
  kvkNumber: string;
  /** The statutory name. Empty when the profile does not carry one. */
  name: string;
  /** The trade name, when it differs — a shop is known by this and invoiced under the other. */
  tradeName: string;
  /** One line, as KvK formats it. Empty when the profile has no visiting address. */
  address: string;
  city: string;
}

export type KvkReading =
  | { reading: "found"; company: KvkCompany }
  | { reading: "unusable"; why: string };

// There is deliberately no "unknown-number" reading. The first version had one, and a test found
// what it did: an unrecognisable body — an empty array, a profile with the number as a JSON
// number instead of a string — fell into it and came out as "de KvK kent dit nummer niet". That
// is a VERDICT about someone's company, produced by not understanding the answer. The register
// says "not found" with HTTP 404, which the route handles; everything else here is unusable.

function text(value: unknown): string {
  // A number is accepted for the fields that can legitimately arrive as one — a kvk-nummer and a
  // huisnummer are digits, and an API returning 12345678 rather than "12345678" is not an error.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value.trim() : "";
}

/** Exactly eight digits. Anything else is not a kvk-nummer and is not worth a paid request. */
export function isKvkShaped(raw: string | null | undefined): boolean {
  return typeof raw === "string" && /^\d{8}$/.test(raw.replace(/\s/g, ""));
}

export function normaliseKvkNumber(raw: string | null | undefined): string {
  const v = typeof raw === "string" ? raw.replace(/\s/g, "") : "";
  return /^\d{8}$/.test(v) ? v : "";
}

/**
 * A Basisprofiel response → a reading.
 *
 * The address lives in an `adressen` array with a `type` per entry; the visiting address is the
 * one an invoice wants. A postal address is not the same thing and is not a substitute: mail sent
 * to a postbus is fine, an invoice line that says "Postbus 1" where the law wants an address is
 * a different matter.
 */
export function parseKvkProfile(json: unknown, requested: string): KvkReading {
  const asked = normaliseKvkNumber(requested);
  if (asked === "") return { reading: "unusable", why: "Dat is geen kvk-nummer" };

  // An array is an object in JavaScript and is not a profile. Without this, an empty list came
  // back as a statement about the company.
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { reading: "unusable", why: "Het antwoord van de KvK was niet leesbaar" };
  }
  const body = json as Record<string, unknown>;

  const returned = normaliseKvkNumber(text(body.kvkNummer));
  if (returned === "") {
    return { reading: "unusable", why: "Het antwoord van de KvK bevatte geen kvk-nummer" };
  }
  if (returned !== asked) {
    return { reading: "unusable", why: "De KvK antwoordde over een ander nummer" };
  }

  const name = text(body.statutaireNaam) || text(body.naam);
  const tradeName = text(body.handelsnaam);

  let address = "";
  let city = "";
  const adressen = body.adressen;
  if (Array.isArray(adressen)) {
    const bezoek = adressen.find(
      (a) => typeof a === "object" && a !== null && /bezoek/i.test(text((a as Record<string, unknown>).type)),
    ) as Record<string, unknown> | undefined;
    if (bezoek) {
      const straat = text(bezoek.straatnaam);
      const nummer = text(bezoek.huisnummer) || String(bezoek.huisnummer ?? "").trim();
      const toevoeging = text(bezoek.huisnummerToevoeging);
      address = [straat, nummer, toevoeging].filter((p) => p !== "" && p !== "undefined").join(" ").trim();
      city = text(bezoek.plaats) || text(bezoek.woonplaatsNaam);
    }
  }

  // A profile with no name at all is not a profile we can show. Everything else may be partial:
  // a company without a visiting address exists, and printing nothing is better than guessing.
  if (name === "" && tradeName === "") {
    return { reading: "unusable", why: "Het antwoord van de KvK bevatte geen naam" };
  }

  return { reading: "found", company: { kvkNumber: asked, name, tradeName, address, city } };
}

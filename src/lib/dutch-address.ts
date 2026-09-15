// src/lib/dutch-address.ts
// [ADRES-ECHT] A Dutch address, as the register writes it — and what to do when it disagrees.
// Pure: no I/O. Run: npx tsx --test src/lib/dutch-address.test.ts
//
// ── WHY AN ADDRESS IS A MONEY FIELD HERE ────────────────────────────────────────────────────
//
// It is printed on the invoice, and a Dutch invoice must carry the full name and address of both
// parties to be a valid invoice. So a typo is not a cosmetic defect: it is a document a customer's
// accountant can refuse, and a btw deduction that gets questioned. PDOK/BAG can confirm that a
// postcode and house number exist and say what the street and town are actually called — free, no
// key, straight from the Kadaster.
//
// ── THE RULE THAT DECIDES THE WHOLE DESIGN ──────────────────────────────────────────────────
//
// The register never silently overwrites what the owner typed. It PROPOSES, and the owner accepts.
// Three reasons, in order of how expensive they are to learn the hard way:
//
//   1. The register is right about the street and wrong about the recipient. "t.a.v. de heer De
//      Vries, Gebouw C" is not in the BAG and must survive a lookup.
//   2. A house number that exists is not the house number that was meant. 42 and 42-A both exist
//      on the same street, and the register cannot tell which one the customer is.
//   3. An owner who watches a field change under his hands stops trusting the form, and starts
//      checking every other field the app filled in for him.
//
// So `compareToRegister` returns a DIFFERENCE, and the caller shows it. Nothing here writes.

/** An address as a person typed it, or as the register holds it. */
export interface DutchAddress {
  /** "1234AB" — four digits and two letters, no space, upper case. */
  postcode: string;
  /** House number as a number. 0 means "not given". */
  houseNumber: number;
  /** "A", "bis", "2hoog" — everything after the number that is not the number. */
  addition: string;
  street: string;
  city: string;
}

/** What the owner typed, before anything is known about it. */
export interface AddressInput {
  postcode?: string | null;
  houseNumber?: string | number | null;
  addition?: string | null;
  street?: string | null;
  city?: string | null;
}

/**
 * "1234 ab" → "1234AB". Returns "" for anything that is not a Dutch postcode.
 *
 * The letter pair is upper-cased and the space dropped, because that is how it is registered; what
 * a person types is a rendering of it. Refusing "1234 ab" would be refusing the way half the
 * country writes their own address.
 */
export function normalisePostcode(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  const value = raw.replace(/\s/g, "").toUpperCase();
  return /^\d{4}[A-Z]{2}$/.test(value) ? value : "";
}

/**
 * Split "42-A", "42 bis", "42A" into the number and what follows.
 *
 * The number is what the register indexes on and the addition is a separate field there, so a
 * lookup with "42A" in the number field finds nothing at all. Leading zeroes go: house number 042
 * is house number 42, and the register agrees.
 */
export function splitHouseNumber(raw: string | number | null | undefined): { number: number; addition: string } {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? { number: Math.trunc(raw), addition: "" } : { number: 0, addition: "" };
  }
  if (typeof raw !== "string") return { number: 0, addition: "" };

  const match = raw.trim().match(/^(\d{1,5})\s*[-/ ]?\s*(.*)$/);
  if (!match) return { number: 0, addition: "" };

  const number = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(number) || number <= 0) return { number: 0, addition: "" };
  return { number, addition: match[2]!.trim() };
}

/** Everything trimmed, the postcode and house number in register form. */
export function normaliseAddress(input: AddressInput): DutchAddress {
  const text = (v: string | null | undefined) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
  // An addition typed INTO the number field ("42A") belongs in the addition, but an addition the
  // owner typed separately wins — he was answering the question the form asked.
  const split = splitHouseNumber(input.houseNumber ?? null);
  const separate = text(input.addition);
  return {
    postcode: normalisePostcode(input.postcode),
    houseNumber: split.number,
    addition: separate !== "" ? separate : split.addition,
    street: text(input.street),
    city: text(input.city),
  };
}

/** Enough to ask the register: a postcode and a house number. Nothing else identifies an address. */
export function canBeLookedUp(address: DutchAddress): boolean {
  return address.postcode !== "" && address.houseNumber > 0;
}

/** One field the register spells differently. */
export interface AddressDifference {
  field: "street" | "city" | "addition";
  typed: string;
  register: string;
}

/**
 * Where what was typed and what the register holds disagree — case and spacing ignored, because
 * "TILBURGSEWEG" and "Tilburgseweg" are the same street and flagging that trains people to click
 * past the warnings that matter.
 *
 * An empty typed field is not a difference: the owner did not claim anything, so the register is
 * filling a gap rather than contradicting him. An empty REGISTER field is not a difference either
 * — the register not knowing something is not the owner being wrong.
 */
export function compareToRegister(typed: DutchAddress, register: DutchAddress): AddressDifference[] {
  const same = (a: string, b: string) =>
    a.toLocaleLowerCase("nl").replace(/\s+/g, "") === b.toLocaleLowerCase("nl").replace(/\s+/g, "");

  const out: AddressDifference[] = [];
  for (const field of ["street", "city", "addition"] as const) {
    const mine = typed[field];
    const theirs = register[field];
    if (mine === "" || theirs === "") continue;
    if (!same(mine, theirs)) out.push({ field, typed: mine, register: theirs });
  }
  return out;
}

/**
 * The address to print, given a confirmation the owner accepted.
 *
 * Street and city come from the register — those are its job and it is authoritative. The
 * ADDITION keeps what the owner typed whenever he typed one: "Gebouw C" and "t.a.v." live there,
 * the BAG does not hold them, and losing them delivers the invoice to the wrong desk.
 */
export function mergeAccepted(typed: DutchAddress, register: DutchAddress): DutchAddress {
  return {
    postcode: register.postcode !== "" ? register.postcode : typed.postcode,
    houseNumber: register.houseNumber > 0 ? register.houseNumber : typed.houseNumber,
    addition: typed.addition !== "" ? typed.addition : register.addition,
    street: register.street !== "" ? register.street : typed.street,
    city: register.city !== "" ? register.city : typed.city,
  };
}

/** One line, the way it goes on an invoice: "Tilburgseweg 42-A". */
export function streetLine(address: DutchAddress): string {
  if (address.street === "" && address.houseNumber === 0) return "";
  const number = address.houseNumber > 0 ? String(address.houseNumber) : "";
  const addition = address.addition !== "" ? `-${address.addition}` : "";
  return `${address.street} ${number}${addition}`.trim();
}

/** "1234AB Tilburg", the second line of a Dutch address. */
export function postcodeLine(address: DutchAddress): string {
  const postcode = address.postcode !== "" ? `${address.postcode.slice(0, 4)} ${address.postcode.slice(4)}` : "";
  return `${postcode} ${address.city}`.trim();
}

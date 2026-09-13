// [GEHEUGEN] Pure node test — run: npx tsx --test src/lib/match-memory.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { buildMatchMemory, remembersParty, remembersPartyBy, partyKey, EMPTY_MATCH_MEMORY } from "./match-memory";

const IBAN = "NL91ABNA0417164300";
const OTHER_IBAN = "NL25RABO0133368882";

test("[GEHEUGEN] a counterpart the owner confirmed once is identity the next time", () => {
  // The case it was built for: the bank writes a name that isStrongNameIdentity rejects on
  // purpose — one shared token is the asymmetric surname shape — so this supplier is identified
  // by hand every single month.
  const memory = buildMatchMemory([
    { counterpartName: "SUMUP *JANSEN", counterpartIban: null, partyName: "Jansen Bouw B.V." },
  ]);
  assert.equal(remembersParty(memory, { counterpartName: "SUMUP *JANSEN" }, "Jansen Bouw B.V."), true);
  // …and it says nothing about anyone else.
  assert.equal(remembersParty(memory, { counterpartName: "SUMUP *JANSEN" }, "De Vries Transport"), false);
  assert.equal(remembersParty(memory, { counterpartName: "MOLLIE *WEBSHOP" }, "Jansen Bouw B.V."), false);
});

test("[GEHEUGEN] the account is remembered too, and asked first", () => {
  const memory = buildMatchMemory([
    { counterpartName: "ONLEESBAAR", counterpartIban: IBAN, partyName: "Enka Horeca B.V." },
  ]);
  // A supplier whose name the bank rewrites keeps their account.
  assert.equal(remembersParty(memory, { counterpartName: "IETS ANDERS", counterpartIban: IBAN }, "Enka Horeca B.V."), true);
  // A different account is a different counterpart until it has been confirmed as well.
  assert.equal(remembersParty(memory, { counterpartName: "IETS ANDERS", counterpartIban: OTHER_IBAN }, "Enka Horeca B.V."), false);
});

test("[GEHEUGEN] the same party spelled two ways is one memory", () => {
  // OCR and bank statements disagree about legal suffixes constantly. The key strips them, so a
  // confirmation made on one spelling answers for the other.
  const memory = buildMatchMemory([
    { counterpartName: "ENKA HORECA BV", counterpartIban: null, partyName: "Enka Horeca B.V." },
  ]);
  assert.equal(remembersParty(memory, { counterpartName: "Enka Horeca B.V." }, "ENKA HORECA BV"), true);
  assert.equal(partyKey("Enka Horeca B.V."), partyKey("ENKA HORECA BV"));
});

test("[GEHEUGEN] a counterpart that settled TWO parties is a channel, not an identity", () => {
  // The rule that makes a single mistaken confirmation self-limiting: the moment a second party
  // appears under the same counterpart, the memory stops speaking about either.
  const memory = buildMatchMemory([
    { counterpartName: "VERZAMELREKENING", counterpartIban: IBAN, partyName: "Jansen Bouw B.V." },
    { counterpartName: "VERZAMELREKENING", counterpartIban: IBAN, partyName: "De Vries Transport" },
  ]);
  assert.equal(remembersParty(memory, { counterpartName: "VERZAMELREKENING" }, "Jansen Bouw B.V."), false);
  assert.equal(remembersParty(memory, { counterpartName: "VERZAMELREKENING", counterpartIban: IBAN }, "De Vries Transport"), false);
});

test("[GEHEUGEN] confirming the same pair many times is still one memory", () => {
  const memory = buildMatchMemory(
    Array.from({ length: 12 }, () => ({ counterpartName: "KPN", counterpartIban: IBAN, partyName: "KPN B.V." })),
  );
  assert.equal(remembersParty(memory, { counterpartName: "KPN", counterpartIban: IBAN }, "KPN B.V."), true);
  assert.equal(memory.byName.get("kpn")?.size, 1, "a repeat is not a second party");
});

test("[GEHEUGEN] nothing to remember is answered as nothing, never as a guess", () => {
  assert.equal(remembersParty(EMPTY_MATCH_MEMORY, { counterpartName: "KPN" }, "KPN B.V."), false);
  assert.equal(remembersParty(null, { counterpartName: "KPN" }, "KPN B.V."), false);
  // A link with no party name teaches nothing — and must not create an entry that then blocks a
  // real one by making the counterpart look like a two-party channel.
  const memory = buildMatchMemory([
    { counterpartName: "KPN", counterpartIban: IBAN, partyName: null },
    { counterpartName: "KPN", counterpartIban: IBAN, partyName: "KPN B.V." },
  ]);
  assert.equal(remembersParty(memory, { counterpartName: "KPN" }, "KPN B.V."), true);
});

test("[GEHEUGEN] a name that is only noise remembers nothing", () => {
  // counterpartKey drops legal suffixes and processor tags; a name made only of those has no key,
  // and a memory keyed on "" would answer for every anonymous line in the statement.
  const memory = buildMatchMemory([
    { counterpartName: "B.V.", counterpartIban: null, partyName: "Jansen Bouw B.V." },
  ]);
  assert.equal(memory.byName.size, 0);
  assert.equal(remembersParty(memory, { counterpartName: "N.V." }, "Jansen Bouw B.V."), false);
});

test("[GEHEUGEN] an unknown party is not remembered by a known counterpart", () => {
  const memory = buildMatchMemory([
    { counterpartName: "KPN", counterpartIban: IBAN, partyName: "KPN B.V." },
  ]);
  assert.equal(remembersParty(memory, { counterpartName: "KPN", counterpartIban: IBAN }, null), false);
  assert.equal(remembersParty(memory, { counterpartName: "KPN", counterpartIban: IBAN }, "   "), false);
});

// ─── [INCASSO-IDENTITEIT] The two handles a collection carries ───────────────────────────────────

const MANDATE = "VIT-2019-88213";
const INCASSANT = "NL32ZZZ411951220000";
/** What an ING statement actually gives for a monthly incasso: a scheme, not a name, and the
 *  collector's clearing account rather than the supplier's own. */
const SCHEME_LINE = {
  counterpartName: "SEPA INCASSO ALGEMEEN DOORLOPEND",
  counterpartIban: "NL08INGB0000000555",
  mandateId: MANDATE,
  creditorId: INCASSANT,
};

test("[INCASSO-IDENTITEIT] the machtigingskenmerk identifies a collector the name and the account cannot", () => {
  const memory = buildMatchMemory([{ ...SCHEME_LINE, partyName: "Vitens N.V." }]);
  // The handle that carried it is named, because the card says why.
  assert.equal(remembersPartyBy(memory, SCHEME_LINE, "Vitens N.V."), "mandate");
  // Padding and case are the bank's, not the mandate's.
  assert.equal(remembersPartyBy(memory, { mandateId: `  ${MANDATE.toLowerCase()} ` }, "Vitens N.V."), "mandate");
  // The mandate alone is enough — this is the whole point: no name, no account.
  assert.equal(remembersParty(memory, { mandateId: MANDATE }, "Vitens N.V."), true);
  // …and it says nothing about anyone else.
  assert.equal(remembersParty(memory, { mandateId: MANDATE }, "Evides N.V."), false);
  assert.equal(remembersParty(memory, { mandateId: "SOME-OTHER-MANDATE" }, "Vitens N.V."), false);
});

test("[INCASSO-IDENTITEIT] the incassant-ID answers when the mandate reference is absent", () => {
  // ABN writes the incassant-ID into the description and gives no machtigingskenmerk at all.
  const memory = buildMatchMemory([{ ...SCHEME_LINE, partyName: "Vitens N.V." }]);
  assert.equal(remembersPartyBy(memory, { creditorId: INCASSANT }, "Vitens N.V."), "creditor-id");
  // Strongest first: with BOTH present the mandate is what is reported, because it is one contract
  // between two parties while an incassant-ID may serve several trade names of one collector.
  assert.equal(remembersPartyBy(memory, SCHEME_LINE, "Vitens N.V."), "mandate");
});

test("[INCASSO-IDENTITEIT] an incassant-ID that has settled two parties is a channel, not an identity", () => {
  // The exact weakness the incassant-ID has and the mandate does not: one collector, two trade
  // names. The one-party rule is what makes remembering it safe — it stops speaking.
  const memory = buildMatchMemory([
    { counterpartName: null, counterpartIban: null, creditorId: INCASSANT, partyName: "Vitens N.V." },
    { counterpartName: null, counterpartIban: null, creditorId: INCASSANT, partyName: "Vitens Zakelijk" },
  ]);
  assert.equal(remembersParty(memory, { creditorId: INCASSANT }, "Vitens N.V."), false);
  assert.equal(remembersParty(memory, { creditorId: INCASSANT }, "Vitens Zakelijk"), false);
});

test("[INCASSO-IDENTITEIT] a line with no direct-debit markers is answered exactly as before", () => {
  // The two new indexes must be additive: an ordinary transfer reaches the name and IBAN handles
  // unchanged, and an empty marker teaches nothing rather than folding an empty key.
  const memory = buildMatchMemory([
    { counterpartName: "KPN", counterpartIban: IBAN, mandateId: "", creditorId: null, partyName: "KPN B.V." },
    { counterpartName: "OTHER", counterpartIban: OTHER_IBAN, mandateId: "  ", creditorId: "", partyName: "Andere B.V." },
  ]);
  assert.equal(remembersPartyBy(memory, { counterpartIban: IBAN }, "KPN B.V."), "iban");
  assert.equal(remembersPartyBy(memory, { counterpartName: "KPN" }, "KPN B.V."), "name");
  // Two links with a blank mandate did NOT fold into one shared key that now names two parties.
  assert.equal(memory.byMandate.size, 0);
  assert.equal(memory.byCreditor.size, 0);
});

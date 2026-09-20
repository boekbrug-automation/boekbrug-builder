// [FROM-HOME] Pure node test — run: npx tsx --test src/lib/navigation.test.ts
// The canonical parents, for the doors the home opens with a marker. Pure, no I/O.
import { test } from "node:test";
import assert from "node:assert/strict";

import { getParentPath, getHomePath } from "./navigation";
import { attentionHref } from "./home-links";

/** The parent of a full href, the way SubPageHeader resolves it: pathname plus its search params. */
const parentOf = (href: string, role: "zzper" | "accountant" | "medewerker" = "zzper") => {
  const u = new URL(href, "https://boekbrug.nl");
  return getParentPath(u.pathname, role, u.searchParams);
};

test("[FROM-HOME] Team returns to the home when entered from it, and to Instellingen otherwise", () => {
  assert.equal(parentOf("/dashboard/settings/team"), "/dashboard/settings");
  assert.equal(parentOf("/dashboard/settings/team?from=home"), "/dashboard");
  // Only the marker counts — anything else keeps the settings parent.
  assert.equal(parentOf("/dashboard/settings/team?from=elsewhere"), "/dashboard/settings");
});

test("[FROM-HOME] an incoming attention row lands on the manage screen, and its Terug comes home", () => {
  const href = attentionHref({ id: "inv-1", direction: "incoming" });
  assert.equal(href, "/dashboard/incoming/manage?focus=inv-1&from=home");
  assert.equal(parentOf(href), "/dashboard");
  // An unmarked visit keeps the documented default: the verify queue.
  assert.equal(parentOf("/dashboard/incoming/manage?focus=inv-1"), "/dashboard/incoming");
});

test("[FROM-HOME] an outgoing attention row opens the invoice, whose parent is the invoice list", () => {
  const href = attentionHref({ id: "inv-2", direction: "outgoing" });
  assert.equal(href, "/dashboard/invoice/inv-2");
  assert.equal(parentOf(href), "/dashboard/facturen");
});

test("[FROM-HOME] an id is encoded, so a stray character cannot rewrite the query", () => {
  assert.equal(attentionHref({ id: "a&from=x", direction: "incoming" }), "/dashboard/incoming/manage?focus=a%26from%3Dx&from=home");
});

test("[FROM-HOME] the marker resolves to each role's own home, never to a door that bounces", () => {
  assert.equal(parentOf("/dashboard/settings/team?from=home", "accountant"), getHomePath("accountant"));
  assert.equal(parentOf("/dashboard/incoming/manage?from=home", "medewerker"), "/dashboard/verkoop");
});

// ── [VRAAG-DEUR] the questions screen's door to an invoice, and the way back ─────────────────────
import { invoiceQuestionHref } from "./vragen";
const OWNER = "11111111-1111-4111-8111-111111111111";

test("[VRAAG-DEUR] an incoming invoice question lands on Inkomend, focused, and its Terug returns to the questions", () => {
  const href = invoiceQuestionHref({ id: "inv-in", direction: "incoming", receiver_id: OWNER, sender_id: null }, OWNER) as string;
  assert.equal(href, "/dashboard/incoming/manage?focus=inv-in&from=vragen");
  assert.equal(parentOf(href), "/dashboard/vragen");
});

test("[VRAAG-DEUR] an outgoing invoice question opens the invoice itself, and its Terug returns to the questions", () => {
  const href = invoiceQuestionHref({ id: "inv-out", direction: "outgoing", sender_id: OWNER, receiver_id: null }, OWNER) as string;
  assert.equal(href, "/dashboard/invoice/inv-out?from=vragen");
  assert.equal(parentOf(href), "/dashboard/vragen");
  // Unmarked, the invoice page still returns to the invoice list — nothing that relied on it changed.
  assert.equal(parentOf("/dashboard/invoice/inv-out"), "/dashboard/facturen");
  // …and the accountant's marker still wins its own way home.
  assert.equal(parentOf("/dashboard/invoice/inv-out?from=client&clientId=k1&q=2&year=2026", "accountant"), "/dashboard/clients/k1/kwartaal?q=2&year=2026");
});

test("[VRAAG-DEUR] the marker is exact: a different value falls back to the documented default", () => {
  assert.equal(parentOf("/dashboard/incoming/manage?focus=x&from=vragenlijst"), "/dashboard/incoming");
  assert.equal(parentOf("/dashboard/invoice/x?from=vragenlijst"), "/dashboard/facturen");
});

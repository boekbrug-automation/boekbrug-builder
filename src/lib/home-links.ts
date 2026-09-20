// src/lib/home-links.ts
// [FROM-HOME] Where a tap on the home lands, with the way back written into the link — pure, no I/O.
// Run: npx tsx --test src/lib/navigation.test.ts
//
// Every "Terug" in the app resolves a canonical PARENT (src/lib/navigation.ts), never browser
// history. A screen with more than one door therefore has to be told which door it came through,
// and the marker for that is ?from=home — the manage screen's parent rule already reads it. Two
// doors on the home did not carry it: the attention rows on the truth panel (Terug landed on the
// verify queue, a screen the visitor never saw) and the Team card (Terug landed on Instellingen,
// ditto). The "Te betalen" card two lines above the rows did carry it, which is how the gap hid.

/** The marker a parent rule reads to send the visitor back to the home they came from. */
export const FROM_HOME = "from=home";

/**
 * The resolve surface for one item that needs action, as the truth panel lists it.
 * Incoming → the manage screen (pay / mark paid), focused on the row and marked as entered from
 * the home; outgoing → the invoice itself, whose parent is the invoice list.
 */
export function attentionHref(item: { id: string; direction: "incoming" | "outgoing" }): string {
  return item.direction === "incoming"
    ? `/dashboard/incoming/manage?focus=${encodeURIComponent(item.id)}&${FROM_HOME}`
    : `/dashboard/invoice/${encodeURIComponent(item.id)}`;
}

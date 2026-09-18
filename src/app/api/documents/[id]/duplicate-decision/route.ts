// src/app/api/documents/[id]/duplicate-decision/route.ts
// [ONTVANGEN-BESLUIT] The owner's answer to "deze factuur lijkt al te bestaan".
//
// ── WHY THIS DOOR EXISTS AT ALL ──────────────────────────────────────────────────────────────
//
// Under the synchronous road, a semantic duplicate was a 409 the browser turned into a modal, and
// "toch toevoegen" was a SECOND upload of the same file with force=true. After receive-first that
// 409 never reaches a browser: /api/intake has already answered "Ontvangen" and gone home, and the
// reader runs minutes later with nobody watching.
//
// So the question became durable — the document waits in `wacht_op_besluit` — and it needs a door
// to be answered through. Without one, a document that asks it waits forever, which is the one
// outcome durable state must never produce.
//
// ── THE CLIENT SENDS A CHOICE, AND NOTHING ELSE ──────────────────────────────────────────────
//
// Not the candidate invoice id. The screen that asks this question may have been rendered
// yesterday, in a tab that is still open, by somebody who has since been given a different role —
// and an id in a request body is a CLAIM about which invoice this duplicates. The server reads the
// candidate from the row it wrote itself, and proves both sides belong to the caller.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { applyDuplicateDecision, isDuplicateDecision } from "@/lib/duplicate-decision";
import { kickStoredDocument } from "@/lib/intake-kick";
import { logAuditAction, getClientIP } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limited = await checkRateLimit({
    userId: user.id, endpoint: "documents-duplicate-decision", ...RATE_LIMITS.DOCUMENTS_REPROCESS,
  });
  if (!limited.allowed) return rateLimitResponse(limited);

  let decision: unknown = null;
  try {
    decision = (await req.json())?.decision;
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek." }, { status: 400 });
  }
  if (!isDuplicateDecision(decision)) {
    // Two values, and the CHECK constraint on the column accepts exactly those two. A third would
    // be refused by the database anyway; refusing it here says so in a sentence.
    return NextResponse.json({ error: "Kies 'Bestaande houden' of 'Toch toevoegen'." }, { status: 400 });
  }

  const outcome = await applyDuplicateDecision({ documentId: id, ownerId: user.id, decision });

  if (outcome.kind === "failed") {
    console.error("[ONTVANGEN-BESLUIT] the decision could not be written", { id, error: outcome.error });
    return NextResponse.json(
      { error: "We konden je keuze nu niet vastleggen. Probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }
  if (outcome.kind === "refused") {
    const message =
      outcome.why === "gone" ? "Dit bestand is niet gevonden."
      : outcome.why === "not_yours" ? "Deze vraag hoort niet bij jouw administratie."
      : "Deze vraag is al beantwoord.";
    // `gone` and `not_yours` are both 404-shaped facts about something the caller may not see;
    // `not_asked` is a 409, because the document is real and the question is simply closed.
    return NextResponse.json({ error: message }, { status: outcome.why === "not_asked" ? 409 : 404 });
  }

  await logAuditAction({
    userId: user.id,
    action: "document.duplicate_decided",
    entityType: "document",
    entityId: id,
    newValue: { decision, outcome: outcome.kind },
    ipAddress: getClientIP(req),
  }).catch(() => {});

  if (outcome.kind === "resumed") {
    // Same stored document, same bytes, same AI charge — it simply continues, now allowed past the
    // one block the owner has answered. Not awaited, for the same reason the upload door does not
    // await it: the answer is already durable, and a kick that never starts is the drain's work.
    kickStoredDocument({ documentId: id, ownerId: user.id });
    return NextResponse.json({
      ok: true,
      decision,
      message: "Toegevoegd — we verwerken hem zo. Je hoeft niets opnieuw te uploaden.",
    });
  }

  return NextResponse.json({
    ok: true,
    decision,
    message: "De bestaande factuur blijft staan. Deze tweede kopie is verwijderd.",
  });
}

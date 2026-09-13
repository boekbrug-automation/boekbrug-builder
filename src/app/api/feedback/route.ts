// src/app/api/feedback/route.ts
// [FEEDBACK] POST — an owner reports a problem, optionally with a screenshot.
//
// THE ORDER OF WRITES IS THE DESIGN.
// The ROW is the truth; the e-mail is a notification. So: store the row, then send. A report that
// existed only as an e-mail would be lost the moment Resend rejected it or the key was absent —
// and losing a message about a problem, silently, is the exact failure this feature exists to end.
// The image is uploaded first because its path belongs in the row, but a failed upload never
// costs the words: the report is stored without the picture and the answer says so.
//
// AND THE ANSWER IS NEVER A POLITE LIE.
// "Bedankt voor je melding" over a failed insert is worse than an error: the owner stops worrying
// about a problem nobody will ever see. A failed store is a refusal, in words, with the message
// still in the box so it can be sent again.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { parseFeedback, feedbackImageExtension } from "@/lib/feedback";
import { sendFeedbackNotification } from "@/lib/email";
import { isMissingRelation } from "@/lib/pg-missing";
import { storeOriginal } from "@/lib/document-storage";

export const dynamic = "force-dynamic";

/** Where the operator wants to hear about this. Absent = store only, and say so in the log. */
const OPERATOR_EMAIL = process.env.FEEDBACK_EMAIL?.trim() || "";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const limited = await checkRateLimit({
    userId: user.id, endpoint: "feedback-send", ...RATE_LIMITS.FEEDBACK_SEND,
  });
  if (!limited.allowed) return rateLimitResponse(limited);

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ongeldige gegevens." }, { status: 400 }); }

  const parsed = parseFeedback(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { message, path, image } = parsed.value;

  // The screenshot, into the owner's own folder in the existing documents bucket. No new bucket
  // and no new policy: <user_id>/... is the path shape the bucket already scopes on.
  //
  // A failed upload does NOT fail the report. Losing the words because the picture would not go
  // is the wrong trade in every direction — so the path stays null and the answer mentions it.
  let imagePath: string | null = null;
  let imageFailed = false;
  if (image) {
    const pipeline = createPipelineClient();
    const candidate = `${user.id}/feedback/${Date.now()}.${feedbackImageExtension(image.mimeType)}`;
    const { error: upErr } = await storeOriginal(pipeline, candidate, image.bytes, { contentType: image.mimeType, upsert: false });
    if (upErr) {
      console.error("[FEEDBACK] screenshot upload failed — storing the message without it", upErr);
      imageFailed = true;
    } else {
      imagePath = candidate;
    }
  }

  // [NO-SILENT-EMPTY] The error is read. supabase-js does not throw, so an unchecked insert would
  // let this route answer "bedankt" over a row that was never written.
  //
  // The refusal below still assumes the table might be missing, and stays: a deploy can reach an
  // installation where feedback.sql has not run. Note what does NOT happen there — elsewhere a
  // missing table degrades quietly (supplier-alias learns nothing and moves on), and that is right
  // there. Here it would be the whole defect: a report that vanishes while the owner is thanked
  // for it. So a missing table is treated as any other failure: a refusal, in words.
  //
  // What is gone is the `as any` on the client. The table is in the generated types now, so the
  // COMPILER checks these five column names — which is the only check that was ever going to catch
  // a typo here, since this statement had never run against a real table until today.
  const { error: insErr } = await supabase.from("feedback").insert({
    user_id: user.id,
    message,
    page_path: path,
    image_path: imagePath,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 400) || null,
  });
  if (insErr) {
    console.error(
      isMissingRelation(insErr.message)
        ? "[FEEDBACK] the feedback table does not exist yet — run supabase/migrations/feedback.sql"
        : "[FEEDBACK] could not store the report",
      insErr,
    );
    return NextResponse.json({
      error: "We konden je melding nu niet opslaan. Probeer het zo meteen opnieuw — je bericht is nog niet bij ons.",
    }, { status: 503 });
  }

  // Notification only. Never blocking, never able to turn a stored report into a failure.
  if (OPERATOR_EMAIL) {
    try {
      const delivered = await sendFeedbackNotification({
        toEmail: OPERATOR_EMAIL,
        fromEmail: user.email ?? "onbekend",
        message, pagePath: path, hasImage: imagePath != null,
      });
      if (!delivered) console.error("[FEEDBACK] notification not delivered — the report IS stored");
    } catch (e) {
      console.error("[FEEDBACK] notification threw — the report IS stored", e);
    }
  } else {
    // Not a failure: the row is the truth. Worth a line so nobody wonders later why no mail came.
    console.warn("[FEEDBACK] FEEDBACK_EMAIL is not set — the report is stored, no mail was sent");
  }

  return NextResponse.json({
    ok: true,
    // Said out loud rather than quietly dropped: the owner attached a picture on purpose, and
    // finding out later that it never arrived would make them trust the channel less.
    ...(imageFailed
      ? { message: "Bedankt — je melding is binnen. De afbeelding kon niet worden meegestuurd." }
      : { message: "Bedankt — je melding is binnen. We kijken ernaar." }),
  });
}

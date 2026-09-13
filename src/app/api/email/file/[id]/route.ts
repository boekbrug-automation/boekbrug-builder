// src/app/api/email/file/[id]/route.ts
// [BOEK-011] Generate a signed URL to view an incoming invoice PDF
// GET /api/email/file/[id] → { url: string }
// The PDF is stored privately in Supabase Storage — this creates a temp link

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
// [SEC-STORAGE-PATH] Normalising a stored value and deciding WHOSE bytes it names are the same
// question, so they live in one tested place — see the header of storage-path.ts for the hole
// this closes.
import { toStoragePath, pathBelongsToOwner } from "@/lib/storage-path";
// [DOC-GEEN-BLADZIJDE] Één regel voor "kan dit als bladzijde getoond worden", gedeeld met het
// scherm dat het antwoord gebruikt.
import { previewKind } from "@/lib/document-preview";
import { signedUrl } from "@/lib/document-storage";

/**
 * [DOC-VERSE-LINK] An answer the CALLER can read.
 *
 * This route serves two kinds of caller. The sheet fetches it and reads JSON. With ?open=1 the
 * browser is navigating to it directly, and a JSON object in a tab is what the owner was already
 * shown once — `{"statusCode":"400","error":"InvalidJWT"…}` — which tells them nothing and looks
 * like the app broke. Same failure, two audiences, so: a sentence for the tab, JSON for the fetch.
 *
 * Deliberately plain: no styling, no link back. This is the last thing standing when the file
 * cannot be reached, and every dependency it takes on is another way for it to fail too.
 */
function fileError(req: NextRequest, message: string, status: number) {
  if (req.nextUrl.searchParams.get("open") !== "1") {
    return NextResponse.json({ error: message }, { status });
  }
  const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Bestand openen</title>` +
      `<body style="font-family:system-ui,sans-serif;padding:32px;line-height:1.6;color:#202124">` +
      `<p>${escaped}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fileError(req, "Je bent niet ingelogd. Log in en probeer het opnieuw.", 401);
  }

  // Verify access and get the storage path.
  // Two authorized roles (BOEK-011 + ACC-INVOICE-VIEW cross-boundary fix):
  //   1. the receiver (the ZZP'er who owns the incoming invoice), or
  //   2. an accountant linked to that ZZP'er via accountant_clients.
  // Previously only (1) was allowed, so accountants opening a client's incoming
  // invoice (?from=client) got a 404 on both "Origineel PDF" and UBL.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, receiver_id, pdf_url")
    .eq("id", id)
    .single();

  if (!invoice) {
    return fileError(req, "Deze factuur konden we niet vinden.", 404);
  }

  let authorized = invoice.receiver_id === user.id;

  if (!authorized && invoice.receiver_id) {
    const { data: link } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", invoice.receiver_id)
      .maybeSingle();
    authorized = !!link;
  }

  if (!authorized) {
    return fileError(req, "Deze factuur konden we niet vinden.", 404);
  }

  if (!invoice.pdf_url) {
    return NextResponse.json(
      { error: "Geen bestand gekoppeld aan deze factuur" },
      { status: 404 }
    );
  }

  // [BOEK-011] Normalize — handles both relative paths and legacy full URLs
  const storagePath = toStoragePath(invoice.pdf_url);

  // [SEC-STORAGE-PATH] The authorization above proved the caller may read this ROW. It did NOT
  // prove anything about where the row POINTS — and pdf_url is plain text on a row the caller is
  // allowed to write (invoices_receiver_update / invoices_zzp_insert). Without this check a caller
  // could put another tenant's storage key on their own invoice and have the service-role client,
  // which bypasses the bucket policy, sign it for them. Every file this app writes is keyed
  // `<owner-uuid>/…`, and the owner covered by the check above is the invoice's receiver — so the
  // path must sit in THAT folder. Fails closed: an unattributable path is never signed.
  if (!pathBelongsToOwner(storagePath, invoice.receiver_id)) {
    console.error("[SEC-STORAGE-PATH] refused to sign a path outside the authorized owner", {
      invoiceId: id, receiverId: invoice.receiver_id, storagePath, callerId: user.id,
    });
    return fileError(req, "Je hebt geen toegang tot dit bestand.", 403);
  }

  // [BOEK-011 + ACC-INVOICE-VIEW] Sign with service_role — same reasoning as
  // /dashboard/brug/page.tsx documents:
  //
  // Storage bucket policies are SEPARATE from table RLS. The policy
  // `documents_read` on storage.objects requires
  //   (storage.foldername(name))[1] = auth.uid()::text
  // i.e. only the file's owner can sign it. A linked accountant opening a
  // client's incoming invoice is authorized at the row level (we just checked
  // accountant_clients above), but is NOT the storage owner — so a session
  // client createSignedUrl returns an error and we crashed with 500.
  //
  // Switching to the pipeline client here bypasses Storage RLS *only*. Two separate proofs are
  // required before we get here, and BOTH matter: the dual-path row check (session client), and
  // the owner-segment check on the path itself. The row proof alone was the bug — it says the
  // caller may see the record, not that the record points at their own bytes.
  const pipeline = createPipelineClient();
  const { data: signed, error } = await signedUrl(pipeline, storagePath, 300);

  if (error || !signed) {
    console.error("[BOEK-011] createSignedUrl failed", {
      invoiceId: id,
      storagePath,
      error,
    });
    // [DOC-VERSE-LINK] A tab that the owner is looking at gets a sentence, not a JSON object.
    return fileError(req, "We konden dit bestand nu niet openen. Probeer het zo meteen opnieuw.", 500);
  }

  // [DOC-INLINE] The KIND, so the viewer can render it instead of handing it to the operating
  // system. A camera intake is a JPEG and belongs in an <img>; a pdf goes in a frame. Derived from
  // the stored path, which is the only thing we have — the bucket does not carry a content type we
  // can trust here, and guessing wrong costs a blank frame, never a wrong file.
  //
  // [DOC-GEEN-BLADZIJDE] The rule moved to document-preview.ts, and grew a third answer. "other"
  // meant "put it in a frame", and for a UBL e-invoice that renders the raw XML source at the
  // owner — namespace declarations and all. A file that has no page now says so.
  const name = storagePath.split("/").pop() ?? "factuur";
  const kind = previewKind(name);

  // [DOC-VERSE-LINK] ?open=1 — the browser is going STRAIGHT to the file, so send it there.
  //
  // The alternative, which is what this route used to support alone, is to hand a signed url to the
  // screen and let a button carry it. That url lives 300 seconds, so a tap five minutes later put
  // Supabase's raw {"error":"InvalidJWT"} in a new tab instead of the document — on the one control
  // that exists precisely for when the inline frame does not work. Signing here removes the window
  // rather than widening it.
  if (req.nextUrl.searchParams.get("open") === "1") {
    return NextResponse.redirect(signed.signedUrl, {
      status: 302,
      // Never cached: the target carries a signature that expires, and a cached 302 would send a
      // later tap to a url that has already died — the very thing this branch exists to prevent.
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  return NextResponse.json({ url: signed.signedUrl, kind, name });
}
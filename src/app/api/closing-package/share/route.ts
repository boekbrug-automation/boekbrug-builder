// src/app/api/closing-package/share/route.ts
// [PAKKET-LINK] De ondernemer overhandigt zijn kwartaal aan een boekhouder zonder account.
//
// POST { year, quarter, email, note? }  → maakt een deel-link en MAILT hem
// POST { revokeId }                     → trekt een eigen link in
//
// De hele reden dat dit bestaat staat in de kop van /api/pakket: de kernbelofte werd alleen
// waargemaakt als de boekhouder zich registreerde. Deze route is de andere helft — de tik van de
// ondernemer die de belofte levert.
//
// Wat hier NIET gebeurt: het pakket wordt niet gebouwd en niet meegestuurd. Een kwartaal met
// bijlagen loopt al snel tegen de tientallen megabytes, en een mail met zo'n bijlage komt óf niet
// aan óf in de spam — precies het probleem dat [BEZORGING] elders in dit product heeft opgelost
// door juist NIET meer te versturen dan nodig. De link doet het werk, en hij is intrekbaar; een
// verstuurde bijlage is dat nooit meer.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-origin";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { sendQuarterPackageLink } from "@/lib/email";
import { isBruikbaarEmail, shareExpiry, SHARE_VALIDITY_DAYS } from "@/lib/package-share";
import { summarizeClosingPackage, ClosingPackageSourceUnavailableError } from "@/lib/closing-package";
import type { Quarter } from "@/lib/closing-package";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // ── Intrekken ──
  // Vóór de rest, want het is de goedkoopste handeling en hij mag nooit achter een mail-limiet
  // vast komen te zitten: iemand die zich vergiste in een adres moet ALTIJD kunnen intrekken.
  if (typeof body?.revokeId === "string" && body.revokeId) {
    // De gegenereerde types kennen package_shares nog niet (de migratie wordt met de hand
    // toegepast) — zelfde ontspannen cast als elke andere open migratie in deze codebase.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ingetrokken, error: revokeErr } = await (supabase as any)
      .from("package_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", body.revokeId)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .select("id");
    if (revokeErr) {
      console.error("[PAKKET-LINK] revoke failed", { error: revokeErr.message });
      return NextResponse.json({ error: "Intrekken mislukt — probeer het opnieuw." }, { status: 500 });
    }
    if (!ingetrokken || ingetrokken.length === 0) {
      return NextResponse.json({ error: "Deze link staat al niet meer open." }, { status: 409 });
    }
    await logAuditAction({
      userId: user.id, action: "package.link_revoked", entityType: "quarter",
      entityId: String(body.revokeId), ipAddress: getClientIP(req),
    });
    return NextResponse.json({ success: true, revoked: body.revokeId });
  }

  // ── Aanmaken + versturen ──
  // Zelfde plafond als de andere zware exports: het samenstellen gebeurt pas bij het OPHALEN,
  // maar een mailknop hoort net zo begrensd te zijn als de knop die de ZIP maakt.
  const limited = await checkRateLimit({ userId: user.id, endpoint: "closing-package-share", ...RATE_LIMITS.HEAVY_EXPORT });
  if (!limited.allowed) return rateLimitResponse(limited);

  const jaar = Number(body?.year);
  const kwartaalRuw = Number(body?.quarter);
  if (!Number.isInteger(jaar) || jaar < 2020 || jaar > 2030) {
    return NextResponse.json({ error: "Dat jaar kennen we niet." }, { status: 400 });
  }
  if (![1, 2, 3, 4].includes(kwartaalRuw)) {
    return NextResponse.json({ error: "Dat is geen geldig kwartaal." }, { status: 400 });
  }
  const kwartaal = kwartaalRuw as Quarter;

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isBruikbaarEmail(email)) {
    return NextResponse.json({ error: "Vul het e-mailadres van je boekhouder in." }, { status: 400 });
  }
  // Een eigen zin mag, maar begrensd: dit is een mail, geen tekstveld.
  const notitie = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";

  // De aantallen voor in de mail — uit dezelfde samenvatting die de kwartaal-cron gebruikt, zodat
  // de boekhouder hetzelfde getal leest als in het pakket zit.
  //
  // [PACKAGE-FAIL-CLOSED] Not best effort any more, and BEFORE the link exists. This used to be
  // "mislukt de telling, dan gaat de mail zonder aantallen" — but the mail has no version without
  // counts: it printed "0 verkoopfacturen en 0 inkoopfacturen" as a statement about the quarter.
  // Nothing is created and nothing is sent while a source cannot be read; the owner tries again.
  let uit = 0;
  let inkomend = 0;
  try {
    const pipeline = createPipelineClient();
    const samenvatting = await summarizeClosingPackage({ ownerId: user.id, year: jaar, quarter: kwartaal, supabase: pipeline });
    if (samenvatting.unreadSources.length > 0) {
      throw new ClosingPackageSourceUnavailableError(samenvatting.unreadSources.join(","));
    }
    uit = samenvatting.outgoingCount;
    inkomend = samenvatting.incomingCount;
  } catch (telErr) {
    if (telErr instanceof ClosingPackageSourceUnavailableError) {
      console.error("[PACKAGE-FAIL-CLOSED] quarter unreadable — no link made, no mail sent", { source: telErr.source, error: telErr.message });
      return NextResponse.json(
        { error: "Een deel van je administratie kon nu niet volledig worden gelezen. Er is niets verstuurd en er is geen link aangemaakt — probeer het over een paar minuten opnieuw." },
        { status: 503, headers: { "Retry-After": "120" } },
      );
    }
    console.error("[PAKKET-LINK] quarter summary failed — no link made, no mail sent", { telErr });
    return NextResponse.json(
      { error: "Het kwartaal kon nu niet worden samengevat. Er is niets verstuurd en er is geen link aangemaakt — probeer het opnieuw." },
      { status: 500 },
    );
  }

  const nu = Date.now();
  // [RLS-UIT] Sessie-client: de INSERT stempelt user_id = user.id en de policy eist dat ook.
  // Het TOKEN komt uit de database (gen_random_uuid) — geen client kiest ooit zijn eigen sleutel.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: share, error: insertErr } = await (supabase as any)
    .from("package_shares")
    .insert({
      user_id: user.id,
      year: jaar,
      quarter: kwartaal,
      sent_to_email: email,
      expires_at: shareExpiry(nu),
    })
    .select("id, token, expires_at")
    .single();

  if (insertErr || !share) {
    console.error("[PAKKET-LINK] share insert failed", { error: insertErr?.message });
    return NextResponse.json({ error: "We konden de link niet aanmaken. Probeer het opnieuw." }, { status: 500 });
  }

  const origin = appOrigin(process.env, new URL(req.url).origin) ?? new URL(req.url).origin;
  const downloadUrl = `${origin}/api/pakket?token=${share.token}`;

  const { data: profiel } = await supabase
    .from("profiles")
    .select("company_name, full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const bezorgd = await sendQuarterPackageLink({
    toEmail: email,
    clientName: profiel?.company_name || profiel?.full_name || "Je klant",
    clientEmail: profiel?.email ?? user.email ?? null,
    quarterLabel: `Q${kwartaal} ${jaar}`,
    outgoingCount: uit,
    incomingCount: inkomend,
    downloadUrl,
    validDays: SHARE_VALIDITY_DAYS,
    note: notitie || null,
  });

  if (!bezorgd) {
    // [TRUST-INVITE] Dezelfde regel als bij de uitnodiging: de mail IS de handeling. Kwam hij
    // niet aan, dan mag er geen "verstuurd" in het scherm blijven staan — de link wordt meteen
    // ingetrokken zodat de eigenaar het opnieuw kan doen zonder een dode link achter te laten.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createPipelineClient() as any)
      .from("package_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", share.id);
    return NextResponse.json(
      { error: "De mail is niet aangekomen bij de mailprovider. Er is niets verstuurd — probeer het opnieuw." },
      { status: 502 },
    );
  }

  await logAuditAction({
    userId: user.id,
    action: "package.link_shared",
    entityType: "quarter",
    entityId: `${user.id}:${jaar}-Q${kwartaal}`,
    newValue: { to: email, expires_at: share.expires_at },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({
    success: true,
    share: { id: share.id, email, expires_at: share.expires_at, sentAt: new Date(nu).toISOString() },
  });
}

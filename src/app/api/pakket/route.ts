// src/app/api/pakket/route.ts
// [PAKKET-LINK] De publieke download: het kwartaalpakket voor een boekhouder ZONDER account.
//
// GET /api/pakket?token={uuid}
//
// ── WAAROM DEZE ROUTE BESTAAT ──
// De kernbelofte ("aan het eind van het kwartaal staat alles klaar voor je boekhouder") werd
// alleen waargemaakt als de boekhouder zich registreerde: de kwartaal-cron loopt over
// accountant_clients, en de downloadknop in die mail wijst naar een route die inloggen eist. Het
// meest voorkomende Nederlandse geval — een kantoor dat al tien jaar op Exact draait en zich
// nooit ergens registreert — viel dus volledig buiten de belofte, en de ondernemer moest zelf
// een ZIP downloaden en met de hand aan een mail hangen. Precies het handwerk dat dit product
// wegneemt, teruggegeven op de laatste meter.
//
// ── HET TOKEN IS DE SLEUTEL, EN VERDER NIETS ──
// Zelfde vorm als /api/pay/[token] en de offerte-pagina: onraadbaar (uuid v4, door de database
// gezet), per mail verstuurd, en het opent PRECIES het ene kwartaal waarvoor het is gemaakt. Wat
// er gebouwd wordt komt volledig uit de RIJ — user_id, jaar, kwartaal — en geen enkele parameter
// uit de URL kan daar iets aan verschuiven. Een gast die het token heeft, kan er dus niets anders
// mee dan wat zijn klant hem gaf.
//
// ── FAIL-CLOSED, EN MET ÉÉN GEZICHT ──
// Onbekend, verlopen, ingetrokken: alle drie hetzelfde antwoord. Niet uit geheimzinnigheid maar
// omdat het verschil de lezer niets oplevert (hij kan alleen zijn klant om een nieuwe link
// vragen) terwijl het een rater wél iets vertelt: welke tokens BESTAAN.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { checkRateLimitByKey, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { buildClosingPackageZip } from "@/lib/closing-package";
// [PAKKET-AFDRUK] Wat er is overhandigd, zodat "het pakket is veranderd" een antwoord heeft.
import { contentOf, fingerprint, driftBetween, driftSentence } from "@/lib/package-fingerprint";
// [DEPLOY-SAFE] "de tabel is er nog niet" is iets anders dan "de schrijf ging mis".
import { isMissingRelation } from "@/lib/pg-missing";
import { createNotification } from "@/lib/notifications";
import { shareStatus } from "@/lib/package-share";
import { logAuditAction } from "@/lib/audit";
import type { Quarter } from "@/lib/closing-package";
// [MERK-VOET] The sign-off, from the one place that defines it.
import { merkVoet } from "@/lib/mail-merk";

/**
 * Eén gezicht voor elke weigering, in HTML — de lezer is een boekhouder die in zijn mailbox op
 * een knop klikte, niet een client die JSON verwerkt.
 */
function weiger(status: number, zin: string): NextResponse {
  const body = `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Deze link werkt niet meer — BoekBrug</title></head>
<body style="margin:0;background:#f8f9fa;font-family:system-ui,-apple-system,sans-serif">
<main style="max-width:460px;margin:14vh auto;padding:28px;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
<h1 style="font-size:18px;color:#202124;margin:0 0 10px">Deze link werkt niet meer</h1>
<p style="font-size:14.5px;color:#5F6368;line-height:1.6;margin:0">${zin}</p>
<p style="font-size:13px;color:#5F6368;line-height:1.6;margin:14px 0 0">Vraag je klant om een nieuwe link te sturen — dat kost hem één tik.</p>
${merkVoet()}
</main></body></html>`;
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Een bestandsnaam die elk besturingssysteem accepteert — zelfde regel als de ingelogde route. */
function veiligeNaam(waarde: string): string {
  return waarde.replace(/[^\w\-. ]+/g, "_").replace(/\s+/g, "_").slice(0, 60) || "klant";
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  // Vorm eerst: een niet-uuid raakt de database niet eens.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return weiger(400, "De link is onvolledig of verminkt geraakt — bijvoorbeeld doordat hij over twee regels werd geknipt in de mail.");
  }

  // Per TOKEN, niet per IP: één gedeelde link mag niet als bouwmachine gebruikt worden, terwijl
  // een kantoor achter één kantoor-IP nooit door de download van een ander wordt geblokkeerd.
  // Het samenstellen van een pakket is tientallen lezingen plus een ZIP — dit is de duurste
  // publieke handeling die dit product kent, dus hier NIET failOpen: kan de teller niet worden
  // geraadpleegd, dan gaat de dure handeling niet door.
  const limit = await checkRateLimitByKey({
    bucketKey: `pakket:${token}`,
    endpoint: "/api/pakket",
    ...RATE_LIMITS.HEAVY_EXPORT,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const pipeline = createPipelineClient();

  // [RLS-UIT] Service_role, en het TOKEN is de afscherming — uniek, onraadbaar, alleen per mail
  // verstuurd. Precies de vorm die de RLS-UIT-poort als "reden 4" kent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: share, error } = await (pipeline as any)
    .from("package_shares")
    .select("id, user_id, year, quarter, expires_at, revoked_at, download_count")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("[PAKKET-LINK] share lookup failed", { error: error.message });
    // Niet "onbekend": wij konden het niet nakijken, en dat is iets anders dan een dode link.
    return weiger(503, "We konden deze link nu even niet nakijken. Probeer het over een paar minuten opnieuw.");
  }
  // Onbekend, verlopen en ingetrokken krijgen bewust hetzelfde antwoord — zie de kop.
  if (!share || shareStatus(share, Date.now()) !== "live") {
    return weiger(404, "Hij is verlopen, ingetrokken, of heeft nooit bestaan.");
  }

  const jaar = Number(share.year);
  const kwartaal = Number(share.quarter);
  if (!Number.isInteger(jaar) || ![1, 2, 3, 4].includes(kwartaal)) {
    console.error("[PAKKET-LINK] share row names an impossible period", { id: share.id, jaar, kwartaal });
    return weiger(404, "Hij verwijst naar een periode die we niet kunnen samenstellen.");
  }

  let result;
  try {
    // Alles komt uit de RIJ. Geen URL-parameter raakt de inhoud — dat is de kern van deze route.
    result = await buildClosingPackageZip({
      ownerId: share.user_id,
      year: jaar,
      quarter: kwartaal as Quarter,
      supabase: pipeline,
    });
  } catch (err) {
    console.error("[PAKKET-LINK] build failed", { id: share.id, err });
    return weiger(500, "Het samenstellen van het pakket ging halverwege mis. Er is niets veranderd; opnieuw proberen kan direct.");
  }

  // [PAKKET-AFDRUK] …en WAT er is opgehaald. Het blok hieronder legde alleen de handeling vast,
  // en de zip wordt bij elke download opnieuw gebouwd uit de huidige tabellen — dus dezelfde link
  // kan in juni een ander pakket geven dan in april, en niets wist dat. Zie package-fingerprint.ts
  // voor waarom btw_filings deze gebeurtenis niet dekt: dat bevriest het kwartaal bij het
  // INDIENEN, en de boekhouder werkt uit het pakket dáárvoor.
  //
  // Vóór de teller, want dit is het feit; de teller is de statistiek. En best-effort in beide
  // richtingen: een mislukte afdruk mag een geslaagde download nooit tegenhouden ([DEPLOY-SAFE] —
  // de tabel kan er nog niet zijn), en een geslaagde download zonder afdruk is precies de toestand
  // van vóór deze regel, niet een nieuwe storing.
  try {
    const inhoud = contentOf(result.summary);

    // ── En de eigenaar hoort het, op het moment dat het gebeurt ──────────────
    //
    // Een afdruk die alleen wordt bewaard is een archief. Wat dit een verschil laat maken is dat
    // er iemand wordt gewaarschuwd op het moment dat zijn boekhouder een ANDER pakket ophaalt dan
    // de vorige keer — precies de constructie die filed-quarter.ts beschrijft: "the divergence was
    // visible on two screens to an owner who happened to open them, which for a time-bound legal
    // obligation is the same as not knowing".
    //
    // WAT HIER NIET WORDT UITGEREKEND: of de AANGIFTE hierdoor verandert. Die som woont in
    // btw-filing.ts en filed-quarter.ts, wordt daar getest, en wordt daar gesteld op het moment dat
    // de boeken bewegen — een beter moment dan dit, want dan is de eigenaar nog aan het werk. Hem
    // hier een tweede keer uitrekenen is hoe twee schermen een ander bedrag gaan noemen over
    // hetzelfde kwartaal. Dit bericht zegt wat er in het PAKKET veranderde; dat is zijn onderwerp.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vorige, error: vorigeFout } = await (pipeline as any)
      .from("package_deliveries")
      .select("delivered_at, outgoing_count, incoming_count, files_included, invoices_with_pdf, bank_statement_included, missing_evidence, warning_codes")
      .eq("user_id", share.user_id).eq("year", jaar).eq("quarter", kwartaal)
      .order("delivered_at", { ascending: false })
      .limit(1);
    // [NO-SILENT-EMPTY] Een mislukte lezing is geen "er was geen vorige aflevering". Dat laatste
    // betekent "dit is de eerste keer en er valt niets te vergelijken"; het eerste betekent dat we
    // een verandering kunnen missen. Geen melding sturen op een storing is de veilige kant — een
    // verkeerde melding over andermans boeken is erger — maar het hoort wel in het log.
    if (vorigeFout && !isMissingRelation(vorigeFout.message)) {
      console.error("[PAKKET-AFDRUK] vorige aflevering niet gelezen — geen vergelijking", { id: share.id, error: vorigeFout.message });
    } else if (Array.isArray(vorige) && vorige.length > 0) {
      const v = vorige[0] as {
        delivered_at: string; outgoing_count: number; incoming_count: number; files_included: number;
        invoices_with_pdf: number; bank_statement_included: boolean; missing_evidence: string[] | null; warning_codes: string[] | null;
      };
      const drift = driftBetween(
        {
          outgoingCount: v.outgoing_count, incomingCount: v.incoming_count, filesIncluded: v.files_included,
          invoicesWithPdf: v.invoices_with_pdf, bankStatementIncluded: v.bank_statement_included,
          missingEvidence: v.missing_evidence ?? [], warningCodes: v.warning_codes ?? [],
        },
        inhoud,
      );
      // Alleen wat iemand iets moet laten DOEN. Beter onderbouwd is goed nieuws, en een melding
      // voor goed nieuws is hoe een eigenaar leert de volgende weg te klikken.
      if (drift.needsAction) {
        const zin = driftSentence(result.summary.quarter, v.delivered_at, drift);
        if (zin) {
          await createNotification({
            userId: share.user_id,
            title: drift.kind === "figures_moved"
              ? "Je boekhouder haalde een ander pakket op dan de vorige keer"
              : "Het pakket dat je boekhouder ophaalde is minder goed onderbouwd",
            body: zin,
            type: "status",
            // [NOTIF-DEADEND] Naar het scherm waar de eigenaar de deel-link MAAKT — dat is waar
            // "stuur hem opnieuw" een handeling is. Deze regel wees eerst naar /dashboard/kwartaal,
            // een route die niet bestaat: de melding kwam aan, de tik erop kwam op een 404 uit, en
            // een melding die nergens heen leidt is erger dan geen melding — ze kost het vertrouwen
            // in de volgende.
            link: "/dashboard/klaar",
          });
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: afdrukFout } = await (pipeline as any).from("package_deliveries").insert({
      share_id: share.id,
      user_id: share.user_id,
      year: jaar,
      quarter: kwartaal,
      fingerprint: fingerprint(inhoud),
      outgoing_count: inhoud.outgoingCount,
      incoming_count: inhoud.incomingCount,
      files_included: inhoud.filesIncluded,
      invoices_with_pdf: inhoud.invoicesWithPdf,
      bank_statement_included: inhoud.bankStatementIncluded,
      missing_evidence: inhoud.missingEvidence,
      warning_codes: inhoud.warningCodes,
    });
    if (afdrukFout && !isMissingRelation(afdrukFout.message)) {
      console.error("[PAKKET-AFDRUK] afdruk niet vastgelegd", { id: share.id, error: afdrukFout.message });
    }
  } catch (e) {
    console.error("[PAKKET-AFDRUK] afdruk niet vastgelegd", { id: share.id, e });
  }

  // [BEWIJS] Leg vast DAT het is opgehaald — de eigenaar hoort op zijn eigen scherm te kunnen
  // zien dat zijn boekhouder het pakket heeft. Zonder dit blijft "verstuurd" een aanname, en is
  // deze overdracht niet meer aantoonbaar dan een gedeelde map. Best effort en NA het bouwen:
  // een telfout mag een geslaagde download nooit tegenhouden.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (pipeline as any)
      .from("package_shares")
      .update({
        last_downloaded_at: new Date().toISOString(),
        download_count: (Number(share.download_count) || 0) + 1,
      })
      .eq("id", share.id);
    await logAuditAction({
      userId: share.user_id,
      action: "package.link_downloaded",
      entityType: "quarter",
      entityId: `${share.user_id}:${jaar}-Q${kwartaal}`,
    });
  } catch (logErr) {
    console.error("[PAKKET-LINK] download not recorded", { id: share.id, logErr });
  }

  // ── Bestandsnaam ── zelfde vorm als de ingelogde route: de boekhouder ontvangt tientallen van
  // deze bestanden en herkent ze aan de KLANTNAAM, niet aan het product.
  let klantLabel = "klant";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: eigenaar } = await (pipeline as any)
    .from("profiles")
    .select("company_name, full_name")
    .eq("id", share.user_id)
    .maybeSingle();
  if (eigenaar) klantLabel = eigenaar.company_name || eigenaar.full_name || "klant";
  const bestandsnaam = `${veiligeNaam(klantLabel)}_Q${kwartaal}_${jaar}.zip`;

  return new NextResponse(new Uint8Array(result.zipBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${bestandsnaam}"`,
      "Cache-Control": "no-store",
    },
  });
}

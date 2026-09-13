// src/lib/fair-use-gate.ts
// [FAIR-USE] De poort die de routes gebruiken: één regel per route in plaats van zes.
//
// Er zijn vijf routes die een betaalde Claude-call doen (intake,
// email/upload, email/reimport, eft/import, bank/attach-invoice) en één die een factuur
// verstuurt. Zonder een gedeelde poort zou elk van die zeven zijn eigen versie krijgen van
// "welk plan heeft deze gebruiker, wat is zijn stand, mag dit door" — en zeven versies van
// dezelfde regel is zes kansen dat er één uit de pas gaat lopen met /eerlijk-gebruik.
//
// ── DRIE HEKKEN ACHTER ELKAAR, EN ZE DOEN NIET HETZELFDE ──
//   1. checkRateLimit (rate-limit.ts) — per gebruiker per uur. Tegen een script dat op hol
//      slaat. Faalt OPEN.
//   2. deze poort — per gebruiker per maand, tegen de gepubliceerde grens. Tegen structureel
//      zwaar gebruik dat geld kost. Faalt OPEN.
//   3. reserveAiBudget (ai-budget.ts) — globaal, per dag, in euro's. Tegen een rekening die
//      niemand kan betalen. Dit is het enige hek dat OOK dichtgaat als de database weg is,
//      en daarom is het de echte bodem.
//
// Dat alle drie behalve de laatste open falen is geen slordigheid maar regel 2 en 3 uit
// fair-use.ts: onze storing mag nooit de gebruiker raken.
//
// ── WAT DEZE POORT NOOIT DOET ──
// Zij pauzeert uitsluitend de handeling die ons per stuk geld kost. Zij raakt nooit het
// inzien, doorzoeken, exporteren of delen met de boekhouder — die staan in ALWAYS_FREE en
// er is geen route in dit bestand die ze kan bereiken.

import { NextResponse } from "next/server";
import { decidePlan } from "./subscription";
import { grantStanding, type GrantStanding, type PlanGrantRow } from "./plan-grants";
import { consumeFairUse, exceededMessage, releaseFairUse, type UsagePlan } from "./fair-use-usage";
import { entitledLimit, type FairUseKey } from "./fair-use";

/** Minimale vorm van een Supabase-client die het profiel kan lezen. */
type ProfileReader = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/**
 * Welk plan geldt er voor deze gebruiker.
 *
 * Faalt naar 'free' — niet omdat dat streng is, maar omdat 'free' hier niets afsluit: de
 * gratis grenzen zijn ruim en een overschrijding pauzeert alleen de duurste handeling. Zie
 * de uitleg bij decidePlan() in subscription.ts.
 */
export async function planForUser(client: ProfileReader, userId: string): Promise<UsagePlan> {
  return (await planAndStartFor(client, userId)).plan;
}

/**
 * [GRENS-BLIJFT] The same lookup, plus the day the account began.
 *
 * §5.5.1 promises that a limit an account already had is never lowered, so the ceiling a costly
 * action is measured against depends on WHEN the account started. That date sits in the same
 * profiles row this function already reads, so carrying it costs nothing — and fetching it
 * separately would be a second query on the hot path of every AI read.
 *
 * `startedAt` is null whenever the read failed or the column was empty. That is not a gap to be
 * filled with "today": fair-use-history.ts reads an absent date as the MOST generous answer,
 * because withholding a promised limit is the failure nobody would ever see.
 */
export async function planAndStartFor(
  client: ProfileReader,
  userId: string,
): Promise<{ plan: UsagePlan; startedAt: string | null }> {
  let startedAt: string | null = null;
  try {
    // De abonnementskolommen komen uit billing_subscription.sql (met de hand toegepast) en
    // staan niet in de gegenereerde typen → ontspannen client. Bestaan ze nog niet, dan
    // faalt de select en valt alles terug op 'free'.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client as any)
      .from("profiles")
      .select("role, subscription_status, current_period_end, created_at")
      .eq("id", userId)
      .single();
    if (data && typeof data.created_at === "string") startedAt = data.created_at;

    if (error || !data) {
      // Rol alsnog los proberen: een boekhouder mag nooit tegen een grens lopen, ook niet
      // wanneer de abonnementsmigratie nog niet is toegepast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: basic } = await (client as any)
        .from("profiles")
        .select("role, created_at")
        .eq("id", userId)
        .single();
      if (basic && typeof basic.created_at === "string") startedAt = basic.created_at;
      return { plan: basic?.role === "accountant" ? "boekhouder" : "free", startedAt };
    }

    // [TOEKENNING] Lopende toekenningen erbij: de welkomstperiode van 90 dagen, een pilot van een
    // kantoor, een verlenging. Eigen query en eigen try: is de tabel er nog niet ([DEPLOY-SAFE])
    // of hapert hij, dan telt er geen toekenning en valt het account terug op gratis — dezelfde
    // faalrichting als de rest van deze functie, en die ontzegt niemand zijn gegevens.
    let standing: GrantStanding = { grantedPlusUntil: null, grantOpenEnded: false };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: grants } = await (client as any)
        .from("plan_grants")
        .select("plan, starts_at, expires_at, revoked_at")
        .eq("user_id", userId);
      if (Array.isArray(grants)) standing = grantStanding(grants as PlanGrantRow[], Date.now());
    } catch {
      // standing blijft leeg — zie hierboven.
    }

    return {
      plan: decidePlan({
        role: data.role ?? null,
        subscriptionStatus: data.subscription_status ?? null,
        currentPeriodEnd: data.current_period_end ?? null,
        grantedPlusUntil: standing.grantedPlusUntil,
        grantOpenEnded: standing.grantOpenEnded,
        nowMs: new Date().getTime(),
      }).plan,
      startedAt,
    };
  } catch {
    return { plan: "free", startedAt };
  }
}

export type FairUseGate = {
  /** Mag de handeling door? Alleen `false` mag iets pauzeren. */
  allowed: boolean;
  /** Klaar om terug te geven als de route hem weigert. Alleen gevuld bij `allowed: false`. */
  response: NextResponse | null;
  /**
   * Roep dit aan wanneer de betaalde handeling MISLUKT is, zodat de gebruiker er niet voor
   * betaalt. Doet niets wanneer er niets was gereserveerd.
   * Zie /eerlijk-gebruik §3: "mislukte pogingen komen nooit op jouw rekening".
   */
  release: () => Promise<void>;
};

/**
 * Reserveer één kostbare handeling en lever meteen het antwoord waarmee de route hem kan
 * weigeren.
 *
 * ── WAAROM HTTP 402 EN NIET 429 ──
 * 429 betekent "je gaat te snel, probeer straks opnieuw" — dat is het bovenste hek en heeft
 * al zijn eigen antwoord. Dit is iets anders: de handeling is niet te snel maar valt buiten
 * wat gratis is, en het antwoord is niet "wacht even" maar "wacht tot volgende maand of
 * kies Plus". 402 (Payment Required) zegt dat precies, en laat de client de twee gevallen
 * uit elkaar houden zonder in de tekst te hoeven graven.
 *
 * Het antwoord bevat nooit een verwijt en altijd een uitweg — de `onExceed`-zin komt
 * letterlijk uit fair-use.ts, dus wat het scherm zegt is wat wij hebben gepubliceerd.
 */
/**
 * [E-FACTUUR-GRATIS] The same gate, for a read that may cost nothing.
 *
 * The allowance is called `aiDocuments` and it counts AI READS. A Peppol / UBL / Factur-X invoice
 * is not read by a model at all — the supplier states the figures in structured form and the
 * parser is arithmetic. Charging a document for it makes the owner pay for something free, and
 * does worse than that: it pushes a real invoice, one that DOES need reading, out of the month.
 *
 * The rule was already made once, in the e-mail sync's batch reservation, and it did not travel to
 * the four single-file doors. It lives here now so it cannot be got right in one place and wrong
 * in the others — which is precisely how it stood before this function existed.
 *
 * `costsAiCall: false` returns a gate that allows and whose release is a no-op: nothing was taken,
 * so there is nothing to give back.
 */
export async function gateFairUseForRead(params: {
  client: ProfileReader;
  userId: string;
  metric: FairUseKey;
  plan?: UsagePlan;
  /** false when the reader answers this file mechanically — see the header. */
  costsAiCall: boolean;
}): Promise<FairUseGate> {
  if (!params.costsAiCall) {
    return { allowed: true, response: null, release: async () => {} };
  }
  return gateFairUse(params);
}

export async function gateFairUse(params: {
  client: ProfileReader;
  userId: string;
  metric: FairUseKey;
  /** Al bekend? Dan schelen we een profielquery. */
  plan?: UsagePlan;
}): Promise<FairUseGate> {
  // [GRENS-BLIJFT] One lookup, two answers: which plan, and since when. The second decides which
  // ceiling §5.5.1 entitles this account to — see planAndStartFor.
  const resolved = params.plan
    ? { plan: params.plan, startedAt: null as string | null }
    : await planAndStartFor(params.client, params.userId);
  const plan = resolved.plan;
  const verdict = await consumeFairUse({
    userId: params.userId,
    metric: params.metric,
    plan,
    accountStartedAt: resolved.startedAt,
  });

  if (verdict.allowed) {
    let released = false;
    return {
      allowed: true,
      response: null,
      release: async () => {
        // Eén keer teruggeven. Een route die zowel in zijn catch als in een finally
        // teruggeeft, mag geen dubbel tegoed opleveren.
        if (released) return;
        released = true;
        await releaseFairUse({
          userId: params.userId,
          metric: params.metric,
          period: verdict.period,
        });
      },
    };
  }

  return {
    allowed: false,
    release: async () => {},
    response: NextResponse.json(
      {
        error: exceededMessage(params.metric),
        reason: "fair_use",
        metric: params.metric,
        used: verdict.used,
        // [EERLIJK-GEBRUIK-UITLEG] The LIMIT travels with the count. Without it the screen can say
        // "je hebt er 50 gebruikt" and not what 50 is out of — which is the difference between a
        // number and an explanation. Taken from the same table /eerlijk-gebruik publishes, so the
        // modal, the policy page and Instellingen cannot disagree.
        // [GRENS-BLIJFT] The ceiling THIS account has, not the one we publish today. A refusal
        // that names a number the owner is not actually held to is worse than no number: it is the
        // app telling him the promise was not kept.
        limit: entitledLimit(params.metric, plan === "plus" ? "plus" : "free", resolved.startedAt),
        plan,
        // Waar de gebruiker heen kan. Twee uitwegen, allebei goed — precies zoals
        // /eerlijk-gebruik §4 het beschrijft.
        wachten: "De teller begint op de 1e van de volgende maand weer bij nul.",
        upgradeUrl: "/prijzen",
        beleidUrl: "/eerlijk-gebruik",
      },
      { status: 402 },
    ),
  };
}

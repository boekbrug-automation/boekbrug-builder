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
import {
  consumeFairUse,
  exceededMessage,
  measureUsage,
  releaseFairUse,
  type UsagePlan,
} from "./fair-use-usage";
import { fairUseLimit, type FairUseKey } from "./fair-use";

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
  try {
    // De abonnementskolommen komen uit billing_subscription.sql (met de hand toegepast) en
    // staan niet in de gegenereerde typen → ontspannen client. Bestaan ze nog niet, dan
    // faalt de select en valt alles terug op 'free'.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client as any)
      .from("profiles")
      .select("role, subscription_status, current_period_end")
      .eq("id", userId)
      .single();

    if (error || !data) {
      // Rol alsnog los proberen: een boekhouder mag nooit tegen een grens lopen, ook niet
      // wanneer de abonnementsmigratie nog niet is toegepast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: basic } = await (client as any)
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();
      return basic?.role === "accountant" ? "boekhouder" : "free";
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

    return decidePlan({
      role: data.role ?? null,
      subscriptionStatus: data.subscription_status ?? null,
      currentPeriodEnd: data.current_period_end ?? null,
      grantedPlusUntil: standing.grantedPlusUntil,
      grantOpenEnded: standing.grantOpenEnded,
      nowMs: new Date().getTime(),
    }).plan;
  } catch {
    return "free";
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
  const plan = params.plan ?? (await planForUser(params.client, params.userId));
  const verdict = await consumeFairUse({ userId: params.userId, metric: params.metric, plan });

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
        limit: plan === "plus" ? fairUseLimit(params.metric).plus : fairUseLimit(params.metric).free,
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

/**
 * [OPSLAG-DEUR] The storage door: may this account still store this file?
 *
 * ── WHY THIS COULD NOT BE gateFairUse ──
 * Storage is the app's one MEASURED limit, not a counted one. There is no usage_counters row to
 * increment, because the truth is `sum(documents.file_size)` and a counter beside it could drift
 * away from it — see the two kinds of number in fair-use-usage.ts. Someone who empties their
 * prullenbak must see their space come back, and it only does when the number is measured.
 *
 * So this gate MEASURES, and it measures with measureUsage() rather than a query of its own. That
 * is deliberate and it is the whole point: the meter on /instellingen and this refusal have to
 * quote the same megabytes. A gate that computed storage its own way would tell an owner he has
 * room on one screen and refuse him on another, and he would be right to think the app is broken.
 * It costs one extra pair of queries on an upload that is already doing storage I/O.
 *
 * ── THE FAIL DIRECTION, AND IT IS THE SAME ONE AS EVERYWHERE ──
 * Fails OPEN. A storage figure we could not read is not evidence that someone is over; refusing on
 * our own outage would stop an owner filing a bill he is legally required to keep. The limits are
 * generous (2 GB free, 20 GB Plus) against a highest-ever observed 285 MB, so this gate exists to
 * bound the pathological case, not to shape ordinary use.
 *
 * ── WHAT IT DOES NOT GUARD ──
 * Only writes that create a `documents` row, because only those are what the meter measures — and
 * they are what an owner means by "my files". The invoice PDF, the creditnota and the offerte are
 * generated BY the app and never appear in documents; charging an owner storage for sending an
 * invoice would be the same inversion [E-FACTUUR-GRATIS] refuses.
 */
/**
 * [OPSLAG-DEUR] How much room this account still has, measured once.
 *
 * Split out of gateStorage because there are now TWO callers with the same rule and very different
 * answers to a refusal: an API route owes the owner a 402, and the e-mail sync owes him a HOLD. A
 * second implementation of "is there room" is how the screen and the background job start
 * disagreeing about the same megabytes, so there is one measurement and one arithmetic, used twice.
 *
 * `measurable: false` is the fail-open case — a storage figure we could not read is not evidence
 * that anyone is over.
 */
export type StorageRoom = {
  measurable: boolean;
  usedMb: number;
  /** 0 = no ceiling on this plan. */
  limitMb: number;
  plan: UsagePlan;
};

export async function storageRoom(params: {
  client: ProfileReader;
  userId: string;
  plan?: UsagePlan;
}): Promise<StorageRoom> {
  let plan: UsagePlan = params.plan ?? "free";
  try {
    plan = params.plan ?? (await planForUser(params.client, params.userId));
    const usage = await measureUsage(params.client as never, params.userId);
    if (typeof usage.storageMb !== "number") return { measurable: false, usedMb: 0, limitMb: 0, plan };
    const limitMb = plan === "free" ? fairUseLimit("storageMb").free : fairUseLimit("storageMb").plus;
    return { measurable: true, usedMb: usage.storageMb, limitMb, plan };
  } catch (err) {
    console.warn("[OPSLAG-DEUR] opslag niet te meten — bestand toegestaan", err);
    return { measurable: false, usedMb: 0, limitMb: 0, plan };
  }
}

/**
 * [OPSLAG-DEUR] Does this many bytes still fit? Pure, so the one rounding rule is testable.
 *
 * `alreadyTakenBytes` is what a caller has stored SINCE the measurement — the e-mail sync writes
 * many files against one measurement, and without it the second attachment of a run would be
 * weighed against room the first one already used. Measuring again per attachment would be exact
 * too, but measureUsage() paginates every document row, and a sync that re-counted the whole
 * archive once per attachment is a different bug.
 *
 * BYTES, not megabytes, and that is the whole reason this parameter is not a rounded number: the
 * rounding happens ONCE, over the run's total. Accumulating ceil() per file instead would charge a
 * 10 kB attachment a full megabyte, and a hundred small receipts would fill a 50 MB plan that has
 * barely a megabyte in it.
 *
 * Rounded UP at the end, so a file landing exactly on the boundary is refused rather than admitted:
 * the meter the owner reads is whole megabytes, and a refusal must never be a rounding away from
 * the number on his screen.
 */
export function storageFits(room: StorageRoom, bytes: number, alreadyTakenBytes = 0): boolean {
  if (!room.measurable) return true;
  if (room.limitMb <= 0) return true; // no ceiling configured on this plan
  const wantMb = Math.ceil((Math.max(0, alreadyTakenBytes) + Math.max(0, bytes)) / (1024 * 1024));
  return room.usedMb + wantMb <= room.limitMb;
}

export async function gateStorage(params: {
  client: ProfileReader;
  userId: string;
  /** The size of the file about to be stored, in bytes. */
  bytes: number;
  /** Al bekend? Dan schelen we een profielquery. */
  plan?: UsagePlan;
}): Promise<FairUseGate> {
  const allow: FairUseGate = { allowed: true, response: null, release: async () => {} };

  const room = await storageRoom({ client: params.client, userId: params.userId, plan: params.plan });
  if (storageFits(room, params.bytes)) return allow;

  return {
    allowed: false,
    release: async () => {},
    response: NextResponse.json(
      {
        error: exceededMessage("storageMb"),
        reason: "fair_use",
        metric: "storageMb",
        used: room.usedMb,
        limit: room.limitMb,
        plan: room.plan,
        upgradeUrl: "/prijzen",
        beleidUrl: "/eerlijk-gebruik",
      },
      { status: 402 },
    ),
  };
}

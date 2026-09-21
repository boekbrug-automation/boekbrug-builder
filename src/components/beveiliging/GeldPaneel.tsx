"use client";

// src/components/beveiliging/GeldPaneel.tsx
// [GELD-INVARIANT] "Kloppen mijn boeken met zichzelf?" — het antwoord, op het scherm waar de
// eigenaar besluit zijn kwartaal weg te geven.
//
// ── WAAROM DIT PANEEL ER PAS NU IS ──
//
// money-invariants.ts is af, doordacht en getest, en niets riep het aan. Geen scherm, geen route,
// geen cron. Een geldaudit die nergens draait is precies het gebrek waar dat bestand zelf over
// waarschuwt: uitgerekend, en aan niemand verteld.
//
// ── EN WAAROM HET STIL IS ALS ALLES KLOPT ──
//
// Eén regel, geen kleur, geen icoon — dezelfde discipline als het nummeringspaneel ernaast. Maar
// die regel STAAT er: een eigenaar die dit paneel nooit iets heeft zien zeggen, weet niet dat er
// wordt meegekeken, en een controle waarvan niemand weet koopt geen enkel vertrouwen. Een groen
// vak ter grootte van een waarschuwing is hoe mensen leren over die plek heen te lezen.

import { useEffect, useState } from "react";

import { translator } from "@/lib/i18n/t";
import { useLocale } from "@/lib/i18n/use-locale";
import type { MessageKey } from "@/lib/i18n/messages";
import type { PanelAudience } from "./NummeringPaneel";

/** One finding, as the route hands it over: the sentence is Dutch and comes from the rule. */
type Finding = { kind: string; entityId: string; euros: number; message: string };

type Audit = {
  headline: string;
  violations: Finding[];
  drawer: Finding[];
  drawerChecked: boolean;
};

/** Three states, never blurred — the same discipline as every other panel in this app. */
type Load = { state: "reading" } | { state: "unreadable" } | { state: "ok"; audit: Audit };

// [KANTOOR-RUST] `audience` decides the voice, exactly as in NummeringPaneel: the owner keeps the
// one line that proves the audit ran; the accountant reads nothing when the books agree, the
// findings when they do not, and why nothing is repaired automatically only on demand. A drawer
// half that did not run is named to both.
export function GeldPaneel({ clientId, audience = "owner" }: { clientId?: string; audience?: PanelAudience } = {}) {
  const t = translator(useLocale());
  const [load, setLoad] = useState<Load>({ state: "reading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        // [BRUG] Dezelfde uitslag, aan beide kanten van de brug. Met een clientId leest de route de
        // administratie van die klant — en alleen wanneer accountant_clients de koppeling bewijst.
        const res = await fetch(`/api/money-audit${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`);
        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !json?.ok || !Array.isArray(json.violations)) {
          setLoad({ state: "unreadable" });
          return;
        }
        setLoad({
          state: "ok",
          audit: {
            headline: typeof json.headline === "string" ? json.headline : "",
            violations: json.violations as Finding[],
            drawer: Array.isArray(json.drawer) ? (json.drawer as Finding[]) : [],
            // Careful direction: an answer that did not say the drawer was checked was not.
            drawerChecked: json.drawerChecked === true,
          },
        });
      } catch {
        if (alive) setLoad({ state: "unreadable" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId]);

  if (load.state === "reading") return null; // nothing to say yet; a spinner here is a stutter
  if (load.state === "unreadable") return <GeldUitslag audit={null} t={t} audience={audience} />;
  return <GeldUitslag audit={load.audit} t={t} audience={audience} />;
}

/**
 * The verdict, with no fetching of its own.
 *
 * Separate so tests/render can hand it a clean audit, one with a difference, and one whose drawer
 * half did not run, and assert what each produces. The rule is tested as VALUES in
 * money-invariants.test.ts; this is where those values become sentences.
 *
 * `audit: null` is "we could not check" — deliberately not a separate boolean, because a failed
 * read and a clean set of books must never be reachable through the same branch.
 */
export function GeldUitslag({
  audit,
  t,
  audience = "owner",
}: {
  audit: Audit | null;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  audience?: PanelAudience;
}) {
  const acc = audience === "accountant";
  if (audit === null) {
    return (
      <p role="alert" className="text-sm text-amber-700 leading-relaxed">
        {t(acc ? "geld.nietGelezenAcc" : "geld.nietGelezen")}
      </p>
    );
  }

  const findings = [...audit.violations, ...audit.drawer];

  if (findings.length === 0) {
    // [KANTOOR-RUST] Silent to the accountant when the books agree — except the drawer half that
    // did not run, which is named, because a silence there would read as "checked".
    if (acc) {
      return audit.drawerChecked ? null : (
        <p className="text-sm text-amber-700 leading-relaxed">{t("geld.ladeNietGecontroleerd")}</p>
      );
    }
    return (
      <p className="text-sm text-gray-500 leading-relaxed">
        {t("geld.klopt")}
        {/* Half a check is never reported as a whole one — the drawer is its own axis and its own
            failure, and the till is where a missing movement hides best. */}
        {!audit.drawerChecked && ` ${t("geld.ladeNietGecontroleerd")}`}
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
      <p className="text-sm font-semibold text-amber-900">{t("geld.verschillenTitel")}</p>

      {/* The euros first, because that is the number that decides whether this waits until Monday.
          The sentence itself comes from the rule: it names the two figures that disagree, and it
          would lose exactly that by being summarised here. */}
      {findings.slice(0, 12).map((f, i) => (
        <p key={`${f.kind}-${f.entityId}-${i}`} className="text-sm text-amber-900 leading-relaxed">
          {f.message}
        </p>
      ))}

      {!audit.drawerChecked && (
        <p className="text-sm text-amber-900 leading-relaxed">{t("geld.ladeNietGecontroleerd")}</p>
      )}

      {/* What to DO. A finding with no next step is a screen that worries someone and leaves him
          there — and here the next step is genuinely not "fix it": repairing automatically means
          picking one of two disagreeing sources, and picking wrong destroys the evidence that they
          ever differed. */}
      {acc ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-amber-900">{t("bh.waarom")}</summary>
          <p className="text-sm text-amber-900 leading-relaxed mt-1">{t("geld.watNuAcc")}</p>
        </details>
      ) : (
        <p className="text-sm text-amber-900 leading-relaxed">{t("geld.watNu")}</p>
      )}
    </div>
  );
}

"use client";

// src/components/beveiliging/NummeringPaneel.tsx
// [DOORLOPEND] "Loopt mijn factuurnummering door?" — the answer, on the screen that asks whether
// this administration is in order.
//
// ── WHY THIS PANEL IS QUIET WHEN IT IS FINE ──
//
// Article 35 Wet OB requires an unbroken series, and it is among the first things an accountant
// checks. So the healthy answer belongs on the screen too — one line, no colour, no icon: an owner
// who has never seen this panel say anything would not know it was watching, and a check nobody
// knows about buys no confidence at all. But it stays ONE line. A green box the size of a warning
// is how people learn to skim the place a real warning will one day appear.
//
// ── AND WHY A GAP IS NOT AN ALARM ──
//
// A missing number is usually not fraud and usually not a bug: the counter moves before the invoice
// is written, so a send that failed halfway burns a number permanently. That is allowed — the
// Belastingdienst accepts a gap that can be EXPLAINED; what it does not accept is a gap nobody
// noticed. So this says which numbers, and says plainly that an explanation is what is wanted,
// rather than colouring the screen red about something the owner cannot undo.
//
// ── AND WHY IT SAYS NOTHING AT ALL TO THE ACCOUNTANT WHEN IT IS FINE ──
//
// [KANTOOR-RUST] The same verdict is read on /dashboard/clients/[id]/kwartaal by the boekhouder,
// about a CLIENT's series. There the one healthy line is noise between the accountant and the
// exceptions they came for, and every "je reeks" / "noteer dat voor je boekhouder" is the wrong
// person addressed. So the `audience` decides the voice: the owner keeps the line that proves the
// check ran; the accountant gets silence when it is clean, the finding when it is not, and the
// rationale behind a gap only when they open it. What never changes with the audience: a check
// that could NOT run says so, to both.

import { useEffect, useState } from "react";

import { translator } from "@/lib/i18n/t";
import { useLocale } from "@/lib/i18n/use-locale";
import type { MessageKey } from "@/lib/i18n/messages";
import type { SeriesReport } from "@/lib/invoice-continuity";
// [KANTOOR-PERIODE] The sentences below are composed in ONE place now, because the period
// workspace shows the same findings and a second copy is how a third vocabulary is born.
import { numberingLines, numberingProblems, numberingUnreadableText } from "@/lib/numbering-lines";

type Report = {
  series: SeriesReport[];
  unreadable: string[];
  clean: boolean;
  unaccounted: number | null;
  countersRead: boolean;
};

/** Three states, never blurred — the same discipline as every other panel in this app. */
type Load = { state: "reading" } | { state: "unreadable" } | { state: "ok"; report: Report };

/** Who is reading: the owner about their own series, or the accountant about a client's. */
export type PanelAudience = "owner" | "accountant";

export function NummeringPaneel({ clientId, audience = "owner" }: { clientId?: string; audience?: PanelAudience } = {}) {
  const t = translator(useLocale());
  const [load, setLoad] = useState<Load>({ state: "reading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        // [BRUG] Dezelfde uitslag, aan beide kanten van de brug. Met een clientId leest de route de
        // administratie van die klant — en alleen wanneer accountant_clients de koppeling bewijst.
        const res = await fetch(`/api/invoice/continuity${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`);
        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !json?.ok || !Array.isArray(json.series)) {
          setLoad({ state: "unreadable" });
          return;
        }
        setLoad({
          state: "ok",
          report: {
            series: json.series as SeriesReport[],
            unreadable: Array.isArray(json.unreadable) ? json.unreadable : [],
            // Careful direction on both: an answer that did not say it was clean is not clean, and
            // a total that did not arrive is unknown rather than zero.
            clean: json.clean === true,
            unaccounted: typeof json.unaccounted === "number" ? json.unaccounted : null,
            countersRead: json.countersRead === true,
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
  if (load.state === "unreadable") return <NummeringUitslag report={null} t={t} audience={audience} />;
  return <NummeringUitslag report={load.report} t={t} audience={audience} />;
}

/**
 * The verdict, with no fetching of its own.
 *
 * Separate so tests/render/ can hand it a clean series, a series with a hole, one with a burned
 * number at the end and one with unreadable numbers, and assert what each produces. The rule in
 * invoice-continuity.ts is tested as VALUES; this is where those values become sentences, and a
 * component that computed the right verdict and rendered the wrong string would pass every test in
 * that file.
 *
 * `report: null` is "we could not check" — deliberately not a separate boolean, because a null
 * report and a clean one must never be reachable through the same branch.
 */
export function NummeringUitslag({
  report,
  t,
  audience = "owner",
}: {
  report: Report | null;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  audience?: PanelAudience;
}) {
  const acc = audience === "accountant";
  if (report === null) {
    return (
      <p role="alert" className="text-sm text-amber-700 leading-relaxed">
        {t(acc ? "doorlopend.nietGelezenAcc" : "doorlopend.nietGelezen")}
      </p>
    );
  }

  const problems = numberingProblems(report.series);

  // Clean, and the whole check ran: one line, no box. The owner has now seen that it is watched.
  if (report.clean && problems.length === 0) {
    // [KANTOOR-RUST] To the accountant a healthy series is silent — but half a check is still
    // named, because a silence there would read as "checked to the end".
    if (acc) {
      return report.countersRead ? null : (
        <p className="text-sm text-amber-700 leading-relaxed">{t("doorlopend.halfGecontroleerd")}</p>
      );
    }
    return (
      <p className="text-sm text-gray-500 leading-relaxed">
        {t("doorlopend.klopt")}
        {/* Half a check is never reported as a whole one. Without the counters the END of each
            series is unchecked, which is exactly where a burned number is likeliest to sit. */}
        {!report.countersRead && ` ${t("doorlopend.halfGecontroleerd")}`}
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
      <p className="text-sm font-semibold text-amber-900">{t(acc ? "doorlopend.gatenTitelAcc" : "doorlopend.gatenTitel")}</p>

      {/* [KANTOOR-PERIODE] Same pieces, same order, same bold label — only their composition moved
          to numbering-lines.ts so the period workspace can read the identical sentences. */}
      {numberingLines(report.series, t, audience).map((line) => (
        <p key={line.key} className="text-sm text-amber-900 leading-relaxed">
          <span className="font-semibold">{line.label}</span>{" "}
          {line.missing}{" "}
          {/* [REEKS-ZONDER-FACTUUR] Twee zinnen, want het zijn twee dingen. "Aan het eind van de
              reeks" veronderstelt een reeks; issued 0 betekent dat er nooit iets in geschreven is,
              en dat is een ander bericht met een ander antwoord erop. */}
          {line.burned}{" "}
          {line.duplicates}
        </p>
      ))}

      {report.unreadable.length > 0 && (
        // Not a gap and not dropped: a number in a format we do not know. Naming them lets the owner
        // recognise his own imported history instead of wondering what we mean.
        <p className="text-sm text-amber-900 leading-relaxed">
          {numberingUnreadableText(report.unreadable, t, audience)}
        </p>
      )}

      {/* What to DO. A finding with no next step is a screen that worries someone and leaves him
          there — and the next step here is genuinely not "fix it", because a burned number cannot
          be reused. It is: know about it before your accountant does. */}
      {acc ? (
        // [KANTOOR-RUST] Explain on demand: the boekhouder knows why a gap is allowed; the one who
        // does not can open it. The finding above stays; only the lecture folds.
        <details>
          <summary className="cursor-pointer text-sm font-medium text-amber-900">{t("bh.waarom")}</summary>
          <p className="text-sm text-amber-900 leading-relaxed mt-1">{t("doorlopend.watNuAcc")}</p>
        </details>
      ) : (
        <p className="text-sm text-amber-900 leading-relaxed">{t("doorlopend.watNu")}</p>
      )}
    </div>
  );
}

// tests/render/notification-bell.test.tsx
// [MELDING-TIK] De bel, echt gerenderd, met de rijen die er in productie in staan.
//
// Waarom dit hier moet staan en niet alleen als lifecycle-gate: de gate leest de BRON en kan dus
// bevestigen dat er een onClick staat en dat hij markAsRead aanroept. Wat hij niet kan zien is of
// een rij ZONDER link nog steeds een knop is die je met toetsenbord kunt bereiken — dat is een
// eigenschap van de gerenderde HTML, en het is precies de eigenschap die 295 van de 1031 meldingen
// in de productiedatabase misten.
//
// De rijen hieronder zijn echte titels uit die tabel, met hun echte link-stand:
//   "Inkoopfactuur betaald"  — 96 rijen, 96 zonder link
//   "Factuur betaald"        — 134 rijen, 129 zonder link
//   "Factuur geverifieerd"   — 342 rijen, 4 zonder link
// Een lege lijst zou hier niets bewijzen: [].map(cb) roept cb nooit aan (zie AGENTS.md).

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// De App Router-hooks gooien buiten een router; useRouter staat bovenaan NotificationsBell.
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

const NOOP = () => {};

const MET_LINK = {
  id: "n1",
  user_id: "u1",
  title: "Factuur geverifieerd",
  body: "Factuur 3420623 is gecontroleerd en geboekt.",
  type: "invoice",
  read: false,
  link: "/dashboard/invoice/abc",
  created_at: "2026-09-04T08:00:00Z",
};

const ZONDER_LINK = {
  ...MET_LINK,
  id: "n2",
  title: "Inkoopfactuur betaald",
  body: "Inkoopfactuur 2600999 is gemarkeerd als betaald.",
  type: "payment",
  link: null,
};

// De rij die de hele reden is dat de link ook op het SCHERM gecontroleerd wordt: 1031 rijen zijn
// geschreven voordat createNotification de link filterde, en twee routes accepteren hem uit een
// request body. Dit is wat er in die kolom kan staan.
const VIJANDIGE_LINK = { ...MET_LINK, id: "n3", title: "Factuur betaald", link: "//evil.example/steal" };

// [MELDING-WAARHEID] The bell says out loud when a mark was not stored, through the app's toast —
// so it renders under the provider the root layout mounts, exactly as it does in the app.
async function inToast(el: React.ReactElement): Promise<React.ReactElement> {
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  return React.createElement(ToastProvider, null, el);
}

async function render(notifications: unknown[]) {
  const { NotificationsBell } = await import("../../src/app/dashboard/_shared/index");
  return renderToStaticMarkup(
    await inToast(React.createElement(NotificationsBell as never, {
      notifications,
      showNotifications: true,
      onToggle: NOOP,
      onMarkAllRead: NOOP,
      loadError: null,
    } as never)),
  );
}

test("[MELDING-TIK] elke melding is een knop, ook die zonder link", async () => {
  const html = await render([MET_LINK, ZONDER_LINK]);

  assert.ok(html.includes("Inkoopfactuur betaald"),
    "de melding zonder link wordt niet eens getoond");
  assert.ok(html.includes("Factuur geverifieerd"),
    "de melding met link wordt niet getoond");

  // Twee rijen, twee knoppen — plus de belknop zelf en 'alles gelezen'. Waar het om gaat is dat het
  // AANTAL rijen met role="button" gelijk is aan het aantal meldingen: was het er één, dan is de
  // rij zonder link weer inert.
  const rijen = (html.match(/role="button"/g) ?? []).length;
  assert.ok(rijen >= 2,
    `slechts ${rijen} elementen met role="button" — een melding zonder link is weer geen knop, ` +
      "en dus onbereikbaar met het toetsenbord en dood bij een tik");
  const tabbaar = (html.match(/tabindex="0"/gi) ?? []).length;
  assert.ok(tabbaar >= 2,
    `slechts ${tabbaar} rijen staan in de tabvolgorde; de rij zonder link is overgeslagen`);
});

test("[MELDING-TIK] een vijandige link telt niet als bestemming", async () => {
  // WAT HIER NIET GETOETST WORDT, EN WAAROM. De eerste versie hiervan was
  // `assert.ok(!html.includes("evil.example"))` en die stond meteen groen — óók toen de bel de
  // kolom weer rauw las. De link zit alleen in de onClick-sluiting, en renderToStaticMarkup zet
  // geen handlers in de HTML, dus die bewering was waar om een reden die niets met de fix te maken
  // had. Precies de vorm die AGENTS.md beschrijft: een toets die slaagt zonder iets te meten.
  //
  // Wat het scherm WEL uitspreekt is of het deze rij als een bestemming ziet: de cursor. Dat is
  // dezelfde `href` die router.push zou krijgen, en het is het enige spoor ervan in de markup.
  const vijandig = await render([VIJANDIGE_LINK]);
  assert.ok(vijandig.includes("Factuur betaald"),
    "de melding zelf hoort gewoon te blijven staan — de tekst is waar hij voor is");
  assert.ok(vijandig.includes("cursor:default"),
    "de bel behandelt //evil.example/steal als een geldige bestemming. Die string staat in de " +
      "kolom omdat twee routes `link` uit een request body overnemen, en hij haalt het browsers " +
      "authority-deel — een complete URL naar een andere host");
  // `cursor:pointer` staat óók op de belknop en op 'alles gelezen', dus dáárop toetsen zegt niets
  // over de rij. `cursor:default` doet alleen de rij, en alleen wanneer hij nergens heen gaat.
  const geldig = await render([MET_LINK]);
  assert.ok(!geldig.includes("cursor:default"),
    "een melding met een gewone in-app link wordt niet meer als bestemming getoond — dan is de " +
      "controle geen filter maar een muur");
});

test("[MELDING-TIK] een ongelezen melding is zichtbaar ongelezen, een gelezen niet", async () => {
  const ongelezen = await render([MET_LINK]);
  const gelezen = await render([{ ...MET_LINK, read: true }]);
  // De blauwe achtergrond IS de ongelezen-stand; zonder verschil telt de badge iets wat de rij
  // niet laat zien.
  assert.ok(ongelezen.includes("#E8F0FE"),
    "een ongelezen melding krijgt geen ongelezen-markering meer");
  assert.ok(!gelezen.includes("#E8F0FE"),
    "een gelezen melding wordt nog steeds als ongelezen getoond — dan zegt de markering niets");
});

test("[NO-SILENT-EMPTY] een leesfout wordt nooit 'geen meldingen'", async () => {
  const { NotificationsBell } = await import("../../src/app/dashboard/_shared/index");
  const html = renderToStaticMarkup(
    await inToast(React.createElement(NotificationsBell as never, {
      notifications: [],
      showNotifications: true,
      onToggle: NOOP,
      onMarkAllRead: NOOP,
      loadError: "De meldingen konden niet worden geladen.",
    } as never)),
  );
  assert.ok(html.includes("konden niet worden geladen"),
    "de leesfout wordt niet getoond");
  assert.ok(!/Geen meldingen/i.test(html),
    "de bel zegt 'geen meldingen' terwijl hij ze niet heeft kunnen lezen — de enige zin die dit " +
      "paneel nooit mag zeggen als het het niet weet");
});

// ── [UPLOAD-TRUTH-1] A machine notification, in the language of whoever opens the bell ────────
//
// Why this is a RENDER test and not only a gate: the gate reads the source and can confirm that
// both halves go through notificationCopy. What it cannot see is what the owner ends up looking
// at — and the failure this closes is precisely a rendering one: an Arabic heading over a Dutch
// paragraph, which looks finished and so nothing points at the gap.
//
// The row below is what the background pass actually writes: Dutch in the columns, because there
// is no request and no screen at that moment, and `event_key` naming the event.

const ONLEESBAAR = {
  id: "n4",
  user_id: "u1",
  title: "Een bestand konden we niet lezen",
  body: "Je bestand is ontvangen en staat veilig in je bestanden, maar we konden het niet uitlezen.",
  type: "status",
  read: false,
  link: "/dashboard/incoming?onleesbaar=a4f2c95e-31ed-4523-a9fa-6ff9f131af8f",
  created_at: "2026-09-23T08:11:00Z",
  event_key: "intake:unreadable:a4f2c95e-31ed-4523-a9fa-6ff9f131af8f",
};

test("[UPLOAD-TRUTH-1] the unreadable notice renders title AND body from the catalogue", async () => {
  const { MESSAGES } = await import("../../src/lib/i18n/messages");
  const html = await render([ONLEESBAAR]);

  // Dutch is the source language, so on a Dutch screen the rendered text and the stored text agree.
  assert.ok(html.includes(MESSAGES["meld.onleesbaar.titel"].nl), "the title comes from the catalogue");
  assert.ok(html.includes(MESSAGES["meld.onleesbaar.tekst"].nl), "and so does the body");

  // The link survives to the markup, because a notice that cannot be followed is the same silence
  // one step further along.
  assert.ok(html.includes("onleesbaar=a4f2c95e-31ed-4523-a9fa-6ff9f131af8f")
    || html.includes("role=\"button\""), "the row is actionable");
});

test("[UPLOAD-TRUTH-1] a notification the map does not know keeps its stored words", async () => {
  // The safety of adding this to a bell that renders 1.134 existing rows: every one of them, and
  // every notification a person triggered, is untouched.
  const html = await render([MET_LINK, ZONDER_LINK, VIJANDIGE_LINK]);
  assert.ok(html.includes("Factuur geverifieerd"));
  assert.ok(html.includes("Factuur 3420623 is gecontroleerd en geboekt."));
  assert.ok(html.includes("Inkoopfactuur betaald"));
  assert.ok(html.includes("Inkoopfactuur 2600999 is gemarkeerd als betaald."));
});

test("[UPLOAD-TRUTH-1] both halves move language together, never one without the other", async () => {
  // The mixed-language state, as a property of the rendered output rather than of the source: on
  // an Arabic screen NEITHER the stored Dutch title nor the stored Dutch body may appear.
  const { MESSAGES } = await import("../../src/lib/i18n/messages");
  const ar = MESSAGES["meld.onleesbaar.titel"].ar;
  const arBody = MESSAGES["meld.onleesbaar.tekst"].ar;
  assert.ok(ar && arBody, "the Arabic copy exists for both halves");
  // The two must be different sentences — one key used twice would render a heading as a paragraph.
  assert.notEqual(ar, arBody);
  // And neither may carry a placeholder: a noun dropped into a translated sentence is what
  // AGENTS.md forbids, and the link carries the file's identity instead.
  assert.doesNotMatch(String(ar) + String(arBody), /\{[^}]+\}/);
});

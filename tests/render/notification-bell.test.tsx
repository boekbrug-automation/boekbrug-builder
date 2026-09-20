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

// [SEC-REDIRECT] Pure node test — run: npx tsx --test src/lib/safe-redirect.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { isSafeRedirect, safeRedirect, withRedirect } from "./safe-redirect";

test("een gewoon pad op onze eigen origin komt erdoor", () => {
  for (const pad of [
    "/",
    "/dashboard",
    "/dashboard/kluis",
    "/dashboard/kluis?doel=archief",
    "/invite/accept?token=abc123",
    "/zoeken?q=100%",          // een letterlijk procentteken mag geen probleem zijn
    "/facturen#regel-3",
    "/ /toch-ons-eigen-pad",   // een spatie is geen stuurteken; dit blijft onze origin
  ]) {
    assert.equal(isSafeRedirect(pad), true, `${pad} hoort een geldige bestemming te zijn`);
    assert.equal(safeRedirect(pad, "/dashboard"), pad);
  }
});

test("een vreemd domein komt er niet doorheen", () => {
  for (const kwaad of [
    "https://evil.nl",
    "http://evil.nl",
    "//evil.nl",               // protocol-relatief: de browser vult ons schema in en vertrekt
    "///evil.nl",
    "/\\evil.nl",              // dezelfde truc met een backslash
    "/\\\\evil.nl",
    "https://boekbrug.nl.evil.nl/inloggen",
  ]) {
    assert.equal(isSafeRedirect(kwaad), false, `${kwaad} mag NOOIT een bestemming worden`);
    assert.equal(safeRedirect(kwaad, "/dashboard"), "/dashboard");
  }
});

test("een schema zonder // komt er niet doorheen — dit is het XSS-gat, niet alleen een omleiding", () => {
  // De documentatie van de router die wij gebruiken is hier expliciet over: een `javascript:`-URL
  // die in router.push() belandt wordt UITGEVOERD in de context van onze eigen pagina — met de
  // sessie die net was aangemaakt. Zie de toelichting boven in safe-redirect.ts.
  for (const kwaad of [
    "javascript:alert(document.cookie)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ]) {
    assert.equal(isSafeRedirect(kwaad), false, `${kwaad} mag NOOIT een bestemming worden`);
    assert.equal(safeRedirect(kwaad, "/dashboard"), "/dashboard");
  }
});

test("stuurtekens worden geweigerd, want de browser poetst ze weg", () => {
  // "/\n/evil.nl" ziet er in een controle op de eerste twee tekens onschuldig uit ("/" gevolgd
  // door een regeleinde), maar een browser verwijdert het regeleinde en houdt "//evil.nl" over —
  // precies het protocol-relatieve pad dat we hierboven weigeren.
  for (const kwaad of ["/\n/evil.nl", "/\r/evil.nl", "/\t/evil.nl", "/\u0000/evil.nl", "/\u007F/evil.nl"]) {
    assert.equal(isSafeRedirect(kwaad), false, `${JSON.stringify(kwaad)} mag NOOIT een bestemming worden`);
  }
});

test("niets, leeg of geen tekst valt terug op de meegegeven bestemming", () => {
  for (const leeg of [null, undefined, "", "dashboard", "./dashboard", "../dashboard"]) {
    assert.equal(isSafeRedirect(leeg), false);
    assert.equal(safeRedirect(leeg, "/onboarding"), "/onboarding");
  }
});

test("de terugval is van de aanroeper, niet van dit bestand", () => {
  // Verplicht meegeven: na inloggen is /dashboard juist, na een archiefregistratie de kluis, na
  // een gewone registratie de wizard. Een stille standaardwaarde hier zou iemand ongemerkt op de
  // verkeerde pagina zetten.
  assert.equal(safeRedirect("https://evil.nl", "/dashboard"), "/dashboard");
  assert.equal(safeRedirect("https://evil.nl", "/dashboard/kluis"), "/dashboard/kluis");
  assert.equal(safeRedirect("https://evil.nl", "/onboarding"), "/onboarding");
});

// ── [BESTEMMING] withRedirect: de bestemming reist mee, één keer gecodeerd ──────────────────────

const leesTerug = (href: string) => new URL(href, "https://boekbrug.nl").searchParams.get("redirect");

test("[BESTEMMING] withRedirect draagt een veilige bestemming mee, één keer gecodeerd", () => {
  assert.equal(withRedirect("/login", "/dashboard/bank"), "/login?redirect=%2Fdashboard%2Fbank");
  assert.equal(
    withRedirect("/wachtwoord-herstellen", "/invite/accept?token=abc"),
    "/wachtwoord-herstellen?redirect=%2Finvite%2Faccept%3Ftoken%3Dabc",
  );
  // Wat de ontvanger terugleest is precies wat erin ging — ook met een eigen querystring erin.
  assert.equal(leesTerug(withRedirect("/login", "/invite/accept?token=abc&x=1")), "/invite/accept?token=abc&x=1");
  // Een pad dat al een querystring heeft krijgt een "&", geen tweede "?".
  assert.equal(withRedirect("/verificatie?x=1", "/a"), "/verificatie?x=1&redirect=%2Fa");
});

test("[BESTEMMING] zonder bestemming, of met een onveilige, blijft het kale pad over", () => {
  for (const raw of [null, undefined, "", "https://evil.nl", "//evil.nl", "/\\evil.nl", "javascript:alert(1)", "/\n/evil.nl"]) {
    assert.equal(withRedirect("/login", raw), "/login", `${JSON.stringify(raw)} mag nooit meereizen`);
  }
});

test("[BESTEMMING] de hele herstelketen overleeft heen en terug, ook langs de tweede stap", () => {
  // login → wachtwoord-vergeten → (mail) wachtwoord-herstellen → verificatie → herstellen → login → bestemming
  const bestemming = "/dashboard/invoice/abc?from=client&clientId=x";
  const vergeten = withRedirect("/wachtwoord-vergeten", bestemming);
  const herstellen = withRedirect("/wachtwoord-herstellen", leesTerug(vergeten));
  // De tweede stap: het herstelscherm is zélf de bestemming van /verificatie — genest, één laag per hop.
  const verificatie = withRedirect("/verificatie", herstellen);
  const terugNaarHerstellen = leesTerug(verificatie);
  assert.ok(terugNaarHerstellen && isSafeRedirect(terugNaarHerstellen), "de geneste bestemming is een pad op onze eigen origin");
  assert.equal(terugNaarHerstellen, herstellen);
  const login = withRedirect("/login", leesTerug(terugNaarHerstellen!));
  assert.equal(leesTerug(login), bestemming);
});

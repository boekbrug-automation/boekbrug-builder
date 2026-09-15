// [LEGAL-IDENTITY] Pure node test — run: npx tsx src/content/legal/company.test.ts
//
// Waarom dit bestaat. De juridische teksten zijn sjablonen: er staat `[JOUW NAAM]` in de bron en de
// bezoeker hoort de ingevulde versie te zien. Dat gaat op precies één manier stuk, en die manier is
// stil — iemand voegt een placeholder toe aan de markdown en vergeet fillCompanyIdentity, of zet
// hem in een document dat die functie nooit aanroept (cookiebeleid.ts doet dat níet). Er komt geen
// foutmelding: er verschijnt een blokhaak op een juridische pagina, en dat merk je pas als een
// bezoeker het meldt.
//
// Daarom controleert deze test de UITVOER van de modules, niet de bron. Wat hier doorheen komt is
// letterlijk wat /voorwaarden, /privacy, /eerlijk-gebruik en /cookies renderen.
import { company, fillCompanyIdentity } from "./company";
import voorwaarden from "./algemene-voorwaarden";
import privacy from "./privacyverklaring";
import eerlijkGebruik from "./eerlijk-gebruik";
import cookiebeleid from "./cookiebeleid";
// [DPA-BEREIKBAAR] The processing agreement is a published page now, so it is held to the
// same rule: not one placeholder may survive onto a document an accountant signs.
import dpa from "./verwerkersovereenkomst";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

/** Elk sjabloonveld in deze repo is HOOFDLETTERS tussen blokhaken: [JOUW NAAM], [INVULLEN]. Een
 *  markdown-link is Titelvorm ([Privacyverklaring](/privacy)) en een invulinstructie aan de lezer
 *  is kleine letters ("AVG-verzoek: [type verzoek]"). Dat onderscheid is het hele filter. */
const PLACEHOLDER = /\[[A-Z][A-Z0-9 /_-]*\]/g;

const DOCS = [
  ["algemene-voorwaarden", voorwaarden],
  ["privacyverklaring", privacy],
  ["eerlijk-gebruik", eerlijkGebruik],
  ["cookiebeleid", cookiebeleid],
  ["verwerkersovereenkomst", dpa],
] as const;

console.log("\n— geen enkele blokhaak haalt een juridische pagina —");
{
  for (const [naam, md] of DOCS) {
    const rest = [...new Set([...md.matchAll(PLACEHOLDER)].map((m) => m[0]))];
    check(`${naam} rendert zonder sjabloonveld${rest.length ? " (blijft staan: " + rest.join(", ") + ")" : ""}`,
      rest.length === 0);
  }
}

console.log("\n— het filter werkt: het ziet een échte fout wel —");
{
  // Zonder deze controle zou een te streng of stuk patroon hierboven altijd slagen, en dan bewaakt
  // de test niets. Dit is dezelfde fout die we willen vangen, met de hand gemaakt.
  const kapot = "## 1. Wie zijn wij?\n\n- **Naam:** [JOUW NIEUWE VELD]\n";
  check("een niet-vervangen veld wordt herkend", PLACEHOLDER.test(kapot));
  PLACEHOLDER.lastIndex = 0;
  check("een markdown-link is géén sjabloonveld", !new RegExp(PLACEHOLDER.source).test("[Privacyverklaring](/privacy)"));
  check("een instructie aan de lezer ook niet", !new RegExp(PLACEHOLDER.source).test('Onderwerp: "Cookies: [jouw vraag]"'));
  check("fillCompanyIdentity laat een ONBEKEND veld staan (het verzint niets)",
    fillCompanyIdentity(kapot).includes("[JOUW NIEUWE VELD]"));
}

console.log("\n— elk veld komt op de juiste waarde uit, niet zomaar op een waarde —");
{
  // KVK en BTW zijn twee verschillende nummers achter twee bijna identieke sjabloonvelden. Ze
  // verwisselen is een fout die je op een juridische pagina niet terugziet, want beide vallen
  // zonder configuratie terug op "(volgt)".
  const probe = fillCompanyIdentity(
    "naam=[JOUW NAAM] naambv=[JOUW NAAM/BV] naamhier=[JOUW NAAM HIER] " +
    "adres=[JOUW ADRES IN TILBURG] plaats=[JOUW PLAATS] " +
    "kvk1=[INVULLEN] kvk2=[INVULLEN ZODRA INGESCHREVEN] btw=[INVULLEN ZODRA TOEGEKEND]",
  );
  check("de drie naamvarianten geven alle drie de handelsnaam",
    probe.includes(`naam=${company.legalName}`) &&
    probe.includes(`naambv=${company.legalName}`) &&
    probe.includes(`naamhier=${company.legalName}`));
  check("adres geeft het adres", probe.includes(`adres=${company.address}`));
  check("plaats geeft de plaats", probe.includes(`plaats=${company.city}`));
  check("beide KVK-velden geven het KVK-nummer",
    probe.includes(`kvk1=${company.kvk}`) && probe.includes(`kvk2=${company.kvk}`));
  check("het BTW-veld geeft het BTW-nummer, niet het KVK-nummer",
    probe.includes(`btw=${company.btw}`));
  check("er blijft niets over", !new RegExp(PLACEHOLDER.source).test(probe));
}

console.log("\n— een leeg veld leest nooit als een echt antwoord —");
{
  // De terugvalwaarden zijn met opzet zichtbaar onaf. Een lege variabele in Vercel (== "" of "  ")
  // moet daarom net zo goed terugvallen: "KVK-nummer: " met niets erachter is erger dan "(volgt)",
  // want het leest als een ontbrekende regel in plaats van als een ontbrekend nummer.
  for (const [veld, waarde] of Object.entries(company)) {
    check(`${veld} is nooit leeg`, typeof waarde === "string" && waarde.trim().length > 0);
  }
  check("een niet-ingevuld KVK-nummer is herkenbaar onaf", /volgt/.test(company.kvk) || /^\d{8}$/.test(company.kvk));
}

console.log("\n— [PLAATS-VOLGT-DE-CONFIG] de vestigingsplaats staat op één plek —");
{
  // Hier stond "Tilburg" twee keer hard in de voorwaarden, terwijl `city` al configureerbaar was en
  // op /steun al werd gevolgd. De tweede was de forumkeuze: een beding dat een rechtbank aanwijst
  // in een arrondissement waar de exploitant niet zit, is het beding waar de wederpartij onderuit
  // komt. Beide volgen nu dezelfde variabele.
  check("de vestigingsplaats in §1 volgt de configuratie",
    voorwaarden.includes(`gevestigd te ${company.city}`));
  check("de forumkeuze wijst dezelfde plaats aan",
    voorwaarden.includes(`bevoegde rechter te ${company.city}`));
  const losseTilburg = company.city === "Tilburg" ? 0 : (voorwaarden.match(/Tilburg/g) ?? []).length;
  check("er staat geen losse plaatsnaam meer naast de configuratie", losseTilburg === 0);
}

console.log("\n— het loket dat de AVG verplicht stelt, staat er ook echt in —");
{
  // Art. 13 AVG vraagt om contactgegevens van de verwerkingsverantwoordelijke. Of dat adres post
  // kan ONTVANGEN is DNS-werk buiten deze repo (zie docs/JOUW_LIJST.md §1 — boekbrug.nl had op
  // 30 juli geen MX-record). Wat een test wél kan vasthouden: dat het adres niet stilletjes uit de
  // tekst verdwijnt bij een herschrijving.
  check("de privacyverklaring noemt een contactadres", /privacy@boekbrug\.nl/.test(privacy));
  check("...ook bij het klachtrecht", /Autoriteit Persoonsgegevens/.test(privacy));
  check("de voorwaarden noemen er een", /@boekbrug\.nl/.test(voorwaarden));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

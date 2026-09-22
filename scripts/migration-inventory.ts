// scripts/migration-inventory.ts
// [MIGRATIE-JOURNAAL] Genereert de inventarisquery uit supabase/migrations/ zelf.
//
// Run: npx tsx scripts/migration-inventory.ts > docs/WELKE_MIGRATIES_STAAN_ER.sql
//
// ── WAAROM DIT BESTAAT ──
//
// docs/WELKE_MIGRATIES_STAAN_ER.sql beantwoordde de goede vraag ("wat staat er ÉCHT in de
// database?") met een lijst die iemand met de hand bijhield. De kop van dat bestand zegt zelf wat
// daar mis mee is, en het zegt het twee keer, want het is twee keer gebeurd:
//
//     "Het ANTWOORD komt uit de database, maar de VRAAG staat hier met de hand in. Een migratie
//      die er niet in staat, kan dit bestand ook niet 'OPEN' noemen."
//
// De ene keer gaf de lijst een schoon "alles toegepast" terug terwijl hij over 17 van de 71
// migraties op schijf ging — en de vier waar de hele betaalkant op leunt stonden er niet in.
// Vandaag dekte hij er 28 van de 104.
//
// Een handmatige lijst OVER een handmatige lijst schiet niet op. Dus wordt de vraag hier
// AFGELEID uit de migratiebestanden, en kan hij per definitie niet achterlopen op de map.
//
// ── WAT EEN "VINGERAFDRUK" IS ──
//
// Per migratie wordt gezocht naar objecten die zij AANMAAKT: een tabel, een kolom, een functie,
// een index, een constraint, een policy. Bestaat dat object, dan is de migratie gedraaid.
//
// Dat is bewust zwakker geformuleerd dan "de migratie liep foutloos". Het CONTROLE-blok onderaan
// elk migratiebestand blijft de plek voor die vraag. Wat hier wordt beantwoord is het verschil
// tussen "ik denk het" en "ik zie het" — en dat is precies wat er ontbrak.
//
// ── DRIE DINGEN DIE DE GENERATOR NIET MAG DOEN ──
//
// 1. GOKKEN. Een migratie die alleen intrekt, hernoemt of commentaar zet (rpc_anon_revoke.sql,
//    function_search_path.sql) maakt niets aan. Die krijgt GEEN verzonnen vingerafdruk maar komt
//    apart te staan als "niet vast te stellen". Een lijst die zwijgt over wat ze niet weet, is de
//    lijst waar dit bestand tegen is geschreven.
//
// 2. LIEGEN OVER OPGERUIMDE OBJECTEN. creditnota_one_per_original.sql maakt de index
//    invoices_one_creditnota_per_original — en creditnota_partial.sql GOOIT DIE WEG. Een naïeve
//    probe noemt de eerste migratie dan 'OPEN' terwijl ze allang gedraaid heeft.
//
//    Maar "wordt ergens gedropt" is als regel te grof, en dat is gemeten: hij haalde drie
//    migraties onterecht onderuit. `DROP POLICY IF EXISTS x; CREATE POLICY x` in ÉÉN bestand is
//    namelijk de gewone idempotente vorm — die policy staat er daarna gewoon. Alleen een DROP
//    door een ANDER bestand dan het bestand dat het object aanmaakt telt als opruimen.
//
// 3. COMMENTAAR MEETELLEN. Uitgecommentarieerde DDL is geen DDL, en dit is geen theorie:
//    accountant_clients_insert_consent.sql draagt een uitgeschreven `CREATE POLICY` in zijn
//    toelichting en maakt zelf niets aan. Zonder het strippen zou die migratie een vingerafdruk
//    krijgen van een voorbeeld en voor altijd als OPEN worden gemeld.

import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";

type Soort = "table" | "column" | "function" | "function_body" | "index" | "constraint" | "constraint_def" | "policy";
interface Probe {
  soort: Soort;
  /** De naam waarop de catalogus wordt bevraagd. Bij een kolom: de kolomnaam. */
  object: string;
  /**
   * Bij een kolom: de tabel waar hij op zit.
   * Bij een 'function_body': de merktekens, met komma's gescheiden — zie herdefinitieProbes().
   */
  tabel?: string;
  /**
   * Het schema. Bijna altijd 'public' — en die "bijna" was een echte fout.
   *
   * documents_shared_and_storage_policies.sql zet drie policies op `storage.objects`, want dat is
   * waar de bestanden staan. Een probe die alleen in `public` keek noemde die migratie voor
   * eeuwig GEDEELTELIJK, hoe goed ze ook gedraaid had — en dat is de duurste soort meting: een
   * alarm dat altijd afgaat, leert iedereen om het weg te klikken.
   */
  schema: string;
}

/**
 * Objecten die WEL worden aangemaakt maar NIETS bewijzen — met de reden erbij.
 *
 * Dit is de enige plek waar met de hand iets aan het oordeel wordt toegevoegd, en dat is met
 * opzet krap gehouden: elke regel hier is een meting die niet meer gedaan wordt, dus hij moet
 * verdiend zijn. De reden staat in de gegenereerde SQL, zodat wie de lijst leest ziet WAAROM er
 * niet naar gekeken wordt, in plaats van dat het object stilletjes verdwijnt.
 *
 * Wat hier NIET thuishoort: een object dat gewoon ontbreekt. Dat hoort OPEN te heten.
 */
const NIETS_BEWIJZEND: Record<string, { object: string; reden: string }[]> = {
  "accountant_directory_publish_requires_client_link.sql": [
    {
      object: "accountant_directory_own_write",
      reden:
        "Deze policy BESTOND al — accountant_directory.sql maakt haar aan. Deze migratie VERVANGT " +
        "haar body (publiceren gaat op bewijs in plaats van op de zelfgekozen rol) en houdt met " +
        "opzet dezelfde naam: twee policies met dezelfde taak onder verschillende namen zou de " +
        "DROP/CREATE-vorm zijn die elders in deze map juist de idempotente standaard is. Haar " +
        "bestaan bewijst dus niets — het antwoord is 'ja, die staat er' ook op de dag VOORDAT deze " +
        "migratie draaide. Wat wél alleen door deze migratie waar wordt is de INHOUD van de twee " +
        "schrijfpolicies, en die staat in STAND_CONTROLE.",
    },
    {
      object: "accountant_directory_own_update",
      reden:
        "Zelfde verhaal als accountant_directory_own_write hierboven: bestond al, wordt vervangen, " +
        "houdt zijn naam. De vraag die er wél toe doet staat in STAND_CONTROLE.",
    },
  ],
  "bank_transactions_column_grant.sql": [
    {
      object: "bank_transactions_update_own",
      reden:
        "Deze policy BESTOND al — ze komt uit de oorspronkelijke dashboard-opzet en staat in geen " +
        "enkele migratie, net als de basispolicies van invoices. De migratie maakt haar opnieuw " +
        "aan omdat ze de hele vorm wil opschrijven die ze achterlaat, niet omdat ze nieuw is. Haar " +
        "bestaan bewijst dus niets: op productie is het antwoord 'ja, die staat er' ook op de dag " +
        "VOORDAT deze migratie ooit draaide. Wat wél alleen door deze migratie waar wordt, is de " +
        "STAND eronder — het kolom-recht en de verdwenen delete-policy — en die staat in " +
        "STAND_CONTROLE.",
    },
  ],
  "documents_content_hash_unique.sql": [
    {
      object: "document_is_referenced",
      reden:
        "Steiger, geen fundament. Deze functie bestaat alleen om binnen DEZE migratie de " +
        "eenmalige dedup-DELETE te rangschikken; geen enkele regel in src/ roept haar aan. Het " +
        "blijvende resultaat is de unieke index uq_documents_user_content_hash, en die staat er. " +
        "Haar afwezigheid betekent dus dat iemand de steiger heeft opgeruimd, niet dat de " +
        "migratie niet liep.",
    },
  ],
  "documents_shared_and_storage_policies.sql": [
    {
      object: "idx_documents_user_content_hash",
      reden:
        "Achterhaald door een LATERE beslissing, en niet door een DROP — daarom ziet de " +
        "supersessie-regel hem niet. Deze niet-unieke index op (user_id, content_hash) is er " +
        "gekomen met het argument dat een UNIQUE de 'nog een keer uploaden'-functie zou breken; " +
        "documents_content_hash_unique.sql heeft die afweging later omgedraaid en zet " +
        "uq_documents_user_content_hash op dezelfde kolommen. Die dekt dezelfde lookups. Hem " +
        "alsnog aanmaken zou een tweede index op dezelfde twee kolommen zijn: schrijfkosten " +
        "zonder leeswinst.",
    },
  ],
};

/**
 * De migraties die NIETS aanmaken — en hoe je ze dan tóch vaststelt.
 *
 * Negen van de migraties trekken alleen rechten in, gooien iets weg, zetten een stand goed of
 * verplaatsen data. Er is geen object waarvan het BESTAAN iets bewijst, dus de vingerafdruk-query
 * hierboven kan er niets over zeggen. Tot nu toe eindigde dat bij een zin: "controleer deze met
 * het CONTROLE-blok onderaan het migratiebestand zelf."
 *
 * Dat is negen bestanden opzoeken, en voor drie ervan stond daar niets. Een verwijzing naar een
 * blok dat niet bestaat is precies het soort stilte waar dit hele bestand tegen is geschreven.
 *
 * Dus staat de vraag hier, per migratie, en wordt zij meegegenereerd als één tweede query. Wat
 * gemeten wordt is niet het BESTAAN van een object maar de STAND: is de policy weg, is de kolom
 * weg, staat de bucket privé, is het recht ingetrokken.
 *
 * Drie soorten, en het verschil is met opzet zichtbaar:
 *
 *   controle    een ja/nee dat een oordeel draagt. TOEGEPAST of OPEN.
 *   meting      een getal om zelf te lezen. Gebruikt waar een uitkomst óók een andere oorzaak kan
 *               hebben dan een niet-gedraaide migratie — een oordeel zou daar een vals alarm zijn,
 *               en een alarm dat soms onterecht afgaat leert iedereen om het weg te klikken.
 *   geen-spoor  de migratie is later ongedaan gemaakt; er valt niets meer te zien. Dan hoort er
 *               een waarschuwing bij, want "OPEN" leest als "nog een keer draaien".
 *
 * Deze tabel is met de hand geschreven, en dat is de reden dat er een slot op zit: een migratie
 * zonder vingerafdruk die hier niet in staat, laat de generator vallen. Een nieuwe REVOKE-migratie
 * kan dus niet stilletjes bij "niet vast te stellen" belanden.
 */
type Stand =
  | { soort: "controle"; vraag: string; sql: string }
  | { soort: "meting"; vraag: string; waarom: string; sql: string }
  | { soort: "geen-spoor"; waarom: string };

const GELDFUNCTIES = [
  "seed_invoice_counter",
  "next_invoice_seq",
  "apply_manual_payment",
  "apply_bank_payment",
  "allocate_bank_payment",
  "confirm_bank_payment",
  "book_bank_batch",
  "move_invoice_payment",
  "recompute_invoice_amount_paid",
  "fair_use_consume",
  "fair_use_release",
  "handle_new_user",
  "assert_credit_within_original",
];
/** De zeven die ook `authenticated` niet meer mag aanroepen — die lopen via service_role. */
const ALLEEN_SERVICE_ROLE = [
  "seed_invoice_counter",
  "recompute_invoice_amount_paid",
  "fair_use_consume",
  "fair_use_release",
  // confirm_bank_payment left this list in september 2026: /api/bank/confirm calls it with the
  // session client again (confirm_bank_payment_regrant.sql).
  "handle_new_user",
  "assert_credit_within_original",
];
const lijst = (namen: string[]) => namen.map((n) => `'${n}'`).join(", ");

/**
 * [ALLOCATIE-DEUR] Functies die meer dan één migratie WOORD VOOR WOORD hetzelfde declareert, en
 * welk bestand daarvan de nieuwste is.
 *
 * Normaal draagt elke herdefinitie de vorige mee en voegt toe, dus de nieuwste is af te leiden uit
 * haar tokens. Sinds [VERPLAATS-TEKEN] de twee kopieën van move_invoice_payment gelijk trok — met
 * opzet, omdat uiteenlopende kopieën betekenden dat de oudste toepassen een levende geldpoort
 * weghaalde — is dat voor die familie niet meer zo. De body wordt op haar merktekens gemeten; wie
 * hem draagt staat hier.
 *
 * Alleen de families die HIER staan worden zo gemeten. Andere identieke paren (de drie bankdeuren
 * tegenover bank_rpc_never_payable_states.sql, book_bank_batch tegenover zijn tweede declaratie)
 * houden de meting die ze hadden: dit lost één regressie op en hermeet de rest niet ongevraagd.
 */
const GELIJKE_BODY_NIEUWSTE: Record<string, { nieuwste: string; kopieen: string[] }> = {
  move_invoice_payment: {
    nieuwste: "invoice_move_payment_creditnota_guard.sql",
    // De kopieën die er OP DIT MOMENT zijn. Komt er een DERDE identieke declaratie bij, dan is de
    // aanwijzing hierboven niet meer per definitie waar — en juist dan kiest apply order stilletjes
    // een winnaar. Het script valt dan om en vraagt om een nieuwe uitspraak, in plaats van de oude
    // op goed geluk door te trekken.
    kopieen: ["invoice_move_payment.sql", "invoice_move_payment_creditnota_guard.sql"],
  },
};

const STAND_CONTROLE: Record<string, Stand> = {
  "accountant_directory_publish_requires_client_link.sql": {
    soort: "controle",
    vraag:
      "een kantoorvermelding wordt alleen openbaar op BEWIJS — een bevestigde klantkoppeling — " +
      "en niet op de zelfgekozen profiles.role, en niemand zit vast in een vermelding die hij " +
      "niet meer weg kan halen",
    // Vier onafhankelijke helften, want elke helft is los terug te draaien zonder dat de andere
    // drie het merken:
    //   · de twee SCHRIJFpolicies moeten op accountant_clients leunen — zonder dat publiceert
    //     elke ingelogde ondernemer zich via de Data API in de lijst van kantoren;
    //   · ze mogen JUIST NIET op profiles leunen. profiles.role is een zelfverklaring die de
    //     eigenaar zelf mag schrijven (profiles_update_own, geen kolomgrens), dus een policy die
    //     hem uitleest bewijst alleen wat de gebruiker over zichzelf heeft ingevuld. Deze regel
    //     staat er omdat precies die versie eerst geschreven is;
    //   · DELETE moet geen bewijs eisen — anders zit een kantoor dat zijn laatste klant verliest
    //     opgesloten in een openbare vermelding die het niet meer kan weghalen;
    //   · en accountant_clients moet ZELF onvervalsbaar blijven: alleen SELECT en DELETE. Komt
    //     daar ooit een INSERT- of UPDATE-policy bij, dan is het bewijs weer een zelfverklaring
    //     en valt de hele grens hierboven stilletjes om. Dat is de dragende AFWEZIGHEID.
    // Gemeten op de policy-EXPRESSIE, niet op de naam: de namen zijn hier juist ongewijzigd.
    sql: `(select count(*) from pg_policy
             where polrelid = 'public.accountant_directory'::regclass
               and polcmd in ('a', 'w')
               and pg_get_expr(polwithcheck, polrelid) like '%accountant_clients%') = 2
          and not exists (
            select 1 from pg_policy
             where polrelid = 'public.accountant_directory'::regclass
               and polcmd in ('a', 'w')
               and pg_get_expr(polwithcheck, polrelid) like '%profiles%')
          and not exists (
            select 1 from pg_policy
             where polrelid = 'public.accountant_directory'::regclass and polcmd = 'd'
               and pg_get_expr(polqual, polrelid) like '%accountant_clients%')
          and not exists (
            select 1 from pg_policy
             where polrelid = 'public.accountant_clients'::regclass
               and polcmd in ('a', 'w'))`,
  },
  "bank_transactions_column_grant.sql": {
    soort: "controle",
    vraag:
      "authenticated mag op bank_transactions nog precies de drie categorie-kolommen UPDATEN en " +
      "geen enkele regel meer verwijderen",
    // Drie onafhankelijke helften, want elke helft afzonderlijk is met de hand terug te draaien
    // zonder dat de andere twee het zien: het recht kan te RUIM staan (een table-wide GRANT zet
    // elke kolom terug), te KRAP (de REVOKE liep, de GRANT niet — dan valt /api/bank/categorize
    // om met 42501), en de delete-policy kan opnieuw zijn aangemaakt.
    sql: `(select count(*) from information_schema.column_privileges
             where table_schema = 'public' and table_name = 'bank_transactions'
               and grantee = 'authenticated' and privilege_type = 'UPDATE') = 3
          and not exists (
            select 1 from information_schema.column_privileges
             where table_schema = 'public' and table_name = 'bank_transactions'
               and grantee = 'authenticated' and privilege_type = 'UPDATE'
               and column_name not in ('category', 'category_source', 'category_confirmed'))
          and not exists (
            select 1 from pg_policy
             where polrelid = 'public.bank_transactions'::regclass and polcmd = 'd')`,
  },
  "drop_supplier_rows_that_are_misreadings.sql": {
    soort: "controle",
    vraag: "geen leveranciersrij houdt nog een nummer vast dat geen rekeningnummer is terwijl niets ernaar wijst",
    // Echte mod-97, geen vormtest: NL36SUME0364345977 en NL36SNSB0363434977 zijn achttien tekens in
    // precies het goede patroon en vallen op de controlecijfers. Een eerdere telling met een regex
    // op de VORM miste ze allebei en rapporteerde er zes in plaats van acht.
    sql: `not exists (
           with schoon as (
             select s.id, upper(regexp_replace(s.iban, '[^A-Za-z0-9]', '', 'g')) as c
               from public.suppliers s where s.iban is not null
           ), cijfers as (
             select h.id, h.c,
                    string_agg(case when t.ch ~ '^[0-9]$' then t.ch else (ascii(t.ch) - 55)::text end,
                               '' order by t.ord) as n
               from (select id, c, substr(c, 5) || substr(c, 1, 4) as r from schoon) h,
                    lateral regexp_split_to_table(h.r, '') with ordinality as t(ch, ord)
              group by h.id, h.c
           )
           select 1 from cijfers v
            where not (length(v.c) = 18 and v.n ~ '^[0-9]+$' and mod(v.n::numeric, 97) = 1)
              and not exists (select 1 from public.invoices i where i.supplier_id = v.id)
              and not exists (select 1 from public.supplier_aliases a where a.supplier_id = v.id))`,
  },
  "invoice_name_follows_taught_supplier.sql": {
    soort: "controle",
    vraag: "geen factuur toont nog een spelling die de eigenaar zelf aan zijn leverancier koppelde",
    // Gekoppeld op printed_name, niet op alias_key: die laatste is de GENORMALISEERDE vorm
    // (supplierNameKey haalt leestekens en rechtsvormen eruit), dus "Silifke / Hocaoglu" staat er
    // als "silifke hocaoglu" en matcht nooit op de naam die op de factuur staat. Een eerdere versie
    // van de migratie deed het wel zo en raakte nul rijen — schoon gedraaid, niets veranderd.
    sql: `not exists (
           select 1
             from public.invoices i
             join public.suppliers s on s.id = i.supplier_id
             join public.supplier_aliases a
               on a.user_id = i.receiver_id
              and a.supplier_id = i.supplier_id
              and lower(btrim(a.printed_name)) = lower(btrim(i.client_name))
            where i.client_name is not null
              and lower(btrim(i.client_name)) is distinct from lower(btrim(s.name)))`,
  },
  "accountant_guard_fixed_search_path.sql": {
    soort: "controle",
    vraag: "de bedragbewaker draait met een vast zoekpad",
    sql: `exists (select 1 from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname = 'prevent_accountant_amount_changes'
                     and 'search_path=public' = any(p.proconfig))`,
  },
  "drop_duplicate_indexes.sql": {
    soort: "controle",
    vraag: "geen twee indexen meer met precies dezelfde vorm op dezelfde tabel",
    sql: `not exists (
           select 1
             from (select i.indrelid, i.indisunique,
                          regexp_replace(pg_get_indexdef(i.indexrelid), '^CREATE (UNIQUE )?INDEX \\S+ ', '') as vorm
                     from pg_index i
                     join pg_class c on c.oid = i.indexrelid
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public') d
            group by indrelid, indisunique, vorm
           having count(*) > 1)`,
  },
  "revoke_execute_on_trigger_functions.sql": {
    soort: "controle",
    vraag: "geen enkele triggerbewaker hangt nog als /rest/v1/rpc aan de buitenkant",
    sql: `not exists (
           select 1 from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('assert_credit_within_rate', 'prevent_verwerkt_invoice_changes',
                                'prevent_accountant_amount_changes', 'guard_paid_when_verwerkt',
                                'assert_bookkeeping_date_sane', 'invoices_search_vector_update')
              and (p.proacl is null
                   or exists (select 1 from aclexplode(p.proacl) a
                               where a.grantee in ('anon'::regrole, 'authenticated'::regrole, 0))))`,
  },
  "rls_initplan_wrap_auth_calls.sql": {
    soort: "controle",
    vraag: "geen policy roept auth.uid() nog per rij aan, en geen enkele is dubbel gewikkeld",
    sql: `not exists (
           select 1 from pg_policies
            where schemaname = 'public'
              and ( (coalesce(qual,'')       like '%auth.uid()%' and coalesce(qual,'')       not like '%SELECT auth.uid()%')
                 or (coalesce(with_check,'') like '%auth.uid()%' and coalesce(with_check,'') not like '%SELECT auth.uid()%')
                 or coalesce(qual,'')       like '%SELECT ( SELECT auth.%'
                 or coalesce(with_check,'') like '%SELECT ( SELECT auth.%' ))`,
  },
  "BRIDGE-D_soft_delete_test_pollution.sql": {
    soort: "controle",
    vraag: "de zes testdocumenten staan in de prullenbak",
    sql: `not exists (
           select 1 from public.documents
            where id in ('45a026eb-59bd-4349-ac10-8251b820978e',
                         '4ba6a60d-f1d9-4bbc-8083-53a1d78b867c',
                         '8cdccc7b-86c2-4d74-ac54-eb5c416caa06',
                         'd2f6abf1-866f-4daa-8862-4c1bfee8fd7f',
                         'e06eaa4e-5f20-4a89-9621-32b821b2bf3f',
                         'f15a973a-30d1-4404-bff0-6d4eade2c93d')
              and trashed is not true)`,
  },
  "anon_mandate_oracle_revoke.sql": {
    soort: "controle",
    vraag: "anon kan de drie machtigings-/eigendomsvragen niet meer stellen — en de klantcheck die {public}-policies nodig hebben staat er nog wél",
    sql: `not has_function_privilege('anon', 'public.has_active_invoice_mandate(uuid,uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.has_active_confirm_mandate(uuid,uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.audit_row_is_about_me(text,uuid,uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.has_active_invoice_mandate(uuid,uuid)', 'EXECUTE')
          and has_function_privilege('anon', 'public.is_my_accountant_client(uuid)', 'EXECUTE')`,
  },
  // [DEFINER-ANON] The state check mirrors the migration's whole contract, not just its
  // headline: anon is gone from both signatures AND authenticated and service_role still hold.
  // Measuring only the revoke would let a later over-eager "harden everything" pass read as
  // TOEGEPAST while it had quietly cut the session client off from the refund flow.
  "anon_revoke_refund_writers.sql": {
    soort: "controle",
    vraag: "anon kan de twee terugbetalingsfuncties niet meer aanroepen — en authenticated en service_role nog wél",
    sql: `not has_function_privilege('anon', 'public.reverse_invoice_payment(uuid,uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.answer_mollie_refund(uuid,text,text,numeric)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.reverse_invoice_payment(uuid,uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.answer_mollie_refund(uuid,text,text,numeric)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.reverse_invoice_payment(uuid,uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.answer_mollie_refund(uuid,text,text,numeric)', 'EXECUTE')`,
  },
  "accountant_clients_insert_consent.sql": {
    soort: "controle",
    vraag: "de oude insert-policy is weg — een boekhouder koppelt zichzelf niet meer aan een klant",
    sql: `not exists (select 1 from pg_policies
                       where schemaname = 'public' and tablename = 'accountant_clients'
                         and policyname = 'accountant_clients_insert')`,
  },
  "accountant_clients_update_consent.sql": {
    soort: "controle",
    vraag: "de oude update-policy is weg",
    sql: `not exists (select 1 from pg_policies
                       where schemaname = 'public' and tablename = 'accountant_clients'
                         and policyname = 'accountant_clients_update')`,
  },
  "bank_tx_invoices_amount.sql": {
    soort: "controle",
    vraag: "de dubbele kolom `amount` is weg en `amount_applied` staat er",
    sql: `exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'bank_tx_invoices'
                     and column_name = 'amount_applied')
          and not exists (select 1 from information_schema.columns
                           where table_schema = 'public' and table_name = 'bank_tx_invoices'
                             and column_name = 'amount')`,
  },
  "creditnota_one_per_original.sql": {
    soort: "geen-spoor",
    waarom:
      "Deze migratie maakte de unieke index invoices_one_creditnota_per_original — één creditnota " +
      "per factuur. creditnota_partial.sql heeft die er later met opzet weer afgehaald, want een " +
      "factuur mag meer dan één DEELcreditnota dragen. Er is dus niets meer van te zien, en dat " +
      "hoort zo. NIET OPNIEUW DRAAIEN: de index terugzetten breekt de tweede deelcreditnota op " +
      "elke factuur. Wat er in de plaats van staat is public.assert_credit_within_original(), en " +
      "die wordt hierboven bij creditnota_partial.sql wél gemeten.",
  },
  "function_search_path.sql": {
    soort: "controle",
    vraag: "elk van de negen functies heeft een vastgezet search_path",
    sql: `not exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('prevent_billing_self_grant', 'prevent_accountant_amount_changes',
                                'prevent_verwerkt_invoice_changes', 'guard_paid_when_verwerkt',
                                'invoices_search_vector_update', 'documents_search_vector_update',
                                'set_updated_at', 'touch_updated_at', 'get_accountant_for_zzper')
              and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=%')`,
  },
  "rpc_anon_revoke.sql": {
    soort: "controle",
    vraag: "geen enkele geldfunctie is nog aan te roepen door anon, en zes ook niet door authenticated",
    sql: `not exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (${lijst(GELDFUNCTIES)})
              and has_function_privilege('anon', p.oid, 'EXECUTE'))
          and not exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (${lijst(ALLEEN_SERVICE_ROLE)})
              and has_function_privilege('authenticated', p.oid, 'EXECUTE'))`,
  },
  "confirm_bank_payment_regrant.sql": {
    soort: "controle",
    vraag: "confirm_bank_payment is weer aan te roepen door authenticated, en nog steeds niet door anon",
    sql: `exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'confirm_bank_payment'
              and has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and not has_function_privilege('anon', p.oid, 'EXECUTE'))`,
  },
  "welcome_grant_retired.sql": {
    soort: "controle",
    vraag:
      "de welkomsttrigger staat niet meer op profiles, terwijl de functie die hij aanriep er nog " +
      "wél is",
    // Twee helften, want elke helft afzonderlijk is een andere toestand dan wat dit bestand maakt.
    // De trigger terug betekent dat nieuwe accounts weer 90 dagen Plus krijgen — precies wat de
    // commerciële beslissing van 17 september intrekt, en zichtbaar pas 90 dagen later. De functie
    // WEG betekent dat iemand verder ging dan deze migratie: de toekenningen die zij schreef staan
    // nog in plan_grants en blijven leesbaar, en het terugzetten van de trigger is één CREATE
    // TRIGGER — dat is alleen waar zolang de body bestaat.
    sql: `not exists (
           select 1 from pg_trigger
            where tgrelid = 'public.profiles'::regclass
              and tgname = 'profiles_welcome_plus' and not tgisinternal)
          and exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'grant_welcome_plus')`,
  },
  "storage_bucket_hardening.sql": {
    soort: "controle",
    vraag: "de documentenbucket staat privé, met een limiet van 25 MB en RLS aan",
    sql: `exists (select 1 from storage.buckets
                   where id = 'documents' and public is false
                     and file_size_limit is not null and file_size_limit <= 26214400)
          and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity)`,
  },
  "supplier_backfill.sql": {
    soort: "meting",
    vraag: "hoeveel inkoopfacturen mét IBAN nog zonder leverancier staan",
    waarom:
      "Dit is geen oordeel, want de app schrijft dezelfde kolom als de backfill. Een inkoopfactuur " +
      "die vandaag binnenkomt zonder herkende leverancier staat hier morgen ook in — die zegt niets " +
      "over deze migratie. Nul betekent 'gedraaid én bijgehouden'. Een klein getal met verse datums " +
      "is nieuwe post, geen mislukte migratie. Alleen een groot getal met datums van vóór de " +
      "livegang wijst terug naar dit bestand.",
    sql: `select count(*) as zonder_leverancier, min(created_at) as oudste
            from public.invoices
           where direction = 'incoming'
             and status in ('processing', 'received')
             and vendor_iban is not null
             and length(regexp_replace(vendor_iban, '\\s', '', 'g')) >= 15
             and supplier_id is null`,
  },
};

/** SQL-commentaar eraf. Uitgecommentarieerde DDL is geen DDL. */
function stripSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Alles wat dit bestand AANMAAKT. */
function probesOf(sql: string): Probe[] {
  const out: Probe[] = [];
  const push = (p: Probe) => {
    if (!out.some((q) => q.soort === p.soort && q.object === p.object && q.tabel === p.tabel)) out.push(p);
  };

  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:([a-z0-9_]+)\.)?"?([a-z0-9_]+)"?/gi)) {
    push({ soort: "table", object: m[2], schema: m[1] ?? "public" });
  }
  // Een ALTER TABLE kan meerdere ADD COLUMNs dragen; de tabelnaam geldt tot de volgende ALTER.
  for (const blok of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:([a-z0-9_]+)\.)?"?([a-z0-9_]+)"?([\s\S]*?)(?=alter\s+table|create\s+|do\s+\$\$|$)/gi)) {
    const schema = blok[1] ?? "public";
    const tabel = blok[2];
    for (const kol of blok[3].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi)) {
      push({ soort: "column", object: kol[1], tabel, schema });
    }
    for (const con of blok[3].matchAll(/add\s+constraint\s+"?([a-z0-9_]+)"?/gi)) {
      push({ soort: "constraint", object: con[1], schema });
    }
  }
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:([a-z0-9_]+)\.)?"?([a-z0-9_]+)"?\s*\(/gi)) {
    push({ soort: "function", object: m[2], schema: m[1] ?? "public" });
  }
  // `... ON [schema.]tabel` bepaalt het schema van een index, niet de indexnaam zelf.
  for (const m of sql.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?\s+on\s+(?:([a-z0-9_]+)\.)?"?[a-z0-9_]+"?/gi)) {
    push({ soort: "index", object: m[1], schema: m[2] ?? "public" });
  }
  // Idem voor een policy — en juist hier zat de fout: drie policies staan op storage.objects.
  for (const m of sql.matchAll(/create\s+policy\s+"?([a-z0-9_ ]+?)"?\s+on\s+(?:([a-z0-9_]+)\.)?"?([a-z0-9_]+)"?/gi)) {
    push({ soort: "policy", object: m[1].trim(), tabel: m[3], schema: m[2] ?? "public" });
  }
  return out;
}

/**
 * De body van elke functie die dit bestand definieert, op naam.
 *
 * Het dollar-teken mag een label dragen ($function$, $fn$, $$) en dat wisselt per bestand, dus de
 * sluiter wordt uit de opener afgeleid in plaats van op $$ gegokt — accountant_vat_deduction_guard
 * gebruikt $function$, en een probe die alleen $$ kende zag die body niet.
 */
function functieBodies(sql: string): Map<string, string> {
  const uit = new Map<string, string>();
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:([a-z0-9_]+)\.)?"?([a-z0-9_]+)"?\s*\(/gi)) {
    const rest = sql.slice(m.index! + m[0].length);
    const open = /\$([a-z0-9_]*)\$/i.exec(rest);
    if (!open) continue;
    const na = rest.slice(open.index + open[0].length);
    const eind = na.indexOf(open[0]);
    if (eind < 0) continue;
    const naam = m[2].toLowerCase();
    uit.set(naam, (uit.get(naam) ?? "") + na.slice(0, eind));
  }
  return uit;
}

/**
 * ── WAAROM EEN HERDEFINITIE EEN ANDERE PROBE NODIG HEEFT ──
 *
 * Negen migratiebestanden herdefiniëren prevent_accountant_amount_changes. Acht ervan konden
 * elkaar niet bewijzen: de probe vroeg of de FUNCTIE bestaat, en dat deed ze al sinds de eerste.
 * Dus meldde dit rapport ze alle negen als TOEGEPAST — terwijl in de productiedatabase de
 * beschermde kolommen `vat_deduction`, `discount_type` en `discount_value` ontbraken. Twee
 * beveiligingsmigraties lagen weken klaar, gemeld aan de eigenaar, en het enige gereedschap dat
 * de vraag "wat moet er nog?" beantwoordt zei dat ze gedraaid waren.
 *
 * Dat is precies de kwaal waar de kop van dit bestand over gaat, één niveau dieper: niet de VRAAG
 * liep achter op de map, maar het ANTWOORD op de vraag. Bestaan is geen bewijs zodra meer dan één
 * bestand hetzelfde object schrijft.
 *
 * ── WAT ER NU WORDT GEMETEN ──
 *
 * De KOLOMVERWIJZINGEN (`NEW.x` / `OLD.x`) die ELKE huidige definitie van die functie bevat. Dat
 * is wat de map vandaag unaniem zegt dat er in die functie hoort te staan, ongeacht welk bestand
 * je opslaat. Mist de body in de database er ook maar één van, dan loopt de functie achter op de
 * map en zeggen alle bestanden die haar definiëren dat.
 *
 * De doorsnede en niet de vereniging, met opzet: de vereniging zou een kolom bevatten die één
 * bestand bewust heeft LATEN VALLEN, en dan gaat er een alarm af dat nooit meer uitgaat — en een
 * alarm dat altijd afgaat leert iedereen om het weg te klikken.
 *
 * Het merkteken is `.kolomnaam` mét de punt, zodat een kolomnaam die in een TOELICHTING wordt
 * genoemd ("de kolom vat_deduction bepaalt…") niet meetelt als bewijs dat de code er staat.
 *
 * Functies die door één bestand worden gedefinieerd houden de gewone bestaansprobe: daar IS het
 * bestaan het bewijs. Functies met meerdere definities maar zonder gedeelde kolomverwijzing (geen
 * triggerfunctie) houden hem ook — met een regel in DEEL 3, zodat de lijst zegt wat ze niet weet.
 */
function herdefinitieMerken(alle: { bestand: string; sql: string }[]): {
  merken: Map<string, string[]>;
  /** Functies zonder gedeelde kolom, waar één versie de nieuwste blijkt: alleen ZIJ wordt gemeten. */
  nieuwste: Map<string, { bestand: string; merken: string[] }>;
  onbeslist: { functie: string; bestanden: string[] }[];
} {
  const perFunctie = new Map<string, Map<string, string>>();
  for (const { bestand, sql } of alle) {
    for (const [naam, body] of functieBodies(sql)) {
      if (!perFunctie.has(naam)) perFunctie.set(naam, new Map());
      perFunctie.get(naam)!.set(bestand, body);
    }
  }
  const merken = new Map<string, string[]>();
  const nieuwste = new Map<string, { bestand: string; merken: string[] }>();
  const onbeslist: { functie: string; bestanden: string[] }[] = [];
  for (const [naam, byFile] of [...perFunctie].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (byFile.size < 2) continue;
    let gedeeld: Set<string> | null = null;
    for (const body of byFile.values()) {
      const kolommen = new Set<string>();
      for (const k of body.matchAll(/\b(?:new|old)\.([a-z0-9_]+)/gi)) kolommen.add(k[1].toLowerCase());
      const tot: Set<string> = gedeeld ?? kolommen;
      gedeeld = gedeeld === null ? kolommen : new Set([...tot].filter((k) => kolommen.has(k)));
    }
    const lijst = [...(gedeeld ?? [])].sort();
    if (lijst.length > 0) {
      merken.set(naam, lijst.map((k) => `.${k}`));
      continue;
    }

    // ── Twee kopieën die WOORD VOOR WOORD hetzelfde zeggen ─────────────────────────────────────
    //
    // [ALLOCATIE-DEUR] Dit was geen bestaand geval en werd er één: [VERPLAATS-TEKEN] maakte de twee
    // declaraties van move_invoice_payment byte-identiek, met opzet — zolang ze uiteenliepen kon
    // het toepassen van de OUDSTE een levende geldpoort weghalen.
    //
    // De bovenverzameling-truc hieronder kan daar niet mee overweg: hij zoekt de versie die strikt
    // MEER tokens heeft, en bij gelijke bodies bestaat die niet. De functie viel daardoor terug op
    // BESTAAN, wat precies de meting is die twee migraties ooit als toegepast meldde terwijl ze niet
    // gedraaid waren.
    //
    // Bij gelijke bodies is er ook niets te onderscheiden TUSSEN de bestanden — ze zeggen hetzelfde,
    // dus welk bestand de probe draagt maakt niet uit. Wat wél onderscheiden moet worden is de
    // repo-body van wat er in de DATABASE staat, en daarvoor gebruiken we de merktekens die dit
    // project overal zet: [ZO-IETS] in de body zelf. Staan ze in prosrc, dan draait deze body.
    //
    // Welk BESTAND de nieuwste is, valt uit gelijke tekst niet af te leiden — en raden is hier het
    // verkeerde antwoord: de oudere houdt haar bestaansprobe (ingehaald is niet ongedraaid), dus
    // een verkeerde gok zet OPEN bij een migratie die allang gedraaid is. Daarom staat het
    // hieronder opgeschreven, net als NIETS_BEWIJZEND en STAND_CONTROLE. Een nieuwe familie die
    // hier niet in staat laat het script vallen in plaats van te kiezen.
    const bodies = [...byFile.values()];
    const afspraak = GELIJKE_BODY_NIEUWSTE[naam];
    if (afspraak && bodies.length > 1 && bodies.every((b) => b === bodies[0])) {
      const gevonden = [...byFile.keys()].sort();
      const afgesproken = [...afspraak.kopieen].sort();
      if (gevonden.join("|") !== afgesproken.join("|")) {
        throw new Error(
          `${naam} wordt nu door ANDERE bestanden identiek gedeclareerd dan GELIJKE_BODY_NIEUWSTE ` +
          `vastlegt. Welke de nieuwste is, is uit gelijke tekst niet af te leiden, dus dit moet ` +
          `opnieuw worden uitgesproken — niet doorgetrokken.\n  afgesproken: ${afgesproken.join(", ")}` +
          `\n  gevonden:    ${gevonden.join(", ")}`);
      }
      const nieuwsteBestand = afspraak.nieuwste;
      if (!byFile.has(nieuwsteBestand)) {
        throw new Error(`GELIJKE_BODY_NIEUWSTE wijst ${naam} naar ${nieuwsteBestand}, dat deze functie niet declareert`);
      }
      const markers = [...new Set([...bodies[0].matchAll(/\[([A-Z][A-Z0-9-]{2,})\]/g)].map((m) => m[1]))].sort();
      if (markers.length > 0) {
        nieuwste.set(naam, { bestand: nieuwsteBestand, merken: markers.map((m) => `[${m}]`) });
        continue;
      }
    }

    // ── Geen gedeelde kolomverwijzing: geen triggerfunctie ──────────────────────────────────────
    //
    // De doorsnede is per definitie BLIND voor wat alleen de nieuwste versie toevoegt, en dat is
    // precies wat je wilt weten. Twee migraties stonden daardoor als TOEGEPAST gemeld terwijl ze
    // niet gedraaid waren: invoice_payment_date_rederive.sql (recompute_invoice_amount_paid leidt
    // de betaaldatum niet opnieuw af) en invoice_move_payment_creditnota_guard.sql (een betaling
    // verplaatsen kent de creditnota niet). Die tweede is een geldpoort.
    //
    // Zonder volgorde in de map is "de nieuwste" niet gegeven — maar in deze familie is ze wel af
    // te leiden: elke herdefinitie draagt de vorige mee en voegt toe, dus de nieuwste is de versie
    // wier tokens een ECHTE bovenverzameling van alle andere zijn. Is er zo'n unieke maximale
    // versie, dan wordt zij gemeten op wat alleen zij toevoegt; is die er niet, dan zwijgt de
    // lijst er expliciet over in plaats van te gokken.
    const tokensVan = (body: string): Set<string> =>
      new Set([...body.matchAll(/[a-z_][a-z0-9_]{3,}/gi)].map((m) => m[0].toLowerCase()));
    const perBestand = new Map([...byFile].map(([f, b]) => [f, tokensVan(b)] as const));
    let maximaal: string | null = null;
    for (const [f, toks] of perBestand) {
      const isBoven = [...perBestand].every(([g, andere]) =>
        g === f || ([...andere].every((t) => toks.has(t)) && toks.size > andere.size));
      if (isBoven) { maximaal = maximaal === null ? f : "" ; }
    }
    if (!maximaal) {
      onbeslist.push({ functie: naam, bestanden: [...byFile.keys()].sort() });
      continue;
    }
    const anderen = new Set<string>();
    for (const [f, toks] of perBestand) if (f !== maximaal) for (const t of toks) anderen.add(t);
    // Een merkteken moet ergens naar VERWIJZEN. `false`, `order` en `limit` zijn ook uniek aan een
    // versie en zeggen niets; een naam met een underscore of van acht tekens is een identifier.
    // Vorm, geen woordenlijst — een lijst met verboden woorden loopt achter zoals elke andere.
    const uniek = [...perBestand.get(maximaal)!]
      .filter((t) => !anderen.has(t))
      .filter((t) => t.includes("_") || t.length >= 8)
      .sort();
    if (uniek.length === 0) {
      onbeslist.push({ functie: naam, bestanden: [...byFile.keys()].sort() });
      continue;
    }
    // Hooguit drie: één ontbrekend merkteken zegt al genoeg, en de lijst blijft leesbaar.
    nieuwste.set(naam, { bestand: maximaal, merken: uniek.slice(0, 3) });
  }
  return { merken, nieuwste, onbeslist };
}

/**
 * Objecten die door een ANDER bestand worden weggegooid dan het bestand dat ze aanmaakt.
 *
 * Het onderscheid is de hele kunst hier. `DROP POLICY IF EXISTS x; CREATE POLICY x` in ÉÉN bestand
 * is de gewone idempotente vorm — die policy bestaat daarna gewoon, en meetellen als "opgeruimd"
 * zou drie migraties ten onrechte onvindbaar maken (dat gebeurde bij de eerste versie hiervan).
 *
 * Echt opgeruimd is alleen wat een ander bestand weggooit: creditnota_partial.sql laat de index
 * invoices_one_creditnota_per_original vallen die creditnota_one_per_original.sql aanmaakte. Die
 * index is er niet meer, en dat zegt niets over of die migratie ooit gedraaid heeft.
 */
function supersededNames(alle: { bestand: string; sql: string }[]): Set<string> {
  const gemaaktDoor = new Map<string, Set<string>>();
  const gedroptDoor = new Map<string, Set<string>>();
  const noteer = (kaart: Map<string, Set<string>>, naam: string, bestand: string) => {
    const k = naam.toLowerCase();
    if (!kaart.has(k)) kaart.set(k, new Set());
    kaart.get(k)!.add(bestand);
  };

  for (const { bestand, sql } of alle) {
    for (const p of probesOf(sql)) noteer(gemaaktDoor, p.object, bestand);
    for (const m of sql.matchAll(/drop\s+(?:table|index|function|policy)\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
      noteer(gedroptDoor, m[1], bestand);
    }
    // DROP POLICY "naam" ON tabel — een policynaam mag spaties bevatten.
    for (const m of sql.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"/gi)) {
      noteer(gedroptDoor, m[1], bestand);
    }
  }

  const weg = new Set<string>();
  for (const [naam, droppers] of gedroptDoor) {
    const makers = gemaaktDoor.get(naam) ?? new Set<string>();
    // Eén dropper die het object zelf niet aanmaakt, is genoeg.
    if ([...droppers].some((f) => !makers.has(f))) weg.add(naam);
  }
  return weg;
}

/**
 * [CONSTRAINT-HERDEFINITIE] A constraint that more than one file writes under the same name.
 *
 * The same disease as the functions above, one object kind further: vat_reverse_charge.sql drops
 * invoice_lines_vat_treatment_check and adds it again with a third admitted value. The object
 * exists before and after, so an existence probe reported the new migration as applied on every
 * database where only the old one had run. Measured instead is the DEFINITION: every string
 * literal the file's own ADD CONSTRAINT clause names must appear in pg_get_constraintdef. The
 * older file keeps its own literals, which the newer definition still carries — superseded is not
 * unrun, and OPEN would be the wrong word for it.
 *
 * Returns, per constraint name written by ≥ 2 files, each file's literals.
 */
function constraintHerdefinities(alle: { bestand: string; sql: string }[]): Map<string, Map<string, string[]>> {
  const perNaam = new Map<string, Map<string, string[]>>();
  for (const { bestand, sql } of alle) {
    for (const m of sql.matchAll(/add\s+constraint\s+"?([a-z0-9_]+)"?([\s\S]*?);/gi)) {
      const naam = m[1].toLowerCase();
      // Bare values; the query quotes them (quote_literal), so the generated row stays readable.
      const literals = [...new Set([...m[2].matchAll(/'([a-z0-9_]+)'/gi)].map((l) => l[1]))].sort();
      if (!perNaam.has(naam)) perNaam.set(naam, new Map());
      perNaam.get(naam)!.set(bestand, literals);
    }
  }
  return new Map([...perNaam].filter(([, byFile]) => byFile.size >= 2));
}

const bestanden = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const gelezen = bestanden.map((f) => ({ bestand: f, sql: stripSql(readFileSync(`${DIR}/${f}`, "utf8")) }));
// Constraints that more than one file writes under one name: measured on their definition.
const constraintMerken = constraintHerdefinities(gelezen);
const weggegooid = supersededNames(gelezen);
// Functies die meer dan één bestand schrijft: daar bewijst BESTAAN niets. Zie herdefinitieMerken().
const { merken: functieMerken, nieuwste: functieNieuwste, onbeslist: onbesliste } = herdefinitieMerken(gelezen);

const rijen: string[] = [];
const zonderVingerafdruk: string[] = [];
const opgeruimd: string[] = [];

const nietsBewijzend: string[] = [];

for (const { bestand, sql } of gelezen) {
  const probes = probesOf(sql);
  const genegeerd = new Map((NIETS_BEWIJZEND[bestand] ?? []).map((o) => [o.object.toLowerCase(), o.reden]));
  const bruikbaar = probes
    .filter((p) => !weggegooid.has(p.object.toLowerCase()) && !genegeerd.has(p.object.toLowerCase()))
    // Een functie die meerdere bestanden herschrijven wordt op haar INHOUD bevraagd, niet op haar
    // bestaan — anders melden acht herdefinities elkaar als bewijs. De merktekens reizen in het
    // tabel-veld mee; de query eronder splitst ze weer.
    .map((p) => {
      // [CONSTRAINT-HERDEFINITIE] Same name in more than one file: the definition is measured.
      if (p.soort === "constraint") {
        const mk = constraintMerken.get(p.object.toLowerCase())?.get(bestand);
        return mk && mk.length > 0 ? { ...p, soort: "constraint_def" as Soort, tabel: mk.join(",") } : p;
      }
      if (p.soort !== "function") return p;
      const mk = functieMerken.get(p.object.toLowerCase());
      if (mk) return { ...p, soort: "function_body" as Soort, tabel: mk.join(",") };
      // Geen gedeelde kolom, maar wél een aanwijsbaar nieuwste versie: alleen DIE wordt op haar
      // eigen toevoeging gemeten. De oudere bestanden houden hun bestaansprobe — zij zijn
      // ingehaald, niet ongedraaid, en dat verschil hoort niet als OPEN te lezen.
      const nw = functieNieuwste.get(p.object.toLowerCase());
      if (nw && nw.bestand === bestand) return { ...p, soort: "function_body" as Soort, tabel: nw.merken.join(",") };
      return p;
    });
  const verloren = probes.filter((p) => weggegooid.has(p.object.toLowerCase()));
  for (const p of verloren) opgeruimd.push(`${bestand} → ${p.soort} ${p.object}`);
  for (const [obj, reden] of genegeerd) nietsBewijzend.push(`${bestand} → ${obj}\n--       ${reden}`);

  if (bruikbaar.length === 0) {
    zonderVingerafdruk.push(bestand);
    continue;
  }
  // Hooguit zes, en deterministisch gekozen, zodat de gegenereerde SQL niet wappert tussen runs.
  //
  // Behalve een 'function_body': die overleeft het plafond altijd. Hij bestaat juist omdát bestaan
  // niet genoeg was, en het plafond koos alfabetisch — dus bij vat_exemption.sql vulden zes gewone
  // kolom- en constraint-probes de zes plekken en viel de body-meting eruit. Een plafond dat precies
  // de scherpste meting afkapt, is een stille afknotting van hetzelfde soort als de kwaal.
  const gesorteerd = bruikbaar
    .slice()
    .sort((a, b) => (a.soort + a.object).localeCompare(b.soort + b.object));
  const body = gesorteerd.filter((p) => p.soort === "function_body" || p.soort === "constraint_def");
  const rest = gesorteerd.filter((p) => p.soort !== "function_body" && p.soort !== "constraint_def");
  const gekozen = [...body, ...rest.slice(0, Math.max(0, 6 - body.length))];
  for (const p of gekozen) {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    rijen.push(
      `  (${q(bestand)}, ${q(p.soort)}, ${q(p.object)}, ${p.tabel ? q(p.tabel) : "null"}, ${q(p.schema)})`,
    );
  }
}

// ── HET SLOT OP STAND_CONTROLE ───────────────────────────────────────────────
//
// Een migratie zonder vingerafdruk MOET hier een antwoord hebben. Anders kan een nieuwe
// REVOKE- of UPDATE-migratie stilletjes bij "niet vast te stellen" belanden en daar blijven —
// wat precies de stilte is die dit bestand moet uitsluiten.
//
// En andersom: een regel over een migratie die inmiddels wél een object aanmaakt, meet twee keer
// hetzelfde en gaat de ene keer achterlopen. Ook dat valt hier om.
{
  const zonderAntwoord = zonderVingerafdruk.filter((f) => !STAND_CONTROLE[f]);
  if (zonderAntwoord.length > 0) {
    throw new Error(
      "Deze migraties maken niets aan en hebben geen stand-controle in STAND_CONTROLE " +
        "(scripts/migration-inventory.ts). Schrijf per bestand hoe je vaststelt DAT hij gedraaid " +
        "heeft — een policy die weg is, een recht dat is ingetrokken, een stand die goed staat:\n  " +
        zonderAntwoord.join("\n  "),
    );
  }
  const overbodig = Object.keys(STAND_CONTROLE).filter((f) => !zonderVingerafdruk.includes(f));
  if (overbodig.length > 0) {
    throw new Error(
      "Deze bestanden staan in STAND_CONTROLE maar hebben inmiddels een gewone vingerafdruk. " +
        "Haal ze uit de tabel; twee metingen op hetzelfde gaan uit elkaar lopen:\n  " +
        overbodig.join("\n  "),
    );
  }
}

const lijnen: string[] = [];
const zeg = (s = "") => lijnen.push(s);
/**
 * Haalt de gemeenschappelijke inspringing van een SQL-blok af en zet er een nieuwe voor in de
 * plaats. Per regel trimmen zou de structuur van een genest EXISTS plat slaan — en een query die
 * niemand kan lezen, controleert niemand.
 */
function inspringen(sql: string, breedte: number): string[] {
  const regels = sql.split("\n");
  // De EERSTE regel staat in de bron direct achter het aanhalingsteken en heeft dus geen
  // inspringing. Hem meetellen maakt de marge nul, en dan blijft de rest scheef staan.
  const rest = regels.slice(1).filter((r) => r.trim() !== "");
  const marge = rest.length === 0 ? 0 : Math.min(...rest.map((r) => r.length - r.trimStart().length));
  const voor = " ".repeat(breedte);
  return regels.map((r, i) =>
    r.trim() === "" ? "" : i === 0 ? voor + r.trim() : voor + r.slice(marge),
  );
}

/** Breekt een lange reden af op woordgrenzen, zodat de gegenereerde SQL leesbaar blijft. */
function wikkel(tekst: string, breedte: number): string[] {
  const uit: string[] = [];
  let regel = "";
  for (const woord of tekst.split(/\s+/)) {
    if (regel === "") regel = woord;
    else if (regel.length + 1 + woord.length <= breedte) regel += ` ${woord}`;
    else { uit.push(regel); regel = woord; }
  }
  if (regel !== "") uit.push(regel);
  return uit;
}

zeg("-- =====================================================================");
zeg("-- WELKE MIGRATIES STAAN ER ÉCHT? — één query, het echte antwoord.");
zeg("-- BoekBrug · automatisch gegenereerd, NIET met de hand bijwerken.");
zeg("-- =====================================================================");
zeg("--");
zeg("-- GEGENEREERD DOOR: scripts/migration-inventory.ts");
zeg("--   npx tsx scripts/migration-inventory.ts > docs/WELKE_MIGRATIES_STAAN_ER.sql");
zeg("--");
zeg("-- Handmatige wijzigingen gaan bij de eerstvolgende run verloren, en een poort in");
zeg("-- lifecycle-gates.test.ts faalt zodra dit bestand niet meer overeenkomt met de map.");
zeg("--");
zeg("-- ── WAAROM GEGENEREERD ──");
zeg("--");
zeg("-- De vorige versie stelde de goede vraag met een lijst die iemand met de hand bijhield, en");
zeg("-- zei daar zelf over: \"Het ANTWOORD komt uit de database, maar de VRAAG staat hier met de");
zeg("-- hand in. Een migratie die er niet in staat, kan dit bestand ook niet 'OPEN' noemen.\" Dat is");
zeg("-- twee keer misgegaan — één keer dekte de lijst 17 van 71 migraties en gaf een schoon \"alles");
zeg("-- toegepast\" terug, met de vier waar de betaalkant op leunt er niet in.");
zeg("--");
zeg("-- Nu wordt de vraag AFGELEID uit supabase/migrations/, en kan hij niet achterlopen op de map.");
zeg("--");
zeg("-- ── WAT DE UITKOMST BETEKENT ──");
zeg("--");
zeg("--   TOEGEPAST     elk object dat deze migratie aanmaakt, bestaat.");
zeg("--   GEDEELTELIJK  sommige wel, sommige niet. Dit is het gevaarlijke geval: de migratie is");
zeg("--                 halverwege gestopt. Lees het CONTROLE-blok onderaan dát migratiebestand.");
zeg("--   OPEN          geen enkel object bestaat.");
zeg("--");
zeg("-- \"TOEGEPAST\" bewijst dat de migratie GEDRAAID heeft, niet dat ze FOUTLOOS liep. Daarvoor is");
zeg("-- het CONTROLE-blok onderaan het migratiebestand zelf.");
zeg("--");
zeg("-- ── TWEE QUERY\'S, WANT ER ZIJN TWEE SOORTEN MIGRATIES ──");
zeg("--");
zeg(`--   DEEL 1  de ${bestanden.length - zonderVingerafdruk.length} migraties die iets AANMAKEN. Bestaat het object, dan is ze gedraaid.`);
zeg(`--   DEEL 2  de ${zonderVingerafdruk.length} die niets aanmaken — alleen rechten intrekken, iets weggooien of een`);
zeg("--           stand goed zetten. Daar wordt de STAND gemeten in plaats van het bestaan.");
zeg("--");
zeg("-- Draai ze allebei. Deel 1 alleen is een schoon rapport met twee veiligheidsmigraties er");
zeg("-- buiten: staat de documentenbucket privé, en mag anon de geldfuncties nog aanroepen.");
zeg("--");
zeg("-- Leest alleen de catalogus. Verandert niets. Draai hem als service_role in de SQL-editor.");
zeg("-- =====================================================================");
zeg();
zeg("-- ── DEEL 1 ──────────────────────────────────────────────────────────");
zeg();
zeg("with probe(bestand, soort, object, tabel, schema) as (values");
zeg(rijen.join(",\n"));
zeg("),");
zeg("bevonden as (");
zeg("  select p.*,");
zeg("    case p.soort");
zeg("      when 'table' then exists (select 1 from information_schema.tables");
zeg("             where table_schema = p.schema and table_name = p.object)");
zeg("      when 'column' then exists (select 1 from information_schema.columns");
zeg("             where table_schema = p.schema and table_name = p.tabel and column_name = p.object)");
zeg("      when 'function' then exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace");
zeg("             where n.nspname = p.schema and f.proname = p.object)");
zeg("      -- Een functie die meer dan één migratie herschrijft: haar BESTAAN bewijst alleen dat");
zeg("      -- de eerste van die migraties gedraaid heeft. Gemeten wordt daarom de body — elke");
zeg("      -- kolomverwijzing die de map unaniem in deze functie verwacht, moet erin staan.");
zeg("      when 'function_body' then exists (");
zeg("             select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace");
zeg("             where n.nspname = p.schema and f.proname = p.object");
zeg("               and not exists (select 1 from unnest(string_to_array(p.tabel, ',')) mk");
zeg("                               where position(mk in f.prosrc) = 0))");
zeg("      when 'index' then exists (select 1 from pg_indexes");
zeg("             where schemaname = p.schema and indexname = p.object)");
zeg("      when 'constraint' then exists (select 1 from pg_constraint where conname = p.object)");
zeg("      -- Een constraint die meer dan één migratie onder dezelfde naam schrijft: haar BESTAAN");
zeg("      -- bewijst alleen de eerste. Gemeten wordt de definitie — elke waarde die dit bestand");
zeg("      -- zelf in de CHECK noemt, moet erin staan.");
zeg("      when 'constraint_def' then exists (");
zeg("             select 1 from pg_constraint c where c.conname = p.object");
zeg("               and not exists (select 1 from unnest(string_to_array(p.tabel, ',')) mk");
zeg("                               where position(quote_literal(mk) in pg_get_constraintdef(c.oid)) = 0))");
zeg("      -- Een policy staat lang niet altijd in public: de bestandspolicies zitten op");
zeg("      -- storage.objects. Op het verkeerde schema zoeken gaf een alarm dat nooit uitging.");
zeg("      when 'policy' then exists (select 1 from pg_policies");
zeg("             where schemaname = p.schema and tablename = p.tabel and policyname = p.object)");
zeg("    end as aanwezig");
zeg("  from probe p");
zeg(")");
zeg("select");
zeg("  case when bool_and(aanwezig) then 'TOEGEPAST'");
zeg("       when bool_or(aanwezig)  then 'GEDEELTELIJK  <-- KIJK HIER'");
zeg("       else 'OPEN' end                                        as stand,");
zeg("  bestand,");
zeg("  count(*) filter (where aanwezig) || ' / ' || count(*)       as objecten_gevonden,");
zeg("  string_agg(case when not aanwezig then");
zeg("    case when soort = 'function_body'");
zeg("         then 'function ' || schema || '.' || object || ' loopt achter op de map (mist een van: ' || tabel || ')'");
zeg("         when soort = 'constraint_def'");
zeg("         then 'constraint ' || object || ' loopt achter op de map (mist een van: ' || tabel || ')'");
zeg("         else soort || ' ' || schema || '.' || object end end, ', ')                as ontbreekt");
zeg("from bevonden");
zeg("group by bestand");
zeg("-- GEDEELTELIJK eerst, dan OPEN, dan de rest: de regels waar iets aan te doen is, bovenaan.");
zeg("order by case when bool_and(aanwezig) then 3 when bool_or(aanwezig) then 1 else 2 end, bestand;");
zeg();
// ── WAT DEZE LIJST NIET KAN ZEGGEN ──────────────────────────────────────────
//
// Een lijst die zwijgt over wat ze niet weet, is de lijst waar dit bestand tegen is geschreven.
// Voor een functie die meer dan één migratie schrijft, meet DEEL 1 de INHOUD van de functie tegen
// wat de map unaniem verwacht — niet wélk van die bestanden hem geschreven heeft. Dat verschil
// hoort in het rapport te staan, en niet in iemands hoofd.
{
  const perFunctie = new Map<string, string[]>();
  for (const { bestand, sql } of gelezen) {
    for (const naam of functieBodies(sql).keys()) {
      if (!perFunctie.has(naam)) perFunctie.set(naam, []);
      perFunctie.get(naam)!.push(bestand);
    }
  }
  const meervoudig = [...perFunctie].filter(([, fs]) => fs.length > 1).sort((a, b) => a[0].localeCompare(b[0]));
  if (meervoudig.length > 0) {
    zeg("-- ── WAT DEEL 1 OVER DEZE FUNCTIES WÉL EN NIET ZEGT ──────────────────");
    zeg("--");
    for (const r of wikkel(
      `${meervoudig.length} functies worden door meer dan één migratie geschreven. Voor die functies zegt ` +
      "TOEGEPAST: de body in de database bevat elke kolomverwijzing die de map er unaniem in verwacht. " +
      "Het zegt NIET welk van die bestanden hem daar gezet heeft — en dat is niet vast te stellen, want " +
      "een CREATE OR REPLACE laat geen spoor van zijn herkomst achter. OPEN betekent hier dus: de functie " +
      "in de database loopt achter op de map, en de migraties hieronder zijn samen het antwoord.", 96)) {
      zeg(`--   ${r}`);
    }
    zeg("--");
    for (const [naam, fs] of meervoudig) {
      const merk = functieMerken.get(naam);
      zeg(`--   ${naam}`);
      for (const f of [...new Set(fs)].sort()) zeg(`--     · ${f}`);
      if (!merk) {
        for (const r of wikkel(
          "GEEN INHOUDSMETING: deze definities delen geen enkele NEW./OLD.-kolomverwijzing, dus er is " +
          "niets dat de map unaniem in deze functie verwacht. Deel 1 valt hier terug op het bestaan " +
          "van de functie, en dat bewijst alleen dat de EERSTE van deze migraties gedraaid heeft.", 92)) {
          zeg(`--     ${r}`);
        }
      }
      zeg("--");
    }
    zeg();
  }
}
zeg("-- =====================================================================");
zeg(`-- DEEL 2 — NIET VAST TE STELLEN MET EEN OBJECT: ${zonderVingerafdruk.length} van de ${bestanden.length}`);
zeg("-- =====================================================================");
zeg("--");
zeg("-- Deze trekken alleen rechten in, gooien iets weg, zetten een stand goed of verplaatsen");
zeg("-- data. Er is geen object waarvan het BESTAAN iets bewijst, dus de query hierboven kan er");
zeg("-- niets over zeggen — ze krijgen met opzet GEEN verzonnen vingerafdruk.");
zeg("--");
zeg("-- Wat hieronder wordt gemeten is niet het bestaan van een object maar de STAND: is de");
zeg("-- policy weg, is de kolom weg, staat de bucket privé, is het recht ingetrokken. Draai de");
zeg("-- query net als de eerste: als service_role, in de SQL-editor. Ze verandert niets.");
zeg("--");
zeg("-- De vragen staan in STAND_CONTROLE in scripts/migration-inventory.ts. Een migratie zonder");
zeg("-- vingerafdruk die daar niet in staat, laat de generator vallen — ontbreken kan dus niet.");
zeg("--");

{
  const controles = zonderVingerafdruk
    .map((f) => [f, STAND_CONTROLE[f]] as const)
    .filter((r): r is readonly [string, Extract<Stand, { soort: "controle" }>] => r[1].soort === "controle");

  zeg("with controle(bestand, vraag, toegepast) as (");
  controles.forEach(([bestand, stand], i) => {
    const q = (t: string) => `'${t.replace(/'/g, "''")}'`;
    zeg(`  select ${q(bestand)}::text, ${q(stand.vraag)}::text, (`);
    for (const regel of inspringen(stand.sql, 4)) zeg(regel);
    zeg("  )");
    if (i < controles.length - 1) zeg("  union all");
  });
  zeg(")");
  zeg("select case when toegepast then 'TOEGEPAST' else 'OPEN  <-- KIJK HIER' end as stand,");
  zeg("       bestand, vraag");
  zeg("  from controle");
  zeg(" order by toegepast, bestand;");
  zeg();

  const metingen = zonderVingerafdruk
    .map((f) => [f, STAND_CONTROLE[f]] as const)
    .filter((r): r is readonly [string, Extract<Stand, { soort: "meting" }>] => r[1].soort === "meting");
  if (metingen.length > 0) {
    zeg("-- =====================================================================");
    zeg("-- ZELF LEZEN — geen oordeel, want een uitkomst hier kan ook een andere oorzaak hebben");
    zeg("-- =====================================================================");
    for (const [bestand, stand] of metingen) {
      zeg("--");
      zeg(`-- ${bestand} — ${stand.vraag}`);
      for (const r of wikkel(stand.waarom, 96)) zeg(`--   ${r}`);
      zeg("--");
      const regels = inspringen(stand.sql, 0);
      regels[regels.length - 1] += ";";
      for (const regel of regels) zeg(regel);
    }
    zeg();
  }

  const geenSpoor = zonderVingerafdruk
    .map((f) => [f, STAND_CONTROLE[f]] as const)
    .filter((r): r is readonly [string, Extract<Stand, { soort: "geen-spoor" }>] => r[1].soort === "geen-spoor");
  if (geenSpoor.length > 0) {
    zeg("-- =====================================================================");
    zeg("-- NIETS MEER VAN TE ZIEN — en juist daarom NIET opnieuw draaien");
    zeg("-- =====================================================================");
    for (const [bestand, stand] of geenSpoor) {
      zeg("--");
      zeg(`--   ${bestand}`);
      for (const r of wikkel(stand.waarom, 94)) zeg(`--     ${r}`);
    }
    zeg("--");
  }
}
zeg("-- =====================================================================");
zeg("-- OBJECTEN DIE LATER ZIJN OPGERUIMD — tellen niet mee in het oordeel");
zeg("-- =====================================================================");
zeg("--");
zeg("-- Deze objecten worden door een LATERE migratie weer weggegooid. Hun afwezigheid bewijst");
zeg("-- niets over de migratie die ze aanmaakte — die kan allang gedraaid hebben. Meetellen zou");
zeg("-- een toegepaste migratie als OPEN aanmerken, en dat is de duurste soort fout die deze");
zeg("-- lijst kan maken: hem nog een keer draaien.");
zeg("--");
for (const r of opgeruimd) zeg(`--   ${r}`);
zeg("--");
zeg("-- =====================================================================");
zeg("-- WEL AANGEMAAKT, MAAR BEWIJST NIETS — met de reden erbij");
zeg("-- =====================================================================");
zeg("--");
zeg("-- Deze objecten worden door hun migratie aangemaakt, maar hun bestaan zegt niets over of");
zeg("-- die migratie gedraaid heeft. Ze staan hier MET reden in plaats van stilletjes te");
zeg("-- verdwijnen — wie de lijst leest hoort te zien waarom er niet naar gekeken wordt.");
zeg("--");
zeg("-- Ze staan in NIETS_BEWIJZEND in scripts/migration-inventory.ts. Een object dat gewoon");
zeg("-- ontbreekt hoort daar NIET in: dat hoort OPEN te heten.");
zeg("--");
for (const r of nietsBewijzend) zeg(`--   ${r}`);
zeg();

process.stdout.write(lijnen.join("\n") + "\n");

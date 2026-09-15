import test from "node:test";
import assert from "node:assert/strict";
import {
  payToggleAnswer,
  isVerwerktConflict,
  isDuplicatePaidConflict,
  PAY_TOGGLE_REASON_KEY,
  PAY_TOGGLE_FALLBACK_KEY,
} from "./pay-toggle-reason";
import { MESSAGES } from "./i18n/messages";
import { translate } from "./i18n/t";

// ─── [PAY-REDEN] Never a machine code on a phone ─────────────────────────────────────────────────

test("[PAY-REDEN] a refusal that carries no detail still becomes words", () => {
  // The /vandaag bug, in one assertion. Its handler was `data?.error`, so this exact response put
  // "invoice_already_paid" under the "Al betaald?" button.
  const answer = payToggleAnswer(409, { error: "invoice_already_paid" });
  assert.deepEqual(answer, { kind: "key", key: "pay.reden.alBetaald" });
  assert.equal(translate("nl", answer.kind === "key" ? answer.key : "pay.reden.algemeen"),
    "Deze factuur staat al als betaald");
});

test("[PAY-REDEN] every code the route can answer with has a line", () => {
  // Read off the routes themselves rather than from memory: a code added there and not here comes
  // out as the neutral fallback, which is a quiet downgrade rather than a failure.
  for (const code of [
    "verwerkt", "invoice_already_paid", "invoice_not_found", "not_paid", "not_payable",
    "status_conflict", "unauthorized", "invalid_amount", "invalid_payment_date",
    "partial_cash_unsupported", "client_key_conflict", "undo_read_failed", "undo_failed",
  ]) {
    const answer = payToggleAnswer(409, { error: code });
    assert.equal(answer.kind, "key", code);
    assert.notEqual(
      answer.kind === "key" && answer.key, PAY_TOGGLE_FALLBACK_KEY,
      `${code} falls through to the neutral line — it has no reason of its own`,
    );
  }
});

test("[PAY-REDEN] the server's own sentence wins when the status says we may trust it", () => {
  // Those details carry a FACT the code cannot: which status was refused, which window applies,
  // which reference collided. That is worth a Dutch sentence on a non-Dutch screen.
  assert.deepEqual(
    payToggleAnswer(409, { error: "not_payable", detail: "status 'draft' kan niet als betaald worden gemarkeerd" }),
    { kind: "server", text: "status 'draft' kan niet als betaald worden gemarkeerd" },
  );
});

test("[PAY-REDEN] a 5xx detail is a raw database string and never reaches a phone", () => {
  // pay_failed answers 500 with `detail: error.message` — a PL/pgSQL exception with a tag, a
  // function name and a uuid in it.
  const answer = payToggleAnswer(500, {
    error: "pay_failed",
    detail: '[MANUAL-PARTIAL-PAY] caller 9999... may not book for 1111...',
  });
  assert.equal(answer.kind, "key", "a 500 detail must never be shown");
  assert.equal(answer.kind === "key" && answer.key, "pay.reden.algemeen");
});

test("[PAY-REDEN] a blank or whitespace detail is not a sentence", () => {
  // `detail: ''` used to win over the code under `detail || error`, showing nothing at all.
  assert.deepEqual(payToggleAnswer(409, { error: "not_paid", detail: "" }),
    { kind: "key", key: "pay.reden.nietBetaald" });
  assert.deepEqual(payToggleAnswer(409, { error: "not_paid", detail: "   " }),
    { kind: "key", key: "pay.reden.nietBetaald" });
});

test("[PAY-REDEN] an unknown code, a missing body and junk all land on the neutral line", () => {
  // Never a key, never a blank, never `[object Object]`.
  for (const json of [
    { error: "some_code_from_next_month" },
    {}, null, undefined,
    { error: 42 }, { error: null }, { detail: 42 },
  ] as const) {
    const answer = payToggleAnswer(409, json as never);
    assert.deepEqual(answer, { kind: "key", key: PAY_TOGGLE_FALLBACK_KEY }, JSON.stringify(json));
  }
});

test("[PAY-REDEN] the accountant's lock is recognised by its CODE, not by a Dutch word", () => {
  assert.equal(isVerwerktConflict({ error: "verwerkt" }), true);
  // The /facturen bug: it searched the displayed MESSAGE for "verwerkt". In Arabic that sentence
  // contains no Dutch, so the dialog — the only way out of that lock — would stop opening.
  assert.equal(isVerwerktConflict({ error: "pay_failed", detail: "iets over verwerkt" }), false,
    "a sentence mentioning the word is not the lock");
  assert.equal(isVerwerktConflict({}), false);
  assert.equal(isVerwerktConflict(null), false);
  // And the Arabic line really does contain no Dutch word to search for — which is the point.
  assert.equal(translate("ar", "pay.reden.verwerkt").includes("verwerkt"), false);
});

// ─── [PAY-REDEN] The words themselves ────────────────────────────────────────────────────────────

test("[PAY-REDEN] every key in the map is in the catalogue, in every language it claims", () => {
  const keys = [...new Set([...Object.values(PAY_TOGGLE_REASON_KEY), PAY_TOGGLE_FALLBACK_KEY])];
  for (const key of keys) {
    const entry = (MESSAGES as Record<string, { nl?: string }>)[key];
    assert.ok(entry, `${key} is used but not declared — the screen would render the key itself`);
    assert.ok(entry.nl && entry.nl.trim().length > 0, `${key} has no Dutch, which is the fallback`);
    // A translation that falls back is fine; one that is BLANK is not — translate() would return
    // Dutch for it, so the failure would be invisible in Dutch and only visible to the owner.
    for (const [lang, text] of Object.entries(entry as Record<string, string>)) {
      assert.ok(text.trim().length > 0, `${key}.${lang} is empty`);
    }
  }
});

test("[PAY-REDEN] no line is a code, and none of them shouts", () => {
  for (const key of Object.values(PAY_TOGGLE_REASON_KEY)) {
    for (const lang of ["nl", "ar", "en"] as const) {
      const text = translate(lang, key);
      // doesNotMatch, not notMatch — node:assert/strict has no notMatch, and the typo was a
      // TypeError at runtime rather than a failing assertion.
      assert.doesNotMatch(text, /^[a-z_]+$/, `${key}.${lang} is a machine code, not a sentence`);
      assert.doesNotMatch(text, /pay\.reden\./, `${key}.${lang} rendered the key`);
      assert.ok(text.length > 5, `${key}.${lang} is too short to be a reason`);
    }
  }
});

test("[PAY-REDEN] the lines that promise an action say what it is", () => {
  // A reason the owner cannot act on is only half a message. These four have a way out, and the
  // sentence has to carry it in every language — a translation that drops the instruction leaves
  // the owner staring at a button that does nothing.
  // The Arabic for "refresh the page" was reviewed from «حدِّث» to «أعد تحميل»; both promise the
  // action, and what this test is for is that SOME way out survives translation. Either passes,
  // and dropping the instruction altogether still fails.
  const herlaad = /أعد تحميل|حدِّث|حدّث/;
  const actionable: Record<string, RegExp[]> = {
    "pay.reden.statusVeranderd": [/ververs/i, herlaad, /refresh/i],
    "pay.reden.sessieVerlopen": [/log opnieuw in/i, /سجّل الدخول/, /log in again/i],
    "pay.reden.referentieBotst": [/ververs/i, herlaad, /refresh/i],
    "pay.reden.algemeen": [/ververs/i, herlaad, /refresh/i],
  };
  for (const [key, [nl, ar, en]] of Object.entries(actionable)) {
    assert.match(translate("nl", key as never), nl, key);
    assert.match(translate("ar", key as never), ar, key);
    assert.match(translate("en", key as never), en, key);
  }
});

test("[PAY-REDEN] a language with no translation reads Dutch, never a key", () => {
  // Turkish is deliberately absent from the catalogue (see the note in messages.ts).
  for (const key of Object.values(PAY_TOGGLE_REASON_KEY)) {
    assert.equal(translate("tr", key), translate("nl", key), `${key} must fall back to Dutch`);
  }
});

// ── [HAND-DUBBEL] De weigering die om een ANTWOORD vraagt in plaats van om begrip ──────────────
//
// Drie schermen boeken een betaling: /incoming/manage, /facturen en /vandaag. Alle drie leunen op
// dit ene contract om te weten dat een weigering een vraag is en geen storing. Twee van de drie
// dubbele boekingen in de live administratie zijn gemaakt met een tik die deze vraag niet stelde.

test('[HAND-DUBBEL] de dubbelweigering wordt herkend aan de CODE, nooit aan haar zin', () => {
  const echt = {
    error: 'duplicate_already_paid',
    detail: 'Factuurnummer 26 / 1876 staat 2× in je administratie — en één ervan is al betaald (€ 665,02).',
  }
  assert.equal(isDuplicatePaidConflict(echt), true)

  // De zin is vertaald op een Arabisch scherm; de code niet. Een scherm dat deze weigering aan haar
  // Nederlandse woorden herkent, herkent haar daar niet meer — dat is precies de fout die
  // isVerwerktConflict ooit heeft opgeruimd.
  assert.equal(
    isDuplicatePaidConflict({ error: 'duplicate_already_paid', detail: 'رقم الفاتورة مسجّل كمدفوع' }),
    true,
    'de herkenning hangt aan de zin in plaats van aan de code',
  )
  for (const anders of [
    { error: 'verwerkt' },
    { error: 'invoice_already_paid' },
    { detail: 'staat al betaald in je administratie' },
    {},
    null,
    undefined,
  ]) {
    assert.equal(isDuplicatePaidConflict(anders), false, `${JSON.stringify(anders)} is niet deze weigering`)
  }
})

test('[HAND-DUBBEL] en de FEITEN van de server winnen van de catalogus', () => {
  // De 409 draagt een geschreven zin die de bedragen van BEIDE rijen noemt. Die zin is wat de
  // ondernemer nodig heeft om te kiezen; een vertaalde algemene regel zou gladder zijn en minder
  // waar, en dit is een boekhoudapp.
  const antwoord = payToggleAnswer(409, {
    error: 'duplicate_already_paid',
    detail: 'Factuurnummer 26700385 staat 2× in je administratie — en één ervan is al betaald (€ 222,05).',
  })
  assert.equal(antwoord.kind, 'server')
  if (antwoord.kind === 'server') assert.match(antwoord.text, /222,05/)

  // Zonder die zin valt hij terug op een eigen regel — en niet op "er ging iets mis", want dit is
  // het tegenovergestelde van een storing.
  const zonder = payToggleAnswer(409, { error: 'duplicate_already_paid' })
  assert.equal(zonder.kind, 'key')
  if (zonder.kind === 'key') assert.equal(zonder.key, 'pay.reden.dubbelAlBetaald')
})

// [NEGATIEVE CONTROLE] Beide tests hierboven slagen ook als isDuplicatePaidConflict altijd true
// teruggeeft, of payToggleAnswer altijd 'server'. Deze pinnen de andere kant.
test('[HAND-DUBBEL] tegenproef: een gewone weigering blijft een gewone weigering', () => {
  assert.equal(isDuplicatePaidConflict({ error: 'not_payable' }), false)
  const serverfout = payToggleAnswer(500, { error: 'pay_failed', detail: 'duplicate key value violates…' })
  assert.equal(serverfout.kind, 'key', 'een 5xx-detail is een rauwe databasezin en hoort niet op een telefoon')
})

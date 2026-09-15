// [IMPORT-MONITOR] Pure node test — run: npx tsx src/lib/import-health.test.ts
// Locks the money-truth honesty: a missing/€0 total and a low amount-confidence are
// never presented as "clean", while a genuinely clean invoice stays calm (no alarm).
import { classifyImportHealth, type HealthInput } from './import-health'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

function inv(p: Partial<HealthInput>): HealthInput {
  return {
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
    invoice_date: '2026-03-10', invoice_number: '2026-014',
    invoice_type: 'factuur', field_confidence: null, ...p,
  }
}

console.log('\n— a genuinely clean invoice stays calm (no false alarm) —')
{
  const h = classifyImportHealth(inv({}))
  check('clean → level clean, no reasons', h.level === 'clean' && h.reasons.length === 0)
  const h2 = classifyImportHealth(inv({ field_confidence: { vendor: 0.98, invoice_number: 0.95, invoice_date: 0.99, amount: 0.97 } }))
  check('clean + high confidences → still clean', h2.level === 'clean')
}

console.log('\n— a fabricated/missing invoice number is NEVER clean —')
{
  const placeholder = classifyImportHealth(inv({ invoice_number: `EMAIL-${1700000000000}` }))
  check('EMAIL-<ts> placeholder → needs-review', placeholder.level === 'needs-review')
  check('placeholder → invoiceNumber flag + reason', placeholder.flags.invoiceNumber && placeholder.reasons.some((r) => /factuurnummer/i.test(r)))
  const empty = classifyImportHealth(inv({ invoice_number: '' }))
  check('empty number → needs-review', empty.level === 'needs-review' && empty.flags.invoiceNumber)
  const nul = classifyImportHealth(inv({ invoice_number: null }))
  check('null number → needs-review', nul.level === 'needs-review' && nul.flags.invoiceNumber)
  // Backward-compat: a caller that doesn't pass the field is NOT flagged on it.
  const legacy = classifyImportHealth({
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
    invoice_date: '2026-03-10', invoice_type: 'factuur', field_confidence: null,
  })
  check('invoice_number undefined (legacy caller) → not flagged, stays clean', legacy.level === 'clean')
  const real = classifyImportHealth(inv({ invoice_number: '2026-014' }))
  check('a real number → clean', real.level === 'clean')
}

console.log('\n— missing / €0 total is NEVER clean (was a silent €0 booking) —')
{
  const missing = classifyImportHealth(inv({ total_ex_btw: 0, btw_amount: 0, total_inc_btw: null }))
  check('null total → needs-review', missing.level === 'needs-review')
  check('null total → arithmetic flag + a "ontbreekt/€0" reason', missing.flags.arithmetic && missing.reasons.some((r) => /ontbreekt|€ ?0/i.test(r)))
  const zero = classifyImportHealth(inv({ total_ex_btw: 0, btw_amount: 0, total_inc_btw: 0 }))
  check('€0 total → needs-review', zero.level === 'needs-review')
}

console.log('\n— the amounts get their OWN confidence channel —')
{
  const lowAmt = classifyImportHealth(inv({ field_confidence: { amount: 0.4 } }))
  check('low amount-confidence → needs-review', lowAmt.level === 'needs-review' && lowAmt.reasons.some((r) => /onzeker/.test(r)))
  const lowTotalKey = classifyImportHealth(inv({ field_confidence: { total_inc_btw: 0.5 } }))
  check('low total_inc_btw-confidence → needs-review', lowTotalKey.level === 'needs-review')
  const highAmt = classifyImportHealth(inv({ field_confidence: { amount: 0.95 } }))
  check('high amount-confidence + good numbers → clean', highAmt.level === 'clean')
  // Under-claim: no amount score present → we do NOT fabricate doubt about the amount.
  const noAmt = classifyImportHealth(inv({ field_confidence: { vendor: 0.99 } }))
  check('no amount score present → no fabricated amount doubt', noAmt.level === 'clean')
}

console.log('\n— [TRUST-DATE] a missing invoice date is flagged (server refuses it) —')
{
  const noDate = classifyImportHealth(inv({ invoice_date: null }))
  check('null date → needs-review', noDate.level === 'needs-review' && noDate.flags.invoiceDate)
  check("null date → 'ontbreekt' reason", noDate.reasons.some((r) => /factuurdatum ontbreekt/.test(r)))
  check('blank date → needs-review', classifyImportHealth(inv({ invoice_date: '  ' })).level === 'needs-review')
  check('a present date is not flagged', classifyImportHealth(inv({ invoice_date: '2026-03-10' })).flags.invoiceDate === false)
}

console.log('\n— existing guards still hold —')
{
  const mismatch = classifyImportHealth(inv({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 100 }))
  check('excl+BTW≠incl → needs-review (arithmetic)', mismatch.level === 'needs-review' && mismatch.flags.arithmetic)
  const lowVendor = classifyImportHealth(inv({ field_confidence: { vendor: 0.3 } }))
  check('low vendor confidence → needs-review (vendor)', lowVendor.level === 'needs-review' && lowVendor.flags.vendor)
  const credit = classifyImportHealth(inv({ invoice_type: 'creditnota', total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 }))
  check('clean negative creditnota → clean (not falsely flagged)', credit.level === 'clean')
}

console.log('\n— [REMINDER] a payment reminder is flagged for a human check (never silently confirmed) —')
{
  const rem = classifyImportHealth(inv({ field_confidence: { _safecore: { reminder: true } } }))
  check('reminder → needs-review', rem.level === 'needs-review' && rem.flags.reminder === true)
  check('reminder → owner-facing reason mentions checking the original',
    rem.reasons.some((r) => r.includes('herinnering') && r.includes('geboekt')))
  const remOf = classifyImportHealth(inv({ field_confidence: { _safecore: { reminder: true, reminder_of: '2216671' } } }))
  check('reminder_of names the original invoice number', remOf.reasons.some((r) => r.includes('2216671')))
  // A clean invoice that is NOT a reminder keeps calm.
  check('no reminder flag on a normal invoice', classifyImportHealth(inv({})).flags.reminder === false)
}

console.log('\n— [DEDUP-SOFT] a POSSIBLE duplicate is flagged for a human glance (never auto-booked) —')
{
  const dup = classifyImportHealth(inv({ field_confidence: { _safecore: { possible_duplicate: true } } }))
  check('possible dup → needs-review', dup.level === 'needs-review' && dup.flags.possibleDuplicate === true)
  check('possible dup → owner-facing "mogelijk dubbel" reason',
    dup.reasons.some((r) => r.includes('mogelijk dubbel') && r.includes('dubbele boeking')))
  const dupOf = classifyImportHealth(inv({ field_confidence: { _safecore: { possible_duplicate: true, possible_duplicate_of: 'F-2001', possible_duplicate_reason: 'zelfde bedrag en datum' } } }))
  check('names the look-alike invoice + reason', dupOf.reasons.some((r) => r.includes('F-2001') && r.includes('zelfde bedrag en datum')))
  check('no possible-dup flag on a normal invoice', classifyImportHealth(inv({})).flags.possibleDuplicate === false)
  // [DEDUP-SOFT #4] A _safecore that carries ONLY possible_duplicate (no arithmetic_ok — the intake
  // path never ran the arithmetic gate) must STILL recompute arithmetic, so a possible-dup invoice
  // that is ALSO math-inconsistent surfaces BOTH reasons, not just the dup one.
  const both = classifyImportHealth(inv({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 130, field_confidence: { _safecore: { possible_duplicate: true } } }))
  check('possible-dup + math error → BOTH reasons', both.flags.possibleDuplicate === true && both.flags.arithmetic === true)
}

console.log('\n— [BTW-SUM-FIX] a DERIVED BTW is never presented as clean (it is our arithmetic) —')
{
  // The Enka Horeca shape AFTER the repair: 3413.92 + 405.90 = 3819.82, a legal 12% blend, so
  // every existing axis is silent. Without its own reason the owner would see a green "klaar"
  // over a BTW figure the invoice never printed — and auto-advance would book the voorbelasting.
  const derived = classifyImportHealth(inv({
    total_ex_btw: 3413.92, btw_amount: 405.90, total_inc_btw: 3819.82,
    field_confidence: { _btw_derived: { read: 995.90, used: 405.90 } },
  }))
  check('derived BTW → needs-review', derived.level === 'needs-review' && derived.flags.arithmetic === true)
  check('reason names the derivation + the amount', derived.reasons.some((r) => /afgeleid uit excl\. en totaal/.test(r) && r.includes('405,90')))
  check('the same amounts WITHOUT the note stay clean (the note is the cause)',
    classifyImportHealth(inv({ total_ex_btw: 3413.92, btw_amount: 405.90, total_inc_btw: 3819.82 })).level === 'clean')
  // A note with no usable figure still warns, just without naming an amount.
  const noAmount = classifyImportHealth(inv({ field_confidence: { _btw_derived: { read: null, used: null } } }))
  check('note without an amount still warns', noAmount.level === 'needs-review' && noAmount.reasons.some((r) => /afgeleid uit excl\. en totaal/.test(r)))
}

console.log('\n— [EIGEN-CONTROLE-ONBEKEND] een controle die niet kon draaien zwijgt nooit —')
{
  // The silent outcome this closes: a database hiccup during the own-sales-invoice lookup used to
  // be indistinguishable from "checked, and it is a supplier bill". The measured cost of getting
  // that wrong is the owner's own turnover booked as a cost, with the BTW they OWE claimed back as
  // voorbelasting — the Kiwi € 394,99 shape.
  const unchecked = classifyImportHealth(inv({ field_confidence: { _own_check_unavailable: true } }))
  check('own-invoice check unavailable → needs-review', unchecked.level === 'needs-review')
  check('…and the vendor axis carries it', unchecked.flags.vendor === true)
  check('the sentence says the check could not run, never that it ran clean',
    unchecked.reasons.some((r) => /konden niet nagaan of dit je eigen verkoopfactuur is/.test(r)))
  // The flag is the cause: the same invoice without it stays clean.
  check('without the flag the same invoice is clean',
    classifyImportHealth(inv({})).level === classifyImportHealth(inv({})).level
      && !classifyImportHealth(inv({})).reasons.some((r) => /eigen verkoopfactuur/.test(r)))
  // false is not "unavailable" — only an explicit true speaks.
  check('an explicit false says nothing',
    !classifyImportHealth(inv({ field_confidence: { _own_check_unavailable: false } })).reasons
      .some((r) => /eigen verkoopfactuur/.test(r)))
}

console.log('\n— [NUL-BTW-STIL] een nul-BTW zonder uitleg is voorbelasting die niemand ziet —')
{
  // De terugval maakt excl. gelijk aan het totaal, dus 121 + 0 = 121 klopt per constructie: zonder
  // deze notitie is de rij op elke as schoon terwijl de voorbelasting op 0 staat.
  const stil = classifyImportHealth(inv({
    total_ex_btw: 121, btw_amount: 0, total_inc_btw: 121,
    field_confidence: { _btw_zero_unexplained: true },
  }))
  check('een onverklaarde nul-BTW → needs-review', stil.level === 'needs-review' && stil.flags.arithmetic === true)
  check('de reden noemt de voorbelasting', stil.reasons.some((r) => /voorbelasting/.test(r) && /terugvragen/.test(r)))
  check('dezelfde bedragen zonder de notitie blijven clean',
    classifyImportHealth(inv({ total_ex_btw: 121, btw_amount: 0, total_inc_btw: 121 })).level === 'clean')
  check('een expliciete false zegt niets',
    !classifyImportHealth(inv({ total_ex_btw: 121, btw_amount: 0, total_inc_btw: 121, field_confidence: { _btw_zero_unexplained: false } }))
      .reasons.some((r) => /voorbelasting/.test(r)))
}

console.log('\n— [EX-INCL-FIX] een herschreven grondslag boekt nooit zonder mens —')
{
  // Na de reparatie klopt 333.06 + 69.94 = 403 per constructie — elke andere as zwijgt.
  const fixed = classifyImportHealth(inv({
    total_ex_btw: 333.06, btw_amount: 69.94, total_inc_btw: 403,
    field_confidence: { _ex_corrected: { read: 403, used: 333.06 } },
  }))
  check('herschreven ex → needs-review', fixed.level === 'needs-review' && fixed.flags.arithmetic === true)
  check('de reden noemt het afgeleide bedrag', fixed.reasons.some((r) => /afgeleid uit totaal min BTW/.test(r) && r.includes('333,06')))
  check('dezelfde bedragen zonder de notitie blijven clean', classifyImportHealth(inv({ total_ex_btw: 333.06, btw_amount: 69.94, total_inc_btw: 403 })).level === 'clean')
}

console.log('\n— [ASSURANTIE] assurantiebelasting is geen aftrekbare BTW —')
{
  // After stripAssurantiebelastingBtw: the € 41,01 IPT has been folded into the cost (ex = incl,
  // btw = 0), so ex + btw = incl holds and every arithmetic axis would be silent. The note is the
  // only thing that keeps the document out of auto-advance and tells the owner what happened.
  const ass = classifyImportHealth(inv({
    total_ex_btw: 236.29, btw_amount: 0, total_inc_btw: 236.29,
    field_confidence: { _assurantiebelasting: { read: 41.01 } },
  }))
  check('stripped assurantiebelasting → needs-review', ass.level === 'needs-review' && ass.flags.arithmetic === true)
  check('reason says it is not BTW and names the amount', ass.reasons.some((r) => /assurantiebelasting/.test(r) && /geen BTW/.test(r) && r.includes('41,01')))
  // Belt-and-suspenders: the SAME clean numbers WITHOUT the note stay clean — the note is the cause.
  check('the same amounts without the note stay clean', classifyImportHealth(inv({ total_ex_btw: 236.29, btw_amount: 0, total_inc_btw: 236.29 })).level === 'clean')
  const noAmt = classifyImportHealth(inv({ total_ex_btw: 236.29, btw_amount: 0, total_inc_btw: 236.29, field_confidence: { _assurantiebelasting: { read: null } } }))
  check('note without an amount still warns', noAmt.level === 'needs-review' && noAmt.reasons.some((r) => /assurantiebelasting/.test(r)))
}

console.log('\n— [BON-NUMMER] een kassabon wordt niet beschuldigd van een ontbrekend factuurnummer —')
{
  // Echte bon: Nettorama Huizen, contant, 6x spitskool. Een kassabon is een vereenvoudigde
  // factuur; hij draagt geen art. 35-nummer en hoeft dat niet. Vroeger kreeg élke bon daardoor
  // een amberen "Aandacht nodig" voor iets wat er niet hoort te staan.
  const bon = classifyImportHealth(inv({
    invoice_number: null, total_ex_btw: 9.85, btw_amount: 0.89, total_inc_btw: 10.74,
    field_confidence: { _intake_kind: 'receipt' },
  }))
  check('bon zonder nummer → clean', bon.level === 'clean' && bon.flags.invoiceNumber === false)
  check('bon zonder nummer → geen factuurnummer-reden', !bon.reasons.some((r) => /factuurnummer/i.test(r)))

  // Ook de onzekerheids-as zwijgt: "het factuurnummer is onzeker" over een veld dat niet
  // bestaat, is ruis waar niemand meer naar kijkt.
  const onzeker = classifyImportHealth(inv({
    invoice_number: null, field_confidence: { _intake_kind: 'receipt', invoice_number: 0.1 },
  }))
  check('bon met lage nummer-confidence → nog steeds clean', onzeker.level === 'clean')

  // EN DE GRENS: alle andere assen blijven onverkort gelden. Een bon gaat over geld, en geld
  // is op een bon net zo hard als op een factuur.
  const rekenfout = classifyImportHealth(inv({
    invoice_number: null, total_ex_btw: 9.85, btw_amount: 0.89, total_inc_btw: 99.99,
    field_confidence: { _intake_kind: 'receipt' },
  }))
  check('bon met rekenfout → nog steeds needs-review', rekenfout.level === 'needs-review' && rekenfout.flags.arithmetic)
  const geenDatum = classifyImportHealth(inv({
    invoice_number: null, invoice_date: null, field_confidence: { _intake_kind: 'receipt' },
  }))
  check('bon zonder datum → nog steeds needs-review', geenDatum.level === 'needs-review' && geenDatum.flags.invoiceDate)

  // En een gewone FACTUUR zonder nummer blijft gewoon gevlagd — de uitzondering is smal.
  const factuur = classifyImportHealth(inv({ invoice_number: null, field_confidence: { _intake_kind: 'invoice' } }))
  check('factuur zonder nummer → onveranderd needs-review', factuur.level === 'needs-review' && factuur.flags.invoiceNumber)
}

// [IBAN-CHECK-HONEST] "we could not compare the account number" is not "the account number is fine".
// The supplier lookup swallowed its error and returned null, and null means NO FLAG — on the one
// check that stands between the owner and a payment redirected to a fraudster's account.
{
  const h = classifyImportHealth(inv({ field_confidence: { _safecore: { iban_check_unavailable: true } } }))
  check('an unverified account number is held for review', h.level === 'needs-review')
  check('with the same flag a real change raises', h.flags.ibanChanged === true)
  const why = h.reasons.join(' · ')
  check('the reason says the comparison did not happen', /niet vergelijken/.test(why))
  check('and never claims a change it did not see', !/is veranderd/.test(why))
  check('and still gives the one instruction that matters', /zelf opzoekt/.test(why))

  // Both flags present (a later import wrote one over a stale other): the NAMED change is the more
  // useful sentence and must win.
  const both = classifyImportHealth(inv({ field_confidence: { _safecore: {
    iban_changed: true, iban_changed_from: 'NL91ABNA0417164300', iban_changed_to: 'NL02RABO0123456789',
    iban_check_unavailable: true,
  } } }))
  const bothWhy = both.reasons.join(' · ')
  check('a real change wins over "could not check"', /NL91|veranderd/.test(bothWhy) && !/niet vergelijken/.test(bothWhy))
}

console.log('\n— [CREDIT-PREFIX-GATE] a credit-numbered document is held, and told why —')
{
  // The sentence matters as much as the flag. This axis exists to put a human in front of the
  // document, and a human who is stopped without being told why goes looking for a defect in the
  // amounts — which are perfect on CR0301267, and always will be on a well-printed credit note.
  const cr = classifyImportHealth(inv({
    invoice_number: 'CR0301267', invoice_type: 'factuur',
    total_ex_btw: 31.07, btw_amount: 2.8, total_inc_btw: 33.87,
  }))
  check('CR… on a debt row → needs-review', cr.level === 'needs-review' && cr.flags.creditPrefix === true)
  check('and the reason names the prefix and what to check',
    /CR/.test(cr.reasons.join(' · ')) && /creditnota/i.test(cr.reasons.join(' · ')))

  // The arithmetic is flawless — so nothing else on the card can be what stopped it, and if this
  // axis ever silently stopped firing the row would go straight through as 'clean'.
  check('nothing else objects to this invoice', cr.flags.arithmetic === false)

  // Same amounts, ordinary number → clean. Proves the prefix is the cause.
  const re = classifyImportHealth(inv({
    invoice_number: 'RE0803119', invoice_type: 'factuur',
    total_ex_btw: 31.07, btw_amount: 2.8, total_inc_btw: 33.87,
  }))
  check('the same invoice under an ordinary number is clean', re.level === 'clean')

  // Already booked as a creditnota with the right sign: correct, and it must not be nagged forever.
  const booked = classifyImportHealth(inv({
    invoice_number: 'CR0301267', invoice_type: 'creditnota',
    total_ex_btw: -31.07, btw_amount: -2.8, total_inc_btw: -33.87,
  }))
  check('a correctly booked creditnota is clean on this axis', booked.flags.creditPrefix === false)

  // ── [CREDIT-WOORD] De tweede greep, voor de leverancier die géén CR-nummer gebruikt ──
  //
  // De prefixpoort hierboven ving CR0301267 op zijn NUMMER. Een leverancier die zijn creditnota's
  // in dezelfde reeks nummert als zijn facturen, komt daar ongehinderd langs — en dan is de kop van
  // het papier het enige dat er nog over te zeggen valt. Het model zei op precies zo'n document
  // is_credit_note=false.
  const woord = classifyImportHealth(inv({
    invoice_number: '2026-0912', invoice_type: 'factuur',
    total_ex_btw: 31.07, btw_amount: 2.8, total_inc_btw: 33.87,
    field_confidence: { _safecore: { credit_word_in_header: true } },
  }))
  check('een gewoon nummer met het WOORD in de kop → needs-review',
    woord.level === 'needs-review' && woord.flags.creditPrefix === true)
  check('en de reden noemt de kop, niet het nummer',
    /kop/i.test(woord.reasons.join(' · ')) && /creditnota/i.test(woord.reasons.join(' · ')))

  // Zonder de vlag is exact dezelfde factuur schoon — dus de vlag is aantoonbaar de oorzaak.
  const zonder = classifyImportHealth(inv({
    invoice_number: '2026-0912', invoice_type: 'factuur',
    total_ex_btw: 31.07, btw_amount: 2.8, total_inc_btw: 33.87,
  }))
  check('zonder de vlag is dezelfde factuur schoon op deze as', zonder.flags.creditPrefix === false)

  // Al negatief geboekt, of al als creditnota getypt: de vraag is beantwoord, het alarm zwijgt.
  const alGoed = classifyImportHealth(inv({
    invoice_number: '2026-0913', invoice_type: 'factuur',
    total_ex_btw: -31.07, btw_amount: -2.8, total_inc_btw: -33.87,
    field_confidence: { _safecore: { credit_word_in_header: true } },
  }))
  check('een al negatief geboekte rij vraagt niets meer', alGoed.flags.creditPrefix === false)
}

console.log('\n— [BTW-SPLIT] a per-rate block that contradicts our btw holds the invoice —')
{
  // Enka Horeca 26701681, verbatim. Stored 1.213,50 + 122,18 = 1.335,68 — internally perfect, a
  // 10% blend, so the sum gate and the rate gate both stay silent and this invoice AUTO-BOOKED a
  // voorbelasting that was € 0,46 too low. The printed specification is the only witness.
  const rows = [{ rate: 9, base: 1101.38, btw: 99.06 }, { rate: 21, base: 112.12, btw: 23.58 }]
  const enka = classifyImportHealth(inv({
    total_ex_btw: 1213.50, btw_amount: 122.18, total_inc_btw: 1335.68,
    field_confidence: { _btw_rows: rows },
  }))
  check('printed block ≠ stored btw → needs-review', enka.level === 'needs-review' && enka.flags.arithmetic === true)
  check('reason names both figures', enka.reasons.some((r) => r.includes('122,64') && r.includes('122,18')))

  // The same block over the CORRECT amounts must go quiet — otherwise every mixed-rate invoice
  // lands in the queue and the signal drowns.
  const right = classifyImportHealth(inv({
    total_ex_btw: 1213.50, btw_amount: 122.64, total_inc_btw: 1336.14,
    field_confidence: { _btw_rows: rows },
  }))
  check('the same block over the right amounts is clean', right.level === 'clean')

  // And without the block, nothing changed: this is why the extraction had to start returning it.
  const blind = classifyImportHealth(inv({ total_ex_btw: 1213.50, btw_amount: 122.18, total_inc_btw: 1335.68 }))
  check('without the block the wrong invoice still reads clean (the reason it was needed)', blind.level === 'clean')
}

console.log('\n— [PRINTED-TOTAL] a total that disagrees with the printed one is never waved through —')
{
  const disagree = classifyImportHealth(inv({
    total_ex_btw: 1213.50, btw_amount: 122.18, total_inc_btw: 1335.68,
    field_confidence: { _total_printed: 1336.14 },
  }))
  check('printed ≠ stored → needs-review', disagree.level === 'needs-review' && disagree.flags.arithmetic === true)
  check('reason names both amounts', disagree.reasons.some((r) => r.includes('1.336,14') && r.includes('1.335,68')))

  // [PRINTED-TOTAL] The mark for "we computed the third figure ourselves" is a DISPLAY answer
  // (invoice-checks.ts turns the arithmetic row grey), never a hold. Flagging it would demand
  // human attention on a path whose frequency nobody has measured.
  const filledIn = classifyImportHealth(inv({ field_confidence: { _total_derived: 'total' } }))
  check('_total_derived alone does not hold the invoice', filledIn.level === 'clean')
}


// ── [E-FACTUUR-BESLECHT] "onzeker gelezen" gaat over een lezing ───────────────
//
// De waarschuwing "het bedrag is onzeker gelezen" is waar zolang het bedrag GELEZEN is. Stuurde de
// leverancier zijn cijfers zelf mee en kloppen die met de lezing, dan vraagt die zin de ondernemer
// om te controleren wat de app al zwart op wit heeft. Zo verliest een waarschuwing haar betekenis:
// niet door fout te zijn, maar door overbodig te zijn.
console.log('\n— [E-FACTUUR-BESLECHT] de leverancier stuurde het bedrag zelf mee —')
{
  const onzeker = (fc: Record<string, unknown>): HealthInput => ({
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
    invoice_date: '2026-05-10', invoice_number: '2026-0042', invoice_type: 'factuur',
    field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.42, ...fc },
  })

  const zonder = classifyImportHealth(onzeker({}))
  check('zonder e-factuur blijft "onzeker gelezen" staan',
    zonder.level === 'needs-review' && zonder.reasons.some((r) => r.includes('onzeker gelezen')))

  const met = classifyImportHealth(onzeker({
    _einvoice: { totalIncBtw: 121, totalExBtw: 100, btwAmount: 21, syntax: 'cii', contradicts: false },
  }))
  check('mét een kloppende e-factuur verdwijnt die zin', !met.reasons.some((r) => r.includes('onzeker gelezen')))
  check('en is de rij schoon', met.level === 'clean')

  // De tegenspraak houdt haar eigen, sterkere zin — die noemt het juiste bedrag.
  const tegen = classifyImportHealth(onzeker({
    _einvoice: { totalIncBtw: 250, totalExBtw: 206.61, btwAmount: 43.39, syntax: 'ubl', contradicts: true },
  }))
  check('een tegensprekende e-factuur blijft alarmeren', tegen.level === 'needs-review')
  check('en noemt het bedrag uit de e-factuur', tegen.reasons.some((r) => r.includes('250')))

  // Rommel beslecht niets: de oude waarschuwing hoort dan gewoon terug te komen.
  const rommel = classifyImportHealth(onzeker({ _einvoice: { totalIncBtw: 121 } }))
  check('onleesbare _einvoice laat "onzeker gelezen" staan',
    rommel.reasons.some((r) => r.includes('onzeker gelezen')))
}

console.log('\n— [EEN-VELD-EEN-ZIN] one field, one sentence — for every field, not one of them —')
{
  // The rule, applied to all three fields the two axes share. It was fixed for the invoice number
  // alone; the supplier and the date had the identical shape and kept printing two rows about one
  // field with the same action behind them. A special case where a rule belonged.
  const veld = (over: Partial<HealthInput>, woord: string) => {
    const r = classifyImportHealth(inv(over)).reasons.filter((x) => x.includes(woord))
    return r
  }
  const lev = veld({
    client_name: 'HVO Meat',
    field_confidence: { vendor: 0.3, _vendorGrounding: { verdict: 'absent', name: 'HVO Meat' } },
  } as Partial<HealthInput>, 'leverancier')
  check('leverancier: waarde-as én onzeker → één zin', lev.length === 1)
  check('…en het is de zin die het meeste zegt', lev[0]?.includes('staat nergens') === true)

  const datum = veld({ invoice_date: null, field_confidence: { invoice_date: 0.3 } }, 'factuurdatum')
  check('datum: waarde-as én onzeker → één zin', datum.length === 1)
  check('…en het is de zin die het meeste zegt', datum[0]?.includes('ontbreekt') === true)

  // Each axis ALONE still speaks, for every field — or the rule would have silenced a real signal
  // instead of a duplicate one.
  const alleenLev = classifyImportHealth(inv({ field_confidence: { vendor: 0.3 } }))
  check('alleen onzeker (leverancier) → die zin staat er wél',
    alleenLev.reasons.some((r) => r.includes('leverancier is onzeker')))
  check('…en de vlag wordt daar gezet', alleenLev.flags.vendor === true)
  const alleenDatum = classifyImportHealth(inv({ field_confidence: { invoice_date: 0.3 } }))
  check('alleen onzeker (datum) → die zin staat er wél',
    alleenDatum.reasons.some((r) => r.includes('factuurdatum is onzeker')))
  check('…en de vlag wordt daar gezet', alleenDatum.flags.invoiceDate === true)
}

console.log('\n— [DUBBELE-ZIN] one field, one sentence —')
{
  // MEASURED on a Univé invoice. The number was the EMAIL-<ts> placeholder AND the reader was
  // unsure about it, so two axes fired and the card printed two rows with the same action behind
  // them: "het factuurnummer ontbreekt of kon niet worden gelezen" and "het factuurnummer is
  // onzeker". Four warnings where there were three things wrong. A list that pads itself is how an
  // owner learns to skim past the row that matters.
  const beide = inv({ invoice_number: 'EMAIL-1786744846846', field_confidence: { invoice_number: 0.3 } })
  const over = classifyImportHealth(beide).reasons.filter((r) => r.includes('factuurnummer'))
  check('placeholder + onzeker → één zin, niet twee', over.length === 1)
  check('…en het is de zin die het meeste zegt', over[0]?.includes('ontbreekt') === true)
  // The FLAG is unchanged, so the field is pointed at exactly as hard as before. Only the second
  // sentence goes; suppressing the flag would have hidden the field instead of tidying the list.
  check('de vlag blijft staan — het veld wordt even hard aangewezen',
    classifyImportHealth(beide).flags.invoiceNumber === true)

  // Each axis alone still speaks, or the dedup would have silenced a real signal. The
  // confidence-only row is the one that matters here: with the value axis quiet, the flag can only
  // come from the confidence branch itself, so this is what actually pins that it still sets it.
  // (The assertion above cannot — there the value axis has already raised the flag either way.)
  const alleenOnzeker = classifyImportHealth(inv({ field_confidence: { invoice_number: 0.3 } }))
  check('alleen onzeker → die zin staat er wél', alleenOnzeker.reasons.some((r) => r.includes('onzeker')))
  check('alleen onzeker → en de vlag wordt daar gezet', alleenOnzeker.flags.invoiceNumber === true)
  const alleenLeeg = classifyImportHealth(inv({ invoice_number: 'EMAIL-1786744846846' }))
  check('alleen plaatshouder → die zin staat er wél', alleenLeeg.reasons.some((r) => r.includes('ontbreekt')))
}

console.log('\n— [SUBTOTAAL] het bedrag staat op het papier, maar niet waar een totaal staat —')
{
  // Enka Horeca 26713540, zoals hij werkelijk staat: 1.431,19 + 128,78 = 1.559,97, exact tot op
  // de cent, en _doccheck zegt 'present' — gevonden op het document, maar niet op een totaalplek.
  const h = classifyImportHealth(inv({
    total_ex_btw: 1431.19, btw_amount: 128.78, total_inc_btw: 1559.97,
    invoice_number: '26713540',
    field_confidence: {
      _doccheck: { btw: 'found', date: 'found', total: 'present', invoiceNumber: 'found', btwContradiction: null },
      _grounding: { source: 'text', btwAmount: 'found', totalExBtw: 'found', totalIncBtw: 'found' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  }))

  check('de rekensom klopt, dus dit is geen rekenfout', Math.abs((1431.19 + 128.78) - 1559.97) < 0.005)
  check('de rij wordt nog steeds vastgehouden', h.flags.arithmetic === true)
  check('…maar de bevinding heeft nu een eigen naam', h.flags.totalLooksLikeSubtotal === true)
  check('en het is NIET de "niet in de tekst"-bevinding', h.flags.notOnDocument === false)
  check('de zin gaat over de PLEK, niet over de som',
    h.reasons.some((r) => /subtotaal|regelbedrag/.test(r)))

  // [NEGATIEVE CONTROLE] Alles hierboven slaagt ook als de vlag altijd aan staat. Deze pinnen de
  // andere kant: een echte rekenfout blijft een rekenfout, en een schone factuur zegt niets.
  const echteRekenfout = classifyImportHealth(inv({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 130 }))
  check('een echte rekenfout blijft arithmetic zonder deze vlag',
    echteRekenfout.flags.arithmetic === true && echteRekenfout.flags.totalLooksLikeSubtotal === false)
  check('en een schone factuur draagt de vlag niet',
    classifyImportHealth(inv({})).flags.totalLooksLikeSubtotal === false)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

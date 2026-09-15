// src/lib/ritten-refusal.ts
// [SERVER-ZIN] The sentence behind each reason /api/ritten can refuse a trip. Pure.
//
// Same reasoning as uren-refusal.ts: the screen shows a server sentence as it is, so a refusal
// written as a literal here would reach an Arabic interface in Dutch. Literal keys, not assembled
// from the code — the [TAAL] gate looks for each declared key as a literal string.

import type { MessageKey } from '@/lib/i18n/messages'
import type { MileageRefusal } from '@/lib/ritten'

/** One catalogue key per refusal, typed on both sides: a new refusal without a sentence is a build error. */
export const RITTEN_REFUSAL_KEY: Record<MileageRefusal, MessageKey> = {
  no_date: 'ritten.fout.geenDatum',
  no_from: 'ritten.fout.geenVertrek',
  no_to: 'ritten.fout.geenBestemming',
  no_purpose: 'ritten.fout.geenDoel',
  place_too_long: 'ritten.fout.plaatsTeLang',
  purpose_too_long: 'ritten.fout.doelTeLang',
  no_kilometers: 'ritten.fout.geenKilometers',
  too_far: 'ritten.fout.teVeelKilometers',
  bad_rate: 'ritten.fout.tariefGeenBedrag',
}

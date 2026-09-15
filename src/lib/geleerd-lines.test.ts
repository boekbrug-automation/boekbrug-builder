// npx tsx --test src/lib/geleerd-lines.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { learnedPhrases, summaryPhrase } from "./geleerd-lines";
import { MESSAGES } from "./i18n/messages";

test("[GELEERD-SINDSDIEN] each capability is named in the owner's words", () => {
  assert.deepEqual(learnedPhrases(["btw_split"]), [{ key: "gl.leerBtw" }]);
  assert.deepEqual(learnedPhrases(["btw_split", "statiegeld"]), [
    { key: "gl.leerBtw" }, { key: "gl.leerStatiegeld" },
  ]);
});

test("[GELEERD-SINDSDIEN] the same capability twice is said once", () => {
  assert.deepEqual(learnedPhrases(["btw_split", "btw_split"]), [{ key: "gl.leerBtw" }]);
});

test("[GELEERD-SINDSDIEN] nothing learned says nothing — never a generic 'we improved'", () => {
  assert.deepEqual(learnedPhrases([]), []);
});

test("[GELEERD-SINDSDIEN] a capability with no sentence is skipped, not rendered as its key", () => {
  assert.deepEqual(learnedPhrases(["ocr" as never]), []);
});

test("[GELEERD-SINDSDIEN] the summary carries the money, singular and plural", () => {
  assert.deepEqual(summaryPhrase(1, "€ 4.917,90"), { key: "gl.samenEen", params: { bedrag: "€ 4.917,90" } });
  assert.deepEqual(summaryPhrase(40, "€ 44.749,74"), {
    key: "gl.samen", params: { n: 40, bedrag: "€ 44.749,74" },
  });
});

test("[TAAL] every key this module can emit exists and carries Dutch", () => {
  const emitted = new Set<string>();
  for (const p of learnedPhrases(["btw_split", "statiegeld"])) emitted.add(p.key);
  emitted.add(summaryPhrase(1, "x").key);
  emitted.add(summaryPhrase(2, "x").key);
  assert.equal(emitted.size, 4);
  for (const key of emitted) {
    const entry = (MESSAGES as Record<string, { nl?: string }>)[key];
    assert.ok(entry, `${key} is missing from the catalogue`);
    assert.ok((entry.nl ?? "").trim().length > 0, `${key} has no Dutch`);
  }
});

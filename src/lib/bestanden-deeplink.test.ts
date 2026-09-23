// [BESTANDEN-WIJS] Pure node test — run: npx tsx --test src/lib/bestanden-deeplink.test.ts
//
// The link that answers "where did my file go?". Both halves of this existed for months —
// /dashboard/bestanden reads ?folder= and ?focus=, and /api/intake sends the target saying in its
// own comment that it is "so the client can deep-link + focus" — and nothing joined them.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bestandenDeepLink, targetFromIntake, BESTANDEN_PATH } from "./bestanden-deeplink";

test("[BESTANDEN-WIJS] the link opens the folder AND focuses the file", () => {
  const url = bestandenDeepLink({ documentId: "doc-1", folderId: "fold-9" });
  assert.equal(url, `${BESTANDEN_PATH}?folder=fold-9&focus=doc-1`);
  // Both parameters, because either alone is a worse answer than the sentence it replaces: a
  // folder with no focus drops the owner into two hundred files, and a focus with no folder makes
  // the screen find it without ever showing where it lives.
  assert.match(url ?? "", /folder=/);
  assert.match(url ?? "", /focus=/);

  // A file in the root is a real case, not a missing folder — `focus` still finds it.
  assert.equal(bestandenDeepLink({ documentId: "doc-1", folderId: null }), `${BESTANDEN_PATH}?focus=doc-1`);
});

test("[BESTANDEN-WIJS] no document id means NO link", () => {
  // The rule. Without an id there is nothing to focus, and a link that lands on the root of the
  // file tree looks like it worked while telling the owner nothing — worse than the plain sentence.
  assert.equal(bestandenDeepLink({ documentId: "", folderId: "fold-9" }), null);
  assert.equal(bestandenDeepLink({ documentId: "   ", folderId: "fold-9" }), null);
  assert.equal(bestandenDeepLink(null), null);
  assert.equal(bestandenDeepLink(undefined), null);
  // …and a folder on its own never earns one either.
  assert.equal(bestandenDeepLink({ documentId: "", folderId: null }), null);
});

test("[BESTANDEN-WIJS] both intake shapes are read — including the duplicate one", () => {
  // A stored document: the id is at the top level.
  assert.deepEqual(
    targetFromIntake({ ok: true, destination: "document", document_id: "doc-1", folder_id: "fold-9" }),
    { documentId: "doc-1", folderId: "fold-9" },
  );

  // A REFUSED duplicate: the file that matters is the one already there, so the id lives under
  // `existing`. This is the shape the upload screen never read — which is exactly why the row that
  // says "Dit bestand staat al in: 2026 / Q2 / april / Facturen" printed that path as dead text.
  assert.deepEqual(
    targetFromIntake({ duplicate: true, error: "Dit bestand staat al in: …", existing: { id: "doc-7", folder_id: "fold-3", folder_name: "Facturen" } }),
    { documentId: "doc-7", folderId: "fold-3" },
  );

  // Root-level duplicate.
  assert.deepEqual(
    targetFromIntake({ duplicate: true, existing: { id: "doc-7", folder_id: null } }),
    { documentId: "doc-7", folderId: null },
  );
});

test("[ONTVANGEN-WAAR] the receive-first response carries a target, and it is read", () => {
  // The exact body /api/intake answers on the receive-first road. camelCase, and no folder: the
  // file sits where RECEIVE put it and the reader files it later.
  assert.deepEqual(
    targetFromIntake({
      ok: true, received: true, destination: "received", documentId: "abc",
      message: "Ontvangen — je kunt verder. We lezen dit bestand zo voor je uit; je hoeft niet te wachten.",
    }),
    { documentId: "abc", folderId: null },
  );
  // The minimal shape the owner named, on its own.
  assert.deepEqual(targetFromIntake({ documentId: "abc" }), { documentId: "abc", folderId: null });

  // And it produces a link, which is the whole point: for a received row there is no invoice to go
  // to yet, so the stored file is the only thing the owner can follow.
  assert.equal(
    bestandenDeepLink(targetFromIntake({ received: true, documentId: "abc" })),
    "/dashboard/bestanden?focus=abc",
  );

  // snake_case still wins when both are somehow present — the established shape is not displaced.
  assert.deepEqual(
    targetFromIntake({ document_id: "snake", folder_id: "f1", documentId: "camel" }),
    { documentId: "snake", folderId: "f1" },
  );
  // A camelCase folder is read when it is there, and is not required.
  assert.deepEqual(
    targetFromIntake({ documentId: "abc", folderId: "fold-2" }),
    { documentId: "abc", folderId: "fold-2" },
  );
});

test("[BESTANDEN-WIJS] a response with no target yields none, never a half one", () => {
  for (const junk of [null, undefined, {}, { ok: true }, { existing: null }, { existing: {} },
                      { document_id: 42 }, { existing: { id: 42 } }, "nonsense", [],
                      // [ONTVANGEN-WAAR] the camelCase branch is held to the same standard
                      { documentId: 42 }, { documentId: "" }, { received: true }, { folderId: "f" }]) {
    assert.equal(targetFromIntake(junk), null, `${JSON.stringify(junk)} carries no target`);
  }
  // A folder without an id is not a target — the id is what makes it findable.
  assert.equal(targetFromIntake({ folder_id: "fold-9" }), null);
  assert.equal(targetFromIntake({ existing: { folder_id: "fold-9" } }), null);
});

test("[BESTANDEN-WIJS] an id that would break the URL is encoded, not pasted", () => {
  // Ids are uuids today. URLSearchParams is used anyway, because the day one is not a uuid is the
  // day a raw `&` in it silently becomes a second parameter and the focus is lost.
  const url = bestandenDeepLink({ documentId: "a&b=c", folderId: "x y" }) ?? "";
  assert.doesNotMatch(url.split("?")[1] ?? "", /[^=&]&[^=]*=[^&]*&/, "no smuggled parameters");
  const params = new URLSearchParams(url.split("?")[1]);
  assert.equal(params.get("focus"), "a&b=c", "the id survives the round trip intact");
  assert.equal(params.get("folder"), "x y");
});

// ── [UPLOAD-TRUTH-1] The received link must reach the folder the file is actually in ──────────
//
// [ONTVANGEN-WAAR] taught targetFromIntake to read the receive-first shape, and the upload screen
// started rendering the link. But the route sent only `documentId`, so every received row produced
// `?focus=` alone — the root — while receiveRawIncoming had just filed the file in "Geïmporteerde
// bestanden". /dashboard/bestanden loads one folder and returns silently when the focused id is
// not in it, so the link the owner could finally see went nowhere, every single time.
//
// These tests run the WHOLE chain by value: the body /api/intake returns → targetFromIntake →
// bestandenDeepLink → the two parameters Bestanden reads.

test("[UPLOAD-TRUTH-1] a receive-first answer links to the folder the file was filed in", () => {
  // Exactly what the receive-first branch of /api/intake returns.
  const answer = {
    ok: true,
    received: true,
    destination: "received",
    documentId: "a4f2c95e-31ed-4523-a9fa-6ff9f131af8f",
    folderId: "9bb08c9a-a184-4ee8-9334-308f2949fa8e", // "Geïmporteerde bestanden"
    message: "Ontvangen — je kunt verder.",
  };

  const target = targetFromIntake(answer);
  assert.deepEqual(target, {
    documentId: "a4f2c95e-31ed-4523-a9fa-6ff9f131af8f",
    folderId: "9bb08c9a-a184-4ee8-9334-308f2949fa8e",
  }, "the folder travels with the id, not beside it");

  const params = new URLSearchParams((bestandenDeepLink(target) ?? "").split("?")[1]);
  assert.equal(params.get("folder"), "9bb08c9a-a184-4ee8-9334-308f2949fa8e",
    "Bestanden is told WHICH folder to open — without this it opens the root");
  assert.equal(params.get("focus"), "a4f2c95e-31ed-4523-a9fa-6ff9f131af8f",
    "…and which document to land on inside it");
});

test("[UPLOAD-TRUTH-1] the racing-duplicate answer points at the folder the earlier file is in", () => {
  // The `existing` arm of the same road. It hard-coded folder_id: null, so the sentence named the
  // root and the link opened the root — over a file that is in a folder.
  const answer = {
    error: "Dit bestand is al toegevoegd.",
    duplicate: true,
    existing: { id: "594379fb", folder_id: "b13ab44b", folder_name: "Facturen" },
  };
  const params = new URLSearchParams((bestandenDeepLink(targetFromIntake(answer)) ?? "").split("?")[1]);
  assert.equal(params.get("folder"), "b13ab44b");
  assert.equal(params.get("focus"), "594379fb");
});

test("[UPLOAD-TRUTH-1] a link with no folder is the root, which is where a received file is not", () => {
  // The regression this closes, stated as a value: id-only produces a root link. Kept so that
  // dropping folderId from the route again fails here rather than in someone's Bestanden screen.
  const rootOnly = bestandenDeepLink(targetFromIntake({ received: true, documentId: "doc-1" }));
  assert.equal(rootOnly, "/dashboard/bestanden?focus=doc-1");
  assert.equal(new URLSearchParams((rootOnly ?? "").split("?")[1]).get("folder"), null,
    "no folder parameter means the root — the one place receive never files anything");
});

// src/lib/store-raw-incoming.test.ts
// [ONTVANGEN] The receive contract: when may BoekBrug say "Ontvangen"?
//
// The answer this file pins is a single sentence with no room in it:
//
//   the bytes are durable AND the document row is durable, or we did not receive it.
//
// The module's own header used to say the opposite — "storage is a convenience; the booking is the
// money-truth" — and that was right while the booking happened in the same request. It is wrong
// the moment we tell an owner "je kunt verder" and they close the tab, because from then on the
// stored file and its row are the only record that their invoice exists at all.
//
// The three outcomes are not cosmetic. `created` and `existing` both carry a document id, and a
// type that collapsed them into one id would let the same invoice be processed twice — once for
// the upload and once for the copy the owner sent again from their phone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { receiveRawIncoming, storeRawIncoming } from "./store-raw-incoming";

// ── A stand-in for the two clients this touches ───────────────────────────────────────────────

type Row = Record<string, unknown>;

class FakeSupabase {
  uploaded: Array<{ path: string; bytes: number }> = [];
  removed: string[] = [];
  existing: { id: string; trashed?: boolean } | null = null;
  /**
   * Rows this account already has, keyed by content_hash — the shape the real UNIQUE index has.
   *
   * The blunt `existing` above answers every lookup the same way, which is fine for the tests that
   * only care WHAT happens on a hit. It is not enough for the wrap tests: those turn on WHICH hash
   * is looked up, and a fake that ignores the filter would report a duplicate even when the code
   * searched for something else entirely.
   */
  existingByHash: Record<string, { id: string; trashed?: boolean }> = {};
  /** Every content_hash the code actually searched for. */
  lookedUp: string[] = [];
  uploadError: { message: string } | null = null;

  from() {
    const eq = (column: string, value: unknown) => {
      if (column === "content_hash") this.lookedUp.push(String(value));
      return {
        eq,
        limit: () => ({
          maybeSingle: async () => {
            const hash = this.lookedUp.at(-1) ?? "";
            return { data: this.existing ?? this.existingByHash[hash] ?? null };
          },
        }),
      };
    };
    return { select: () => ({ eq }) };
  }
  storage = {
    from: () => ({
      upload: async (path: string, bytes: Buffer) => {
        if (this.uploadError) return { error: this.uploadError };
        this.uploaded.push({ path, bytes: bytes.length });
        return { error: null };
      },
      remove: async (paths: string[]) => { this.removed.push(...paths); return { error: null }; },
    }),
  };
}

class FakePipeline {
  inserted: Row[] = [];
  /** Set to refuse the first insert as PostgREST does for an unknown column. */
  unknownColumn = false;
  insertError: { code?: string; message?: string } | null = null;

  from() {
    return {
      insert: (row: Row) => ({
        select: () => ({
          single: async () => {
            if (this.insertError) return { data: null, error: this.insertError };
            if (this.unknownColumn && ("intake_paid_method" in row || "intake_paid_date" in row)) {
              return { data: null, error: { code: "42703", message: 'column "intake_paid_method" does not exist' } };
            }
            this.inserted.push(row);
            return { data: { id: `doc-${this.inserted.length}` }, error: null };
          },
        }),
      }),
    };
  }
}

let pipeRef = new FakePipeline();
/** Injected, so nothing in this file reaches a network or a database. */
const deps = () => ({ pipeline: pipeRef, ensureFolder: async () => "folder-1" });

const FILE = new File([new Uint8Array([1, 2, 3])], "bon.jpg", { type: "image/jpeg" });
const BYTES = Buffer.from([1, 2, 3]);
const USER = "11111111-1111-1111-1111-111111111111";

/** The fakes stand in for a session client; the cast is at ONE place, named, not scattered. */
type SessionClient = Parameters<typeof receiveRawIncoming>[3];
const asClient = (sb: FakeSupabase) => sb as unknown as SessionClient;

const call = (sb: FakeSupabase, opts: Partial<Parameters<typeof receiveRawIncoming>[6]> = {}) =>
  receiveRawIncoming(BYTES, FILE, USER, asClient(sb), "wacht_op_lezen", "camera", { ...opts, deps: deps() });

test("[ONTVANGEN] storage fails → no Ontvangen, and no row is left behind", async () => {
  const sb = new FakeSupabase();
  sb.uploadError = { message: "bucket unavailable" };
  pipeRef = new FakePipeline();

  const out = await call(sb);
  assert.equal(out.kind, "failed", "a failed upload must never read as a successful handoff");
  assert.equal(out.kind === "failed" && out.reason, "storage");
  assert.equal(pipeRef.inserted.length, 0, "a row was written for bytes that are not there");
});

test("[ONTVANGEN] the row fails → the bytes are rolled back, and still no Ontvangen", async () => {
  const sb = new FakeSupabase();
  pipeRef = new FakePipeline();
  pipeRef.insertError = { message: "deadlock detected" };

  const out = await call(sb);
  assert.equal(out.kind, "failed", "half a handoff is not a handoff");
  assert.equal(out.kind === "failed" && out.reason, "row");
  assert.equal(sb.uploaded.length, 1, "the upload did happen");
  assert.deepEqual(sb.removed, [sb.uploaded[0].path],
    "the orphaned bytes stay in the bucket — a file nobody can find, and an allowance nobody gets back");
});

test("[ONTVANGEN] both durable → created, with the id", async () => {
  const sb = new FakeSupabase();
  pipeRef = new FakePipeline();

  const out = await call(sb);
  assert.equal(out.kind, "created");
  assert.ok(out.kind === "created" && out.documentId.length > 0);
  assert.equal(sb.uploaded.length, 1);
  assert.equal(pipeRef.inserted.length, 1);
});

test("[ONTVANGEN] the same bytes twice → existing, never a second piece of work", async () => {
  const sb = new FakeSupabase();
  sb.existing = { id: "doc-eerder", trashed: false };
  pipeRef = new FakePipeline();

  const out = await call(sb);
  assert.equal(out.kind, "existing",
    "a re-upload of the exact same file reads as new work — that is one invoice processed twice");
  assert.equal(out.kind === "existing" && out.documentId, "doc-eerder");
  assert.equal(sb.uploaded.length, 0, "the bytes were stored a second time");
  assert.equal(pipeRef.inserted.length, 0, "a second row was created for content we already hold");
});

test("[ONTVANGEN] the owner's intent is written in the SAME insert that makes it durable", async () => {
  const sb = new FakeSupabase();
  pipeRef = new FakePipeline();

  const out = await call(sb, { intakePaidMethod: "kas", intakePaidDate: "2026-09-18" });
  assert.equal(out.kind, "created");
  const row = pipeRef.inserted[0];
  assert.equal(row.intake_paid_method, "kas",
    "the owner chose how they paid and it is not on the row — it lives only in a browser that may already be closed");
  assert.equal(row.intake_paid_date, "2026-09-18");
});

test("[ONTVANGEN] intent supplied but not persistable → the whole handoff fails", async () => {
  // The tempting version of this branch keeps the file and drops the intent: "at least we have
  // the bytes". That is the one degradation this contract cannot allow.
  //
  // "Ontvangen — je kunt verder" means we hold everything the owner just handed over. If they
  // said "betaald met pin op 18 september", that decides whether the bon settles through the bank
  // or the kas — financial behaviour, not a preference — and once the tab is closed it exists
  // nowhere else. Remembering the bytes while forgetting the intent is the worst of the three
  // outcomes: the owner is told it is safe, the document is processed later without what they
  // said about it, and nothing reports a loss. A refusal costs one upload they can repeat.
  const sb = new FakeSupabase();
  pipeRef = new FakePipeline();
  pipeRef.unknownColumn = true;

  const out = await call(sb, { intakePaidMethod: "bank", intakePaidDate: "2026-09-18" });
  assert.equal(out.kind, "failed",
    "the owner's payment intent could not be stored and we said Ontvangen anyway");
  assert.equal(out.kind === "failed" && out.reason, "intent",
    "the reason must name what was lost — this is not a storage or a row failure");
  assert.deepEqual(sb.removed, [sb.uploaded[0].path],
    "a refused handoff left its bytes in the bucket");
  assert.equal(pipeRef.inserted.length, 0, "a row exists for a handoff we refused");
});

test("[ONTVANGEN] no intent supplied → a missing column cannot break anything", async () => {
  // The historical callers keep a file after a reader outage and supply no intent at all, so the
  // strict rule above never reaches them: no intent, no intent columns, nothing to fail on.
  const sb = new FakeSupabase();
  pipeRef = new FakePipeline();
  pipeRef.unknownColumn = true;

  const out = await call(sb);
  assert.equal(out.kind, "created", "a caller that asked for nothing extra was refused");
  assert.equal(pipeRef.inserted.length, 1);
});

test("[ONTVANGEN] the historical signature keeps its meaning", async () => {
  // Three reader-outage callers still use storeRawIncoming, and for them `null` really does mean
  // "we could not keep it". One implementation underneath, two shapes above.
  const sb = new FakeSupabase();
  pipeRef = new FakePipeline();
  assert.ok(await storeRawIncoming(BYTES, FILE, USER, asClient(sb), "could_not_read", "upload", { aiProcessed: false, deps: deps() }));

  const stuk = new FakeSupabase();
  stuk.uploadError = { message: "down" };
  pipeRef = new FakePipeline();
  assert.equal(await storeRawIncoming(BYTES, FILE, USER, asClient(stuk), "could_not_read", "upload", { deps: deps() }), null);
});


// ── [ONTVANGEN] The duplicate gate must survive the image → PDF wrap ──────────────────────────
//
// Receive-first stores the CONVERTED file (a photographed bon becomes a PDF at the door instead of
// after the reader). The measured fact below is why the conversion may not also decide the hash.

test("[ONTVANGEN] the image→PDF wrap is not byte-stable — measured, not assumed", async () => {
  const { maybeImageToPdf } = await import("./image-to-pdf")
  // A minimal valid 1×1 PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  )
  const first = await maybeImageToPdf(png, "image/png", "bon.png")
  await new Promise((r) => setTimeout(r, 1100)) // cross a whole second: pdf-lib stamps to the second
  const second = await maybeImageToPdf(png, "image/png", "bon.png")

  assert.equal(first.fileName, "bon.pdf", "precondition: the wrap really happened")
  assert.notDeepEqual(
    first.buffer, second.buffer,
    "pdf-lib no longer stamps a timestamp — if the wrap became byte-stable this test should be " +
      "replaced, but the rule below (hash what arrived) still holds for every other conversion",
  )
})

test("[ONTVANGEN] the hash is taken from the bytes that arrived, never from the copy we keep", async () => {
  const sb = new FakeSupabase()
  const converted = Buffer.from("%PDF-1.7 wrapped once")
  const r = await receiveRawIncoming(BYTES, FILE, USER, asClient(sb), "wacht_op_lezen", "camera", {
    deps: deps(),
    storeInstead: { buffer: converted, fileName: "bon.pdf", fileType: "application/pdf" },
  })
  assert.equal(r.kind, "created")

  // The row describes the object that is really in storage…
  const row = pipeRef.inserted.at(-1)!
  assert.equal(row.file_name, "bon.pdf")
  assert.equal(row.file_type, "application/pdf")
  assert.equal(row.file_size, converted.length)
  assert.equal(sb.uploaded.at(-1)!.bytes, converted.length, "and the converted bytes are what was uploaded")

  // …while the hash still identifies what the owner handed over.
  const { computeContentHash } = await import("./content-hash")
  assert.equal(row.content_hash, computeContentHash(BYTES))
  assert.notEqual(row.content_hash, computeContentHash(converted))
})

test("[ONTVANGEN] the same photo, wrapped twice, is still recognised as one file", async () => {
  // The money test. Two wraps of one photo differ byte for byte (see above), so a hash taken from
  // the stored copy would be unique every time — and the bon the owner photographed twice would
  // become two documents, two invoices, two costs and two voorbelasting claims, with nothing
  // failing and nothing logged.
  const sb = new FakeSupabase()
  const first = await receiveRawIncoming(BYTES, FILE, USER, asClient(sb), "wacht_op_lezen", "camera", {
    deps: deps(),
    storeInstead: { buffer: Buffer.from("%PDF wrap A"), fileName: "bon.pdf", fileType: "application/pdf" },
  })
  assert.equal(first.kind, "created")
  if (first.kind !== "created") return

  // The gate now knows THAT hash — the one the first receive reported, keyed the way the UNIQUE
  // index keys it. Nothing here tells the fake "answer duplicate to the next question", so the
  // second call only finds it if the code looked the same hash up.
  sb.existingByHash[first.contentHash] = { id: first.documentId }
  const uploadsBefore = sb.uploaded.length
  const rowsBefore = pipeRef.inserted.length

  const second = await receiveRawIncoming(BYTES, FILE, USER, asClient(sb), "wacht_op_lezen", "camera", {
    deps: deps(),
    storeInstead: { buffer: Buffer.from("%PDF wrap B — different bytes, same photo"), fileName: "bon.pdf", fileType: "application/pdf" },
  })
  assert.equal(second.kind, "existing", "a second wrap of the same photo must not become a second document")
  assert.equal(sb.uploaded.length, uploadsBefore, "…nothing stored")
  assert.equal(pipeRef.inserted.length, rowsBefore, "…and no second row to read and book")
})

// tests/render/email-archive-sync.test.tsx
// [ARCHIEF-WAAR] The REAL syncUserEmails, end to end, against a Gmail and an Outlook mailbox that
// carry real ZIP files — with a genuine text-bearing till PDF inside, read by the actual PDF reader.
//
// Why it lives in the render line: that runner is the one with `--experimental-test-module-mocks`,
// and the sync can only be driven by swapping its database client. Nothing here reaches a network
// or a real database: supabase-pipeline is an in-memory FakeDb (tests/render/support), and fetch
// is a stub that plays Gmail, Graph, the OAuth endpoints and the Anthropic API. The stub COUNTS
// model calls, which is how "the second sync reads nothing" is proven rather than assumed.
//
// Every archive invariant F-11 claims is asserted here from the outside: what is in the database,
// what the watermark did, how many model calls and fair-use units were spent.
import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import JSZip from "jszip";
import { FakeDb } from "./support/fake-supabase";

const SRC = path.resolve(process.cwd(), "src");
const u = (p: string) => pathToFileURL(path.join(SRC, p)).href;
const U = "11111111-2222-4333-8444-555555555555";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fake.local";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.GOOGLE_CLIENT_ID = "gid";
process.env.GOOGLE_CLIENT_SECRET = "gsecret";
process.env.MICROSOFT_CLIENT_ID = "mid";
process.env.MICROSOFT_CLIENT_SECRET = "msecret";
process.env.ANTHROPIC_API_KEY = "sk-fake";
delete process.env.SYNC_START_DATE;
delete process.env.SYNC_BATCH_MAX;

let db = new FakeDb();
mock.module(u("lib/supabase-pipeline.ts"), { namedExports: { createPipelineClient: () => db.client() } });
mock.module(u("lib/supabase-server.ts"), { namedExports: { createServerSupabaseClient: async () => db.client() } });

// The render runner compiles to CJS, where a top-level await is not allowed — the modules are
// loaded once, in `before`, after the mocks above are in place.
/* eslint-disable @typescript-eslint/no-explicit-any */
let textToPdf: (text: string, meta: Record<string, string>) => Promise<Uint8Array | Buffer | null>;
let syncUserEmails: (userId: string, opts?: { fromMs?: number; holdWatermark?: boolean }) => Promise<any>;
let currentPeriod: () => string;
let limitForPlan: (key: string, plan: string) => number;
let runIntakeDrain: (deps: any) => Promise<any>;
let computeContentHash: (buf: Buffer) => string;
let archiveMemberKey: (messageId: string, archiveFilename: string, entryPath: string) => string;
/** The registry key of member `path` of `archive` in message `id`. */
const mk = (id: string, archive: string, path: string) => archiveMemberKey(id, archive, path);
before(async () => {
  ({ textToPdf } = await import(u("lib/text-to-pdf.ts")) as any);
  ({ syncUserEmails } = await import(u("lib/email-integration.ts")) as any);
  ({ currentPeriod, limitForPlan } = await import(u("lib/fair-use-usage.ts")) as any);
  ({ runIntakeDrain } = await import(u("lib/intake-drain.ts")) as any);
  ({ computeContentHash } = await import(u("lib/content-hash.ts")) as any);
  ({ archiveMemberKey } = await import(u("lib/archive-expand.ts")) as any);
});

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────

/** A genuine till closing: a text PDF the deterministic Z-report reader recognises. */
async function tillPdf(day: string, gross = 1234.5): Promise<Buffer> {
  const [y, m, d] = day.split("-");
  const g = gross.toFixed(2).replace(".", ",");
  const text = `KIWI FOOD MARKET OMZET VAN ${d}/${m}/${y} Kassabonnen : 100 ${g} TOTAAL: 100 ${g} 0,00 ` +
    `Omzet met BTW % 9,00 ${g} Einde rapport`;
  const pdf = await textToPdf(text, { subject: "Jouw dagafsluiting", from: "kassa@example.nl", date: day });
  assert.ok(pdf, "fixture: textToPdf produced a PDF");
  return Buffer.from(pdf);
}

/** A PDF that is NOT a till closing, so it has to go to the model. `tag` makes each one unique. */
async function otherPdf(tag: string): Promise<Buffer> {
  const pdf = await textToPdf(`Leverancier BV Factuur ${tag} Totaal 121,00 BTW 21,00`, {
    subject: tag, from: "lev@example.nl", date: "2026-09-10",
  });
  assert.ok(pdf);
  return Buffer.from(pdf);
}

async function zip(files: Record<string, Buffer | string>): Promise<Buffer> {
  const z = new JSZip();
  for (const [name, content] of Object.entries(files)) z.file(name, content);
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Declared 100 bytes in both headers, inflates to `realBytes`. */
async function lyingZip(realBytes: number): Promise<Buffer> {
  const buf = await zip({ "bom.pdf": Buffer.alloc(realBytes) });
  buf.writeUInt32LE(100, 22);
  for (let i = 0; i + 4 <= buf.length; i++) if (buf.readUInt32LE(i) === 0x02014b50) buf.writeUInt32LE(100, i + 24);
  return buf;
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

// ── the mailbox (both providers read from the same list) ──────────────────────────────────────

type Att = { name: string; bytes: Buffer; mime?: string; inline?: boolean; item?: "message" };
type Mail = { id: string; at: number; atts: Att[] };
let mailbox: Mail[] = [];
/** Graph lists a message's attachments in the opposite order (ids unchanged). */
let outlookListReversed = false;

// ── the model ─────────────────────────────────────────────────────────────────────────────────

let modelCalls = 0;
/** What the model says about every document; default "not an invoice". */
let modelVerdict: Record<string, unknown> | null = null;
/** Return a status to fail THIS call (e.g. 529 = overloaded, transient). */
let modelFault: (body: string, n: number) => number | null = () => null;
const unknownUrls: string[] = [];

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

function anthropicAnswer() {
  const answer = modelVerdict ?? { is_invoice: false, confidence: 0.95, reason: "geen factuur (testantwoord)", document_kind: "other" };
  return json({
    id: "msg", type: "message", role: "assistant", model: "fake",
    content: [{ type: "text", text: JSON.stringify(answer) }],
    stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
  });
}

function rawMime(inner: Att[]): Buffer {
  const B = "b0undary";
  const parts = inner.map((a) =>
    `--${B}\r\nContent-Type: ${a.mime ?? "application/zip"}; name="${a.name}"\r\n` +
    `Content-Disposition: attachment; filename="${a.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
    `${a.bytes.toString("base64").replace(/(.{76})/g, "$1\r\n")}\r\n`).join("");
  return Buffer.from(
    `From: Kassa <kassa@example.nl>\r\nTo: owner@kiwi.nl\r\nSubject: Fwd: dagafsluiting\r\nMIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${B}"\r\n\r\n--${B}\r\nContent-Type: text/plain\r\n\r\nzie bijlage\r\n` +
    `${parts}--${B}--\r\n`, "latin1");
}

(globalThis as { fetch: typeof fetch }).fetch = (async (input: unknown, init?: RequestInit) => {
  const url = typeof input === "string" ? input : (input as { url: string }).url;
  if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "fresh" });
  if (url.startsWith("https://login.microsoftonline.com/")) return json({ access_token: "fresh" });
  if (url.startsWith("https://api.anthropic.com/")) {
    modelCalls++;
    const status = modelFault(String(init?.body ?? ""), modelCalls);
    if (status) return json({ type: "error", error: { type: "overloaded_error", message: "injected" } }, status);
    return anthropicAnswer();
  }

  // Gmail
  const gm = url.match(/^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages(.*)$/);
  if (gm) {
    const rest = gm[1];
    if (rest.startsWith("?")) {
      const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
      if (q.includes("-has:attachment")) return json({ messages: [] }); // the body-only scan
      const after = Number(q.match(/after:(\d+)/)?.[1] ?? 0) * 1000;
      const before = Number(q.match(/before:(\d+)/)?.[1] ?? 0) * 1000 || Infinity;
      return json({ messages: mailbox.filter((m) => m.at >= after && m.at < before).map((m) => ({ id: m.id })) });
    }
    const att = rest.match(/^\/([^/?]+)\/attachments\/([^/?]+)/);
    if (att) {
      const m = mailbox.find((x) => x.id === att[1]);
      const a = m?.atts[Number(att[2].replace("a", ""))];
      return a ? json({ data: b64url(a.bytes) }) : json({}, 404);
    }
    const msg = rest.match(/^\/([^/?]+)\?format=full/);
    if (msg) {
      const m = mailbox.find((x) => x.id === msg[1]);
      if (!m) return json({}, 404);
      return json({
        id: m.id, internalDate: String(m.at),
        payload: {
          headers: [
            { name: "From", value: "Kassa <kassa@example.nl>" }, { name: "To", value: "owner@kiwi.nl" },
            { name: "Subject", value: "Jouw dagafsluiting" }, { name: "Date", value: new Date(m.at).toUTCString() },
          ],
          parts: [
            { mimeType: "text/plain", filename: "", body: { size: 2, data: "aGk" } },
            // Gmail labels a zip anything from application/zip to octet-stream; the walker must
            // admit it by name.
            ...m.atts.map((a, i) => ({
              mimeType: a.mime ?? "application/octet-stream", filename: a.name,
              body: { size: a.bytes.length, attachmentId: `a${i}` },
            })),
          ],
        },
      });
    }
  }

  // Microsoft Graph
  if (url.startsWith("https://graph.microsoft.com/v1.0/me/messages")) {
    const value = url.match(/\/me\/messages\/([^/?]+)\/attachments\/([^/?]+)\/\$value$/);
    if (value) {
      const m = mailbox.find((x) => x.id === value[1]);
      const a = m?.atts[Number(value[2].replace("a", ""))];
      if (!a) return new Response("gone", { status: 404 });
      return new Response(new Uint8Array(a.item === "message" ? rawMime([{ ...a, item: undefined }]) : a.bytes), { status: 200 });
    }
    const list = url.match(/\/me\/messages\/([^/?]+)\/attachments$/);
    if (list) {
      const m = mailbox.find((x) => x.id === list[1]);
      if (!m) return json({}, 404);
      const listed = m.atts.map((a, i) => a.item === "message"
          ? { "@odata.type": "#microsoft.graph.itemAttachment", id: `a${i}`, name: "Fwd: dagafsluiting", contentType: "message/rfc822", size: a.bytes.length + 2000 }
          : {
            "@odata.type": "#microsoft.graph.fileAttachment", id: `a${i}`, name: a.name,
            contentType: a.mime ?? "application/x-zip-compressed", size: a.bytes.length,
            // A large attachment comes back WITHOUT contentBytes; the walker must fetch $value.
            ...(a.inline ? { contentBytes: a.bytes.toString("base64") } : {}),
          });
      // Graph promises no order for this list; the ids are what stay put.
      return json({ value: outlookListReversed ? listed.reverse() : listed });
    }
    const filter = decodeURIComponent(new URL(url).searchParams.get("$filter") ?? "");
    if (filter.includes("hasAttachments eq false")) return json({ value: [] }); // the body-only scan
    const after = Date.parse(filter.match(/receivedDateTime ge (\S+)/)?.[1] ?? "1970-01-01T00:00:00Z");
    const beforeM = filter.match(/receivedDateTime lt (\S+)/);
    const before = beforeM ? Date.parse(beforeM[1]) : Infinity;
    return json({
      value: mailbox.filter((m) => m.at >= after && m.at < before).map((m) => ({
        id: m.id, subject: "Jouw dagafsluiting", hasAttachments: true, receivedDateTime: iso(m.at),
        from: { emailAddress: { name: "Kassa", address: "kassa@example.nl" } },
        toRecipients: [{ emailAddress: { address: "owner@kiwi.nl" } }],
      })),
    });
  }

  unknownUrls.push(url);
  return json({}, 404);
}) as typeof fetch;

// ── accounts ──────────────────────────────────────────────────────────────────────────────────

const WM_START = iso(NOW - 20 * DAY);

function seedAccount(provider: "gmail" | "outlook", plan: "free" | "plus" = "plus") {
  db = new FakeDb();
  db.t("profiles").push({
    id: U, created_at: "2026-01-01T00:00:00Z", company_name: "Kiwi Food Market", role: "owner",
    subscription_status: plan === "plus" ? "active" : null,
    current_period_end: plan === "plus" ? "2027-01-01T00:00:00Z" : null,
  });
  db.t("email_connections").push({
    id: "conn-1", user_id: U, provider, email: "owner@kiwi.nl",
    access_token_secret_id: "a", refresh_token_secret_id: "r", connected_at: "2026-01-02T00:00:00Z",
    last_synced_email_at: WM_START,
  });
}

/** Units already spent this month on the free plan, so exactly `left` reads remain. */
function allowanceLeft(left: number) {
  const limit = limitForPlan("aiDocuments", "free");
  db.usage.set(`${U}|${currentPeriod()}|aiDocuments`, limit - left);
}

const sync = () => syncUserEmails(U);
const watermark = () => db.t("email_connections")[0].last_synced_email_at as string;
const registry = () => db.t("email_skipped_attachments") as Array<{ source_message_id: string; reason: string; filename: string }>;
const regKeys = () => registry().map((r) => r.source_message_id).sort();
const snapshot = () => ({
  documents: db.t("documents").length,
  invoices: db.t("invoices").length,
  registry: registry().length,
  turnover: db.t("daily_turnover").length,
  reserved: db.reservedUnits(),
  modelCalls,
  storage: db.storage.size,
});

beforeEach(() => {
  modelCalls = 0;
  modelVerdict = null;
  modelFault = () => null;
  mailbox = [];
  outlookListReversed = false;
  unknownUrls.length = 0;
  delete process.env.SYNC_BATCH_MAX;
});

// ── the tests ─────────────────────────────────────────────────────────────────────────────────

test("[ARCHIEF-WAAR] Gmail: a till zip is kept for booking, read by NO model, booked as nothing", async () => {
  seedAccount("gmail");
  const day = iso(NOW - 3 * DAY).slice(0, 10);
  mailbox = [{ id: "g1", at: NOW - 3 * DAY, atts: [{ name: "Jouw dagafsluiting - 1.zip", bytes: await zip({ "dagafsluiting.pdf": await tillPdf(day) }) }] }];

  const r = await sync();
  assert.ok(r, "sync ran");
  assert.equal(r.errors, 0);
  assert.equal(modelCalls, 0, "a till closing is recognised locally — no model call");
  assert.equal(db.reservedUnits(), 0, "and it costs no fair-use unit");
  const docs = db.t("documents");
  assert.equal(docs.length, 1, "the closing is kept as a document");
  assert.notEqual(docs[0].ai_doc_type, "could_not_read", "kept as what it IS, not as unreadable");
  assert.equal(docs[0].file_name, "Jouw dagafsluiting - 1 — dagafsluiting.pdf");
  assert.equal(db.t("invoices").length, 0, "a till closing never becomes a purchase invoice");
  assert.equal(db.t("daily_turnover").length, 0, "the sync books no turnover — [ZELF-EERST]");
  assert.deepEqual(regKeys(), [mk("g1", "Jouw dagafsluiting - 1.zip", "dagafsluiting.pdf")], "the member is registered; the archive has no stale row");
  assert.equal(watermark(), iso(NOW - 3 * DAY), "the mail is complete, so the mark passes it");
  assert.deepEqual(unknownUrls, []);
});

test("[ARCHIEF-WAAR] Gmail: every member ends durable, and a second identical sync spends NOTHING", async () => {
  seedAccount("gmail");
  const day = iso(NOW - 3 * DAY).slice(0, 10);
  const archive = await zip({
    "dagafsluiting.pdf": await tillPdf(day),
    // Same basename, different folders: two documents, two keys.
    "winkel-a/factuur.pdf": await otherPdf("A-1"),
    "winkel-b/factuur.pdf": await otherPdf("B-2"),
    "readme.exe": "MZ",
    "__MACOSX/._factuur.pdf": "x",
  });
  mailbox = [{ id: "g2", at: NOW - 3 * DAY, atts: [{ name: "bundel.zip", bytes: archive, mime: "application/zip" }] }];

  const r1 = await sync();
  assert.equal(r1.errors, 0);
  assert.equal(modelCalls, 2, "the two non-till PDFs are read, once each; the till is not");
  assert.equal(db.reservedUnits(), 2, "one fair-use unit per member that is READ — not one per zip");
  assert.deepEqual(regKeys(), [
    mk("g2", "bundel.zip", "dagafsluiting.pdf"),
    mk("g2", "bundel.zip", "readme.exe"),
    mk("g2", "bundel.zip", "winkel-a/factuur.pdf"),
    mk("g2", "bundel.zip", "winkel-b/factuur.pdf"),
  ].sort(), "every member has a durable outcome under its own full-path key; chrome is silent");
  const exe = registry().find((x) => x.source_message_id === mk("g2", "bundel.zip", "readme.exe"))!;
  assert.match(exe.reason, /Uploaden/, "an unsupported member is refused with a usable manual path");
  assert.equal(db.t("invoices").length, 0);
  assert.equal(db.t("daily_turnover").length, 0);
  assert.equal(watermark(), iso(NOW - 3 * DAY), "all members durable → the mail is complete");

  // The same mailbox again. The watermark overlap (24h) and a backfill both re-list it.
  const before1 = snapshot();
  const r2 = await sync();
  const r3 = await syncUserEmails(U, { fromMs: NOW - 10 * DAY, holdWatermark: true });
  assert.deepEqual(snapshot(), before1, "second and third sync: zero model calls, rows, reservations, files");
  assert.equal(r2.balance.fetched, 0, "no member even takes a batch place");
  assert.equal(r3.balance.fetched, 0);
});

test("[ARCHIEF-WAAR] Outlook: a zip WITHOUT contentBytes is fetched by $value and opened", async () => {
  seedAccount("outlook");
  const day = iso(NOW - 2 * DAY).slice(0, 10);
  mailbox = [{ id: "o1", at: NOW - 2 * DAY, atts: [{ name: "dag.zip", bytes: await zip({ "dagafsluiting.pdf": await tillPdf(day) }) }] }];
  const r = await sync();
  assert.equal(r.errors, 0);
  assert.equal(db.t("documents").length, 1, "the member was reached through $value");
  assert.deepEqual(regKeys(), [mk("o1", "dag.zip", "dagafsluiting.pdf")]);
  assert.equal(modelCalls, 0);
  assert.equal(watermark(), iso(NOW - 2 * DAY));
});

test("[ARCHIEF-WAAR] Outlook: a zip inside a FORWARDED message is admitted and opened", async () => {
  seedAccount("outlook");
  const day = iso(NOW - 2 * DAY).slice(0, 10);
  mailbox = [{ id: "o2", at: NOW - 2 * DAY, atts: [{ name: "dag.zip", item: "message", bytes: await zip({ "dagafsluiting.pdf": await tillPdf(day) }) }] }];
  const r = await sync();
  assert.equal(r.errors, 0);
  assert.equal(db.t("documents").length, 1, "the till closing inside the forwarded zip was kept");
  assert.deepEqual(regKeys(), [mk("o2", "dag.zip", "dagafsluiting.pdf")]);
  assert.equal(db.t("invoices").length, 0);
});

test("[ARCHIEF-WAAR] Outlook: a zip WITH inline contentBytes goes the same way", async () => {
  seedAccount("outlook");
  mailbox = [{ id: "o3", at: NOW - 2 * DAY, atts: [{ name: "b.zip", inline: true, bytes: await zip({ "x.pdf": await otherPdf("X") }) }] }];
  await sync();
  assert.equal(modelCalls, 1);
  assert.deepEqual(regKeys(), [mk("o3", "b.zip", "x.pdf")]);
});

for (const [left, reads] of [[0, 0], [1, 1], [5, 3]] as const) {
  test(`[ARCHIEF-WAAR] free plan, ${left} read(s) left: members are charged one by one`, async () => {
    seedAccount("gmail", "free");
    allowanceLeft(left);
    const day = iso(NOW - 3 * DAY).slice(0, 10);
    mailbox = [{ id: "f1", at: NOW - 3 * DAY, atts: [{ name: "z.zip", bytes: await zip({
      "a.pdf": await otherPdf("fa"), "b.pdf": await otherPdf("fb"), "c.pdf": await otherPdf("fc"),
      "dagafsluiting.pdf": await tillPdf(day),
    }) }] }];
    const used0 = db.reservedUnits();
    const r = await sync();
    assert.equal(modelCalls, reads, `${reads} model read(s)`);
    assert.equal(db.reservedUnits() - used0, reads, "reserved exactly what was read");
    assert.equal(db.t("documents").length, 1, "the till closing is kept whatever the allowance — it is free");
    assert.equal(r.heldByFairUse, 3 - reads);
    const complete = reads === 3;
    assert.equal(watermark(), complete ? iso(NOW - 3 * DAY) : WM_START,
      complete ? "all members done → complete" : "members held by the allowance keep the mail open");
    assert.equal(regKeys().length, 1 + reads, "only what was actually handled is registered");
  });
}

test("[ARCHIEF-WAAR] a transient model failure releases ONLY the unit that did not become a read", async () => {
  seedAccount("gmail");
  const failing = await otherPdf("tb-fails");
  const fine = await otherPdf("ta");
  mailbox = [{ id: "t1", at: NOW - 3 * DAY, atts: [{ name: "z.zip", bytes: await zip({
    "a.pdf": fine, "b.pdf": failing,
  }) }] }];
  // b.pdf is recognised by its own bytes in the request, so it fails on every retry of this run.
  // The two PDFs share a long identical prefix; the needle starts where they first differ.
  const [fb, gb] = [failing.toString("base64"), fine.toString("base64")];
  let at = 0;
  while (at < fb.length && fb[at] === gb[at]) at++;
  const needle = fb.slice(Math.max(0, at - 8), at + 64);
  assert.ok(!gb.includes(needle), "fixture: the needle identifies b.pdf alone");
  modelFault = (body) => (body.includes(needle) ? 529 : null);
  const r1 = await sync();
  assert.ok(r1.errors > 0, "the failed member is counted, not hidden");
  const readsAfter1 = db.reservedUnits();
  assert.equal(readsAfter1, 1, "two reserved, the failed one released");
  assert.equal(regKeys().length, 1, "the member that was read is durable");
  assert.equal(watermark(), WM_START, "the mail is not complete while one member failed");

  // Retry: the saved member is not read again; the failed one is read once.
  modelFault = () => null;
  const calls1 = modelCalls;
  await sync();
  assert.equal(modelCalls - calls1, 1, "only the member that failed is read again");
  assert.equal(db.reservedUnits(), 2);
  assert.equal(regKeys().length, 2);
  assert.equal(watermark(), iso(NOW - 3 * DAY));
});

test("[ARCHIEF-WAAR] more members than SYNC_BATCH_MAX progress across rounds and complete only at the end", async () => {
  process.env.SYNC_BATCH_MAX = "2";
  seedAccount("gmail");
  const day = (n: number) => iso(NOW - n * DAY).slice(0, 10);
  mailbox = [
    { id: "b1", at: NOW - 5 * DAY, atts: [{ name: "één.zip", bytes: await zip({
      "1.pdf": await otherPdf("b1"), "2.pdf": await otherPdf("b2"), "3.pdf": await otherPdf("b3"),
    }) }] },
    { id: "b2", at: NOW - 4 * DAY, atts: [{ name: "twee.zip", bytes: await zip({ "dagafsluiting.pdf": await tillPdf(day(4)) }) }] },
    { id: "b3", at: NOW - 3 * DAY, atts: [{ name: "drie.zip", bytes: await zip({ "4.pdf": await otherPdf("b4") }) }] },
  ];
  const marks: string[] = [];
  for (let round = 0; round < 4; round++) {
    await sync();
    marks.push(watermark());
  }
  assert.equal(modelCalls, 4, "each of the four PDFs is read exactly once across the rounds");
  assert.equal(db.reservedUnits(), 4);
  assert.equal(regKeys().length, 5);
  assert.equal(db.t("documents").length, 1);
  assert.deepEqual(marks, [WM_START, iso(NOW - 4 * DAY), iso(NOW - 3 * DAY), iso(NOW - 3 * DAY)],
    "round 1 cannot finish één.zip; round 2 finishes één and twee; round 3 drie; round 4 has nothing");
});

test("[ARCHIEF-WAAR] a corrupt zip is refused durably, with a way out — and does not freeze the mailbox", async () => {
  seedAccount("gmail");
  mailbox = [
    { id: "c1", at: NOW - 4 * DAY, atts: [{ name: "stuk.zip", bytes: Buffer.from("dit is geen zip") }] },
    { id: "c2", at: NOW - 3 * DAY, atts: [{ name: "goed.zip", bytes: await zip({ "x.pdf": await otherPdf("c2") }) }] },
  ];
  await sync();
  const row = registry().find((x) => x.source_message_id === "c1:stuk.zip");
  assert.ok(row, "the archive's own key carries the refusal");
  assert.match(row.reason, /beschadigd/);
  // A broken zip cannot be unpacked by the owner either — "pak het zelf uit" would send them to a
  // step that fails. The action they CAN take is to ask the sender for a sound copy.
  assert.match(row.reason, /afzender/, "and names an action the owner can actually take");
  assert.doesNotMatch(row.reason, /pak het zelf uit/, "not an action that fails on a broken file");
  assert.equal(watermark(), iso(NOW - 3 * DAY), "newer mail is not starved by the broken one");
  const s = snapshot();
  await sync();
  assert.deepEqual(snapshot(), s, "the refusal is stable: no second row, no read");
});

test("[ARCHIEF-WAAR] a zip that lies about its size is stopped by the counted bytes", async () => {
  seedAccount("gmail");
  mailbox = [{ id: "l1", at: NOW - 3 * DAY, atts: [{ name: "bom.zip", bytes: await lyingZip(11 * 1024 * 1024) }] }];
  await sync();
  assert.equal(modelCalls, 0);
  assert.equal(db.t("documents").length, 0, "nothing past the ceiling was stored");
  const row = registry().find((x) => x.source_message_id === mk("l1", "bom.zip", "bom.pdf"));
  assert.ok(row);
  assert.match(row.reason, /te groot/);
  assert.equal(watermark(), iso(NOW - 3 * DAY), "a refused member is a durable outcome");
});

// ── failures must never read as completion ────────────────────────────────────────────────────

async function tillMail(id: string) {
  const day = iso(NOW - 3 * DAY).slice(0, 10);
  mailbox = [{ id, at: NOW - 3 * DAY, atts: [{ name: "dag.zip", bytes: await zip({ "dagafsluiting.pdf": await tillPdf(day) }) }] }];
}

test("[ARCHIEF-WAAR] storage upload failure → not kept, not registered, not complete; the retry finishes it", async () => {
  seedAccount("gmail");
  await tillMail("s1");
  db.storageFault = () => true;
  const r = await sync();
  assert.ok(r.errors > 0, "the failure is counted");
  assert.equal(db.t("documents").length, 0);
  assert.deepEqual(regKeys(), [], "no 'kept' row for bytes that exist nowhere");
  assert.equal(watermark(), WM_START, "the mail stays open");
  db.storageFault = () => false;
  await sync();
  assert.equal(db.t("documents").length, 1);
  assert.deepEqual(regKeys(), [mk("s1", "dag.zip", "dagafsluiting.pdf")]);
  assert.equal(watermark(), iso(NOW - 3 * DAY));
});

test("[ARCHIEF-WAAR] document insert failure → the uploaded file is removed and nothing completes", async () => {
  seedAccount("gmail");
  await tillMail("s2");
  db.fault = (c) => c.table === "documents" && c.op === "insert";
  await sync();
  assert.equal(db.t("documents").length, 0);
  assert.equal(db.storage.size, 0, "no orphan file left behind");
  assert.deepEqual(regKeys(), []);
  assert.equal(watermark(), WM_START);
});

test("[ARCHIEF-WAAR] registry write failure → the keep is not known, so it is not done", async () => {
  seedAccount("gmail");
  await tillMail("s3");
  db.fault = (c) => c.table === "email_skipped_attachments" && (c.op === "upsert" || c.op === "insert");
  await sync();
  assert.equal(db.t("documents").length, 1, "the file itself was stored");
  assert.deepEqual(regKeys(), []);
  assert.equal(watermark(), WM_START, "but a keep the next sync cannot see is not a completed member");
  db.fault = () => false;
  const calls = modelCalls;
  await sync();
  assert.equal(db.t("documents").length, 1, "the retry reuses the stored file (byte-hash), no second copy");
  assert.deepEqual(regKeys(), [mk("s3", "dag.zip", "dagafsluiting.pdf")]);
  assert.equal(modelCalls, calls);
  assert.equal(watermark(), iso(NOW - 3 * DAY));
});

test("[ARCHIEF-WAAR] registry READ failure → UNKNOWN: nothing read, nothing written, nothing completed", async () => {
  seedAccount("gmail");
  await tillMail("s4");
  db.fault = (c) => c.table === "email_skipped_attachments" && c.op === "select";
  const r = await sync();
  assert.ok(r.errors > 0);
  assert.equal(modelCalls, 0);
  assert.equal(db.t("documents").length, 0);
  assert.deepEqual(regKeys(), []);
  assert.equal(watermark(), WM_START);
});

test("[ARCHIEF-WAAR] member-lookup failure alone (the outer read worked) holds the archive", async () => {
  seedAccount("gmail");
  await tillMail("s5");
  let selects = 0;
  // The first registry read is PHASE 0 over the outer attachments; the second is the member lookup.
  db.fault = (c) => c.table === "email_skipped_attachments" && c.op === "select" && ++selects === 2;
  await sync();
  assert.equal(db.t("documents").length, 0, "nothing about an archive whose members are UNKNOWN is decided");
  assert.equal(watermark(), WM_START);
});

test("[ARCHIEF-WAAR] a crash after one member is saved: the retry does not redo it", async () => {
  seedAccount("gmail");
  mailbox = [{ id: "k1", at: NOW - 3 * DAY, atts: [{ name: "z.zip", bytes: await zip({
    "a.pdf": await otherPdf("ka"), "b.pdf": await otherPdf("kb"),
  }) }] }];
  // The run "dies" after the first member: every write after the first registry upsert fails.
  let upserts = 0;
  db.fault = (c) => c.table === "email_skipped_attachments" && c.op === "upsert" && ++upserts > 1;
  await sync();
  assert.equal(regKeys().length, 1);
  assert.equal(watermark(), WM_START);
  db.fault = () => false;
  const calls = modelCalls;
  await sync();
  assert.equal(modelCalls - calls, 1, "only the member that was not saved is read again");
  assert.equal(regKeys().length, 2);
  assert.equal(watermark(), iso(NOW - 3 * DAY));
});

test("[ARCHIEF-WAAR] a member kept as unreadable reaches no reader through the UPLOAD-TRUTH-1 drain", async () => {
  seedAccount("gmail");
  process.env.SYNC_MAX_ATTEMPTS = "1";
  try {
    mailbox = [{ id: "u1", at: NOW - 3 * DAY, atts: [{ name: "z.zip", bytes: await zip({ "a.pdf": await otherPdf("ua") }) }] }];
    modelFault = () => 529;
    await sync(); // gives up on the member at once (SYNC_MAX_ATTEMPTS=1) and keeps it visibly
  } finally {
    delete process.env.SYNC_MAX_ATTEMPTS;
  }
  modelFault = () => null;
  const unread = db.t("documents").filter((d) => d.ai_doc_type === "could_not_read");
  assert.equal(unread.length, 1, "the member is kept as could_not_read, owner-visible");
  assert.equal(unread[0].source, "email");
  assert.deepEqual(regKeys(), [mk("u1", "z.zip", "a.pdf")], "and registered, so the next sync knows it");
  assert.equal(watermark(), iso(NOW - 3 * DAY), "a durable give-up lets the mail progress");

  const calls = modelCalls;
  await sync();
  let ran = 0, delivered = 0;
  const report = await runIntakeDrain({
    pipeline: db.client(),
    run: async () => { ran++; return { kind: "resumed" }; },
    deliver: async () => { delivered++; return { kind: "delivered" }; },
  });
  assert.equal(ran, 0, "the drain never hands an e-mail document to the reader");
  assert.equal(delivered, 0, "the notice pass is scoped to the upload door; the e-mail road has its skipped panel");
  assert.equal(report.notices.kind, "scanned");
  assert.equal(modelCalls, calls, "no second model read — not by the next sync, not by the drain");
});

test("[ARCHIEF-WAAR] the legacy 'cannot read .zip' row gives way once the archive is really handled", async () => {
  // Production holds ~49 of these rows from before archives were opened. [OVERSLAG-VERJAART] keeps
  // them from counting as "known", so the archive is opened; once every member is durable the
  // stale sentence is removed — the panel must not keep saying a handled zip could not be read.
  seedAccount("gmail");
  await tillMail("v1");
  db.t("email_skipped_attachments").push({
    user_id: U, source_message_id: "v1:dag.zip", filename: "dag.zip",
    reason: ".zip-bestanden kunnen wij niet lezen", created_at: "2026-08-10T00:00:00Z",
  });
  await sync();
  assert.deepEqual(regKeys(), [mk("v1", "dag.zip", "dagafsluiting.pdf")], "the stale archive row is gone, the member row is there");
  assert.equal(db.t("documents").length, 1);
  assert.equal(watermark(), iso(NOW - 3 * DAY));
});

test("[ARCHIEF-WAAR] the legacy row STAYS while the archive is not yet handled", async () => {
  seedAccount("gmail");
  await tillMail("v2");
  db.t("email_skipped_attachments").push({
    user_id: U, source_message_id: "v2:dag.zip", filename: "dag.zip",
    reason: ".zip-bestanden kunnen wij niet lezen", created_at: "2026-08-10T00:00:00Z",
  });
  db.storageFault = () => true;
  await sync();
  assert.deepEqual(regKeys(), ["v2:dag.zip"], "nothing was handled, so nothing is replaced");
});

test("[ARCHIEF-WAAR] a member proven a duplicate by its bytes is known as one, and never read again", async () => {
  seedAccount("gmail");
  const member = await otherPdf("dup-1");
  // The same bytes are already in the administration (uploaded by hand earlier).
  db.t("documents").push({
    id: "existing-doc", user_id: U, file_name: "eerder.pdf", content_hash: computeContentHash(member),
    trashed: false, invoice_id: null, source: "upload",
  });
  mailbox = [{ id: "d1", at: NOW - 3 * DAY, atts: [{ name: "z.zip", bytes: await zip({ "a.pdf": member }) }] }];
  modelVerdict = {
    is_invoice: true, confidence: 0.95, reason: "factuur", document_kind: "invoice",
    vendor_name: "Leverancier BV", invoice_number: "DUP-1", invoice_date: "2026-09-10",
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
  };
  const r = await sync();
  assert.equal(r.errors, 0);
  // An invoice verdict can take the reader more than one call (its own second pass); the number
  // that matters is the one below — nothing at all on the next sync.
  assert.ok(modelCalls >= 1);
  assert.deepEqual(regKeys(), [`${mk("d1", "z.zip", "a.pdf")}:dubbel`], "the member is on record as a duplicate");
  assert.equal(db.t("documents").length, 1, "no second copy of the bytes");
  assert.equal(db.t("invoices").length, 0, "and no second invoice");
  assert.equal(watermark(), iso(NOW - 3 * DAY), "a proven duplicate is a durable outcome");
  const s = snapshot();
  await sync();
  assert.deepEqual(snapshot(), s, "the next sync knows it through the :dubbel fold — zero reads, zero rows");
});

// ── [ARCHIEF-WAAR] review round 1 ─────────────────────────────────────────────────────────────

/** Rewrite every occurrence of one entry name inside a real zip (same length), in both headers. */
function renameEntry(buf: Buffer, from: string, to: string): Buffer {
  assert.equal(from.length, to.length, "fixture: same-length rename keeps every offset valid");
  const out = Buffer.from(buf);
  const a = Buffer.from(from), b = Buffer.from(to);
  let i = 0, n = 0;
  while ((i = out.indexOf(a, i)) !== -1) { b.copy(out, i); i += a.length; n++; }
  assert.equal(n, 2, "fixture: renamed in the local header and in the central directory");
  return out;
}

test("[ARCHIEF-WAAR] a loose 'bundle — invoice.pdf' and bundle.zip's invoice.pdf keep separate outcomes", async () => {
  seedAccount("gmail");
  mailbox = [{ id: "k1", at: NOW - 3 * DAY, atts: [
    { name: "bundle — invoice.pdf", bytes: await otherPdf("loose-1"), mime: "application/pdf" },
    { name: "bundle.zip", bytes: await zip({ "invoice.pdf": await otherPdf("member-1") }) },
  ] }];
  await sync();
  assert.equal(modelCalls, 2, "both documents are read");
  const rows = registry();
  assert.equal(rows.length, 2, "each has its own durable outcome — one row may not stand for both");
  assert.equal(new Set(rows.map((r) => r.source_message_id)).size, 2);
  assert.ok(rows.some((r) => r.source_message_id === "k1:bundle — invoice.pdf"), "the loose key is unchanged");
  assert.equal(watermark(), iso(NOW - 3 * DAY));
  const s = snapshot();
  await sync();
  assert.deepEqual(snapshot(), s, "and both are known next time");
});

test("[ARCHIEF-WAAR] a member is not skipped because a LOOSE attachment of the same display name is known", async () => {
  seedAccount("gmail");
  // The loose attachment was handled on an earlier sync.
  db.t("email_skipped_attachments").push({
    user_id: U, source_message_id: "k2:bundle — invoice.pdf", filename: "bundle — invoice.pdf",
    reason: "geen factuur (eerder)", created_at: "2026-09-01T00:00:00Z",
  });
  mailbox = [{ id: "k2", at: NOW - 3 * DAY, atts: [
    { name: "bundle — invoice.pdf", bytes: await otherPdf("loose-2"), mime: "application/pdf" },
    { name: "bundle.zip", bytes: await zip({ "invoice.pdf": await otherPdf("member-2") }) },
  ] }];
  await sync();
  assert.equal(modelCalls, 1, "the member is read — it was never handled");
  assert.equal(registry().length, 2, "and gets its own row next to the loose one");
  assert.equal(watermark(), iso(NOW - 3 * DAY));
});

test("[ARCHIEF-WAAR] two kept till closings, one loose and one in a zip, with the same display name are two documents", async () => {
  seedAccount("gmail");
  mailbox = [{ id: "k3", at: NOW - 3 * DAY, atts: [
    { name: "dag — dagafsluiting.pdf", bytes: await tillPdf(iso(NOW - 4 * DAY).slice(0, 10), 100), mime: "application/pdf" },
    { name: "dag.zip", bytes: await zip({ "dagafsluiting.pdf": await tillPdf(iso(NOW - 3 * DAY).slice(0, 10), 200) }) },
  ] }];
  await sync();
  assert.equal(db.t("documents").length, 2, "both closings are stored");
  assert.equal(registry().length, 2, "and both are registered, each under its own key");
  assert.equal(watermark(), iso(NOW - 3 * DAY));
});

test("[ARCHIEF-WAAR] members of two archives in one message never share a key", async () => {
  seedAccount("gmail");
  mailbox = [{ id: "k4", at: NOW - 3 * DAY, atts: [
    { name: "a.zip", bytes: await zip({ "b — c.pdf": await otherPdf("arch-1") }) },
    { name: "a — b.zip", bytes: await zip({ "c.pdf": await otherPdf("arch-2") }) },
  ] }];
  await sync();
  assert.equal(modelCalls, 2, "both members are read");
  assert.equal(registry().length, 2, "each on record under its own key");
  assert.equal(watermark(), iso(NOW - 3 * DAY));
});

test("[ARCHIEF-WAAR] a zip with two entries of the same path is refused whole, durably, with an action", async () => {
  seedAccount("gmail");
  const twin = renameEntry(await zip({ "invoice.pdf": await otherPdf("twin-a"), "invoicf.pdf": await otherPdf("twin-b") }),
    "invoicf.pdf", "invoice.pdf");
  mailbox = [{ id: "k5", at: NOW - 3 * DAY, atts: [{ name: "twee.zip", bytes: twin }] }];
  await sync();
  assert.equal(modelCalls, 0, "neither copy is read: which one is which cannot be told");
  const rows = registry();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_message_id, "k5:twee.zip", "refused under the archive's own key");
  assert.match(rows[0].reason, /dezelfde naam/);
  assert.match(rows[0].reason, /afzender/, "with an action the owner can take");
  assert.equal(watermark(), iso(NOW - 3 * DAY), "a durable refusal does not freeze the mailbox");
});

// ── the interval between a stored file and its row ────────────────────────────────────────────

test("[ARCHIEF-WAAR] a folders failure during a keep leaves no orphan file, holds the member, and the retry completes", async () => {
  seedAccount("gmail");
  await tillMail("f1");
  db.fault = (c) => c.table === "folders";
  const r = await sync();
  assert.ok(r.errors > 0, "the failure is counted");
  assert.equal(db.storage.size, 0, "no file left in storage without a row pointing at it");
  assert.equal(db.t("documents").length, 0);
  assert.deepEqual(regKeys(), [], "not registered — the member is unresolved");
  assert.equal(watermark(), WM_START, "and the mail stays open");
  db.fault = () => false;
  await sync();
  assert.equal(db.storage.size, 1, "exactly one stored file after the retry");
  assert.equal(db.t("documents").length, 1);
  assert.equal(registry().length, 1);
  assert.equal(watermark(), iso(NOW - 3 * DAY));
});

test("[ARCHIEF-WAAR] a keep that throws after the upload removes the upload", async () => {
  seedAccount("gmail");
  await tillMail("f2");
  db.fault = (c) => (c.table === "documents" && c.op === "insert" ? "throw" : false);
  await sync();
  assert.equal(db.storage.size, 0, "the uploaded object is removed when the row write throws");
  assert.deepEqual(regKeys(), []);
  assert.equal(watermark(), WM_START);
});

test("[ARCHIEF-WAAR] a cleanup that fails is surfaced, and the member still stays unresolved", async () => {
  seedAccount("gmail");
  await tillMail("f3");
  db.fault = (c) => c.table === "documents" && c.op === "insert";
  db.removeFault = () => true;
  await sync();
  assert.equal(db.storage.size, 1, "fixture: the removal really failed");
  // reportHandledFailure STARTS its system_events insert without awaiting it (a report must never
  // delay or break the failure path it reports on). Here the process lives on, so the row lands and
  // is observed; in production it is best effort — a function that returns first, or an insert
  // that fails, leaves no row. What this proves is that the alarm is raised, not that it persists.
  for (let i = 0; i < 50 && !db.t("system_events").some((e) => e.tag === "ARCHIEF-WAAR"); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const events = db.t("system_events").filter((e) => e.tag === "ARCHIEF-WAAR");
  assert.equal(events.length, 1, "the orphan is raised on the alarm channel (row observed here; best effort in production)");
  assert.equal(events[0].severity, "data-integrity");
  assert.deepEqual(regKeys(), []);
  assert.equal(watermark(), WM_START);
});

test("[ARCHIEF-WAAR] an archive whose directory hides an entry is refused durably and does not freeze the mailbox", async () => {
  seedAccount("gmail");
  const buf = await zip({ "a.pdf": await otherPdf("hidden-a"), "b.pdf": await otherPdf("hidden-b") });
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  buf.writeUInt16LE(1, eocd + 8);
  buf.writeUInt16LE(1, eocd + 10);
  mailbox = [{ id: "h1", at: NOW - 3 * DAY, atts: [{ name: "stil.zip", bytes: buf }] }];
  await sync();
  assert.equal(modelCalls, 0, "nothing from an archive we cannot fully account for is read");
  assert.deepEqual(regKeys(), ["h1:stil.zip"], "refused under the archive's own key");
  assert.match(registry()[0].reason, /afzender/);
  assert.equal(watermark(), iso(NOW - 3 * DAY));
});

// ── [ARCHIEF-WAAR] review round 3 — ZIP64 through the real sync ───────────────────────────────

test("[ARCHIEF-WAAR] ZIP64: small till archives in ZIP64 form are kept, read by no model", async () => {
  const { zip64ify } = await import("./support/zip64-fixture");
  seedAccount("gmail");
  const d4 = iso(NOW - 4 * DAY).slice(0, 10), d3 = iso(NOW - 3 * DAY).slice(0, 10);
  mailbox = [
    { id: "z1", at: NOW - 4 * DAY, atts: [{ name: "dag64.zip",
      bytes: zip64ify(await zip({ "dagafsluiting.pdf": await tillPdf(d4, 111) }), { sizes: true }) }] },
    { id: "z2", at: NOW - 3 * DAY, atts: [{ name: "dag64.zip",
      bytes: zip64ify(await zip({ "dagafsluiting.pdf": await tillPdf(d3, 222) }), { sizes: true, offsets: true, endRecord: true, extensible: 24 }) }] },
  ];
  await sync();
  assert.equal(modelCalls, 0, "a till closing is recognised locally, ZIP64 or not");
  assert.equal(db.t("documents").length, 2, "both closings are stored");
  assert.deepEqual(regKeys(), [mk("z1", "dag64.zip", "dagafsluiting.pdf"), mk("z2", "dag64.zip", "dagafsluiting.pdf")].sort());
  assert.equal(db.t("invoices").length, 0);
  assert.equal(db.t("daily_turnover").length, 0);
  assert.equal(watermark(), iso(NOW - 3 * DAY));
});

test("[ARCHIEF-WAAR] ZIP64: an archive with inconsistent ZIP64 records is refused durably and truthfully", async () => {
  const { zip64ify } = await import("./support/zip64-fixture");
  seedAccount("gmail");
  const d = iso(NOW - 3 * DAY).slice(0, 10);
  mailbox = [{ id: "z3", at: NOW - 3 * DAY, atts: [{ name: "stuk64.zip",
    bytes: zip64ify(await zip({ "dagafsluiting.pdf": await tillPdf(d) }), { sizes: true, offsets: true, endRecord: true, locatorSkew: 4 }) }] }];
  await sync();
  assert.equal(modelCalls, 0);
  assert.equal(db.t("documents").length, 0, "nothing from an archive whose records disagree is kept as if it were sound");
  assert.deepEqual(regKeys(), ["z3:stuk64.zip"], "refused under the archive's own key");
  assert.match(registry()[0].reason, /beschadigd/);
  assert.match(registry()[0].reason, /afzender/);
  assert.equal(watermark(), iso(NOW - 3 * DAY), "a durable refusal does not freeze the mailbox");
});

// ── [ARCHIEF-WAAR] review round 4 — two attachments with the same name in one message ─────────
//
// A sender that exports "bundle.zip" twice into one mail is ordinary. Each archive is its own
// attachment, so each member is its own document — even when both hold an "invoice.pdf".

/** A slice of `a`'s base64 that does not occur in `b`'s — how a request carrying `a` is recognised. */
function needleOf(a: Buffer, b: Buffer): string {
  const [ab, bb] = [a.toString("base64"), b.toString("base64")];
  let at = 0;
  while (at < ab.length && ab[at] === bb[at]) at++;
  const needle = ab.slice(Math.max(0, at - 8), at + 64);
  assert.ok(!bb.includes(needle), "fixture: the needle identifies one PDF alone");
  return needle;
}

async function twoBundles(id: string, pdfs: Buffer[]): Promise<Mail> {
  return { id, at: NOW - 3 * DAY, atts: [
    { name: "bundle.zip", bytes: await zip({ "invoice.pdf": pdfs[0] }) },
    // Inline on Outlook, so one arrives with contentBytes and the other through $value.
    { name: "bundle.zip", inline: true, bytes: await zip({ "invoice.pdf": pdfs[1] }) },
  ] };
}

const BUNDLES = ["bundle.zip", "bundle (2).zip"];

for (const provider of ["gmail", "outlook"] as const) {
  test(`[ARCHIEF-WAAR] ${provider}: two attachments named bundle.zip, each with its own invoice.pdf, are two members`, async () => {
    seedAccount(provider);
    const pdfs = [await otherPdf("same-name-1"), await otherPdf("same-name-2")];
    mailbox = [await twoBundles("d1", pdfs)];
    const bodies: string[] = [];
    modelFault = (body) => { bodies.push(body); return null; };
    const r = await sync();
    assert.equal(r.errors, 0);
    assert.equal(modelCalls, 2, "both members are read — neither hides behind the other's name");
    assert.ok(bodies.some((b) => b.includes(needleOf(pdfs[0], pdfs[1]))), "the first invoice.pdf was read");
    assert.ok(bodies.some((b) => b.includes(needleOf(pdfs[1], pdfs[0]))), "and so was the second");
    assert.deepEqual(regKeys(), BUNDLES.map((n) => mk("d1", n, "invoice.pdf")).sort(),
      "each member has an outcome under its own key");
    assert.equal(watermark(), iso(NOW - 3 * DAY));

    const before1 = snapshot();
    await sync();
    assert.deepEqual(snapshot(), before1, "and a second sync knows both: nothing is read again");
  });

  for (const failing of [0, 1] as const) {
    test(`[ARCHIEF-WAAR] ${provider}: same-named archives, the ${failing ? "second" : "first"} member fails — the mark holds and a later pass finishes it`, async () => {
      seedAccount(provider);
      const pdfs = [await otherPdf("same-name-1"), await otherPdf("same-name-2")];
      mailbox = [await twoBundles("d2", pdfs)];
      const needle = needleOf(pdfs[failing], pdfs[1 - failing]);
      modelFault = (body) => (body.includes(needle) ? 529 : null);
      const r1 = await sync();
      assert.ok(r1.errors > 0, "the failed member is counted");
      assert.deepEqual(regKeys(), [mk("d2", BUNDLES[1 - failing], "invoice.pdf")],
        "only the member that was read is on record — the failed one is not covered by its namesake");
      assert.equal(watermark(), WM_START, "the mark holds for the member that failed");

      // The retry. Outlook lists the attachments the other way round this time: which archive is
      // "bundle.zip" follows the attachment's id, not its place in the list.
      outlookListReversed = true;
      const bodies: string[] = [];
      modelFault = (body) => { bodies.push(body); return null; };
      const calls = modelCalls;
      await sync();
      assert.equal(modelCalls - calls, 1, "only the failed member is read again");
      assert.ok(bodies[0].includes(needle), "and it is the failed one, not its namesake");
      assert.deepEqual(regKeys(), BUNDLES.map((n) => mk("d2", n, "invoice.pdf")).sort());
      assert.equal(watermark(), iso(NOW - 3 * DAY), "a later pass finishes the mail");
    });
  }

  test(`[ARCHIEF-WAAR] ${provider}: a member registered under the old shared key keeps it; its namesake is still read`, async () => {
    // Before this correction both members registered as bundle.zip's invoice.pdf. That row stays
    // readable: it still belongs to the first archive, and the second one is not written off by it.
    seedAccount(provider);
    const pdfs = [await otherPdf("same-name-1"), await otherPdf("same-name-2")];
    mailbox = [await twoBundles("d3", pdfs)];
    db.t("email_skipped_attachments").push({
      user_id: U, source_message_id: mk("d3", "bundle.zip", "invoice.pdf"), filename: "bundle — invoice.pdf",
      reason: "geen factuur", created_at: "2026-09-01T00:00:00Z",
    });
    const bodies: string[] = [];
    modelFault = (body) => { bodies.push(body); return null; };
    await sync();
    assert.equal(modelCalls, 1, "the first member is known by its old key and not read again");
    assert.ok(bodies[0].includes(needleOf(pdfs[1], pdfs[0])), "the second member is read");
    assert.deepEqual(regKeys(), BUNDLES.map((n) => mk("d3", n, "invoice.pdf")).sort());
    assert.equal(watermark(), iso(NOW - 3 * DAY));
  });
}

for (const provider of ["gmail", "outlook"] as const) {
  test(`[ARCHIEF-WAAR] ${provider}: two LOOSE attachments named invoice.pdf are two documents too`, async () => {
    // The key a loose attachment is known by is built from the same name, so the same correction
    // has to hold for it — and does, because the name is made distinct before any door is chosen.
    seedAccount(provider);
    const pdfs = [await otherPdf("loose-same-1"), await otherPdf("loose-same-2")];
    mailbox = [{ id: "d4", at: NOW - 3 * DAY, atts: [
      { name: "invoice.pdf", mime: "application/pdf", bytes: pdfs[0] },
      { name: "invoice.pdf", mime: "application/pdf", inline: true, bytes: pdfs[1] },
    ] }];
    await sync();
    assert.equal(modelCalls, 2, "both are read");
    // Round 5: a loose pair has keys of its own namespace, so no row written from now on can be
    // mistaken for the one the old code wrote under the shared name.
    assert.deepEqual(regKeys(), [tk("d4", "invoice (2).pdf"), tk("d4", "invoice.pdf")].sort());
    assert.equal(watermark(), iso(NOW - 3 * DAY));
  });
}

// ── [ARCHIEF-WAAR] review round 5 — the row the OLD code wrote for a loose same-name pair ────────
//
// Before round 4, two loose attachments named invoice.pdf in one message shared the key
// `<id>:invoice.pdf`, and whichever wrote first owned the row. That row still exists. Nothing in it
// says which of the two it was for, so it may not be handed to the first attachment on trust.

/** The key of a loose attachment that shares its name with another in the same message. */
const tk = (id: string, name: string) => `twin:${JSON.stringify([id, name])}`;

async function loosePair(id: string, pdfs: Buffer[]): Promise<Mail> {
  return { id, at: NOW - 3 * DAY, atts: [
    { name: "invoice.pdf", mime: "application/pdf", bytes: pdfs[0] },
    { name: "invoice.pdf", mime: "application/pdf", inline: true, bytes: pdfs[1] },
  ] };
}

/** What the old code left behind when it IMPORTED one of the two: an invoice under the shared key. */
function legacyInvoice(id: string, bytes: Buffer) {
  db.t("documents").push({
    id: `doc-${id}`, user_id: U, file_name: "invoice.pdf", content_hash: computeContentHash(bytes),
    trashed: false, invoice_id: `inv-${id}`, source: "email",
  });
  db.t("invoices").push({
    id: `inv-${id}`, receiver_id: U, source: "email", source_message_id: `${id}:invoice.pdf`,
    document_id: `doc-${id}`, invoice_number: `OUD-${id}`, status: "received",
  });
}

/** What the old code left behind when it only REGISTERED one of the two: a row with no bytes behind it. */
function legacySkipRow(id: string) {
  db.t("email_skipped_attachments").push({
    user_id: U, source_message_id: `${id}:invoice.pdf`, filename: "invoice.pdf",
    reason: "geen factuur", created_at: "2026-08-01T00:00:00Z",
  });
}

const AMBIGUOUS = /dezelfde naam/;

for (const provider of ["gmail", "outlook"] as const) {
  test(`[ARCHIEF-WAAR] ${provider}: the old shared row proven to be the SECOND attachment's — the first is read, not written off`, async () => {
    seedAccount(provider);
    const pdfs = [await otherPdf("legacy-first"), await otherPdf("legacy-second")];
    mailbox = [await loosePair("e1", pdfs)];
    legacyInvoice("e1", pdfs[1]); // the old code imported the SECOND; the first was never handled
    const bodies: string[] = [];
    modelFault = (body) => { bodies.push(body); return null; };
    const r = await sync();
    assert.equal(r.errors, 0);
    assert.equal(modelCalls, 1, "exactly one read");
    assert.ok(bodies[0].includes(needleOf(pdfs[0], pdfs[1])), "and it is the FIRST attachment, the one the old row never covered");
    assert.deepEqual(regKeys(), [tk("e1", "invoice.pdf")], "the first now has an outcome of its own");
    assert.equal(registry().filter((x) => AMBIGUOUS.test(x.reason)).length, 0, "nothing is ambiguous: the evidence decided");
    assert.equal(db.t("invoices").length, 1, "the old invoice is untouched and not doubled");
    assert.equal(watermark(), iso(NOW - 3 * DAY));
    const before1 = snapshot();
    await sync();
    assert.deepEqual(snapshot(), before1, "a second sync spends nothing");
  });

  test(`[ARCHIEF-WAAR] ${provider}: the old shared row proven to be the FIRST attachment's — the second is read`, async () => {
    seedAccount(provider);
    const pdfs = [await otherPdf("legacy-first"), await otherPdf("legacy-second")];
    mailbox = [await loosePair("e2", pdfs)];
    legacyInvoice("e2", pdfs[0]);
    const bodies: string[] = [];
    modelFault = (body) => { bodies.push(body); return null; };
    await sync();
    assert.equal(modelCalls, 1);
    assert.ok(bodies[0].includes(needleOf(pdfs[1], pdfs[0])), "the second attachment is the one read");
    assert.deepEqual(regKeys(), [tk("e2", "invoice (2).pdf")]);
    assert.equal(registry().filter((x) => AMBIGUOUS.test(x.reason)).length, 0);
    assert.equal(watermark(), iso(NOW - 3 * DAY));
  });

  test(`[ARCHIEF-WAAR] ${provider}: an old shared row with NO evidence is not given to either — the owner is told, per attachment`, async () => {
    seedAccount(provider);
    const pdfs = [await otherPdf("legacy-first"), await otherPdf("legacy-second")];
    mailbox = [await loosePair("e3", pdfs)];
    legacySkipRow("e3"); // "geen factuur" — for one of the two, and nothing says which
    const r = await sync();
    assert.equal(r.errors, 0);
    assert.equal(modelCalls, 0, "nothing is read on a guess");
    const rows = registry().filter((x) => x.source_message_id.startsWith("twin:"));
    assert.deepEqual(rows.map((x) => x.source_message_id).sort(), [tk("e3", "invoice (2).pdf"), tk("e3", "invoice.pdf")].sort(),
      "each attachment the old row might not cover has its own row");
    for (const row of rows) {
      assert.match(row.reason, AMBIGUOUS, "the row says what is uncertain");
      assert.match(row.reason, /Uploaden/, "and what the owner can do about it");
    }
    assert.ok(regKeys().includes("e3:invoice.pdf"), "the old row itself is left as it was");
    assert.equal(watermark(), iso(NOW - 3 * DAY), "a stated ambiguity is a durable outcome; the mailbox moves on");
    const before1 = snapshot();
    await sync();
    assert.deepEqual(snapshot(), before1, "and it is stated once, not on every sync");
  });

  test(`[ARCHIEF-WAAR] ${provider}: an old shared row, one attachment's bytes proven stored — only the other is ambiguous`, async () => {
    seedAccount(provider);
    const pdfs = [await otherPdf("legacy-first"), await otherPdf("legacy-second")];
    mailbox = [await loosePair("e4", pdfs)];
    legacySkipRow("e4");
    // The first attachment's exact bytes are in the administration (kept by the old code).
    db.t("documents").push({
      id: "doc-e4", user_id: U, file_name: "invoice.pdf", content_hash: computeContentHash(pdfs[0]),
      trashed: false, invoice_id: null, source: "email",
    });
    await sync();
    assert.equal(modelCalls, 0);
    const rows = registry().filter((x) => x.source_message_id.startsWith("twin:"));
    assert.deepEqual(rows.map((x) => x.source_message_id), [tk("e4", "invoice (2).pdf")],
      "the stored one needs nothing; the other is stated as uncertain");
    assert.match(rows[0].reason, AMBIGUOUS);
    assert.equal(watermark(), iso(NOW - 3 * DAY));
  });

  test(`[ARCHIEF-WAAR] ${provider}: a NEW loose pair, one failing, is still finished by a retry — no ambiguity`, async () => {
    // Round 4's behaviour for a pair that arrives after the fix: nothing the fix itself writes can
    // look like the old shared row, so a half-finished pair is simply finished.
    seedAccount(provider);
    const pdfs = [await otherPdf("fresh-first"), await otherPdf("fresh-second")];
    mailbox = [await loosePair("e5", pdfs)];
    const needle = needleOf(pdfs[1], pdfs[0]);
    modelFault = (body) => (body.includes(needle) ? 529 : null);
    const r1 = await sync();
    assert.ok(r1.errors > 0);
    assert.deepEqual(regKeys(), [tk("e5", "invoice.pdf")]);
    assert.equal(watermark(), WM_START, "the mark holds for the failed one");
    outlookListReversed = true;
    const bodies: string[] = [];
    modelFault = (body) => { bodies.push(body); return null; };
    const calls = modelCalls;
    await sync();
    assert.equal(modelCalls - calls, 1, "only the failed one is read again");
    assert.ok(bodies[0].includes(needle));
    assert.deepEqual(regKeys(), [tk("e5", "invoice (2).pdf"), tk("e5", "invoice.pdf")].sort());
    assert.equal(registry().filter((x) => AMBIGUOUS.test(x.reason)).length, 0, "and nothing is ambiguous");
    assert.equal(watermark(), iso(NOW - 3 * DAY));
  });
}

for (const [label, fault] of [
  // Nothing reads `documents` before PHASE 0 settles the old row, so this fails that read alone.
  ["the evidence read fails", (c: { table: string; op: string }) => c.table === "documents" && c.op === "select"],
  ["the uncertainty cannot be written", (c: { table: string; op: string }) => c.table === "email_skipped_attachments" && c.op === "upsert"],
] as const) {
  test(`[ARCHIEF-WAAR] an old shared row where ${label}: UNKNOWN — nothing read, nothing completed, and the retry settles it`, async () => {
    seedAccount("gmail");
    const pdfs = [await otherPdf("legacy-first"), await otherPdf("legacy-second")];
    mailbox = [await loosePair("e6", pdfs)];
    legacySkipRow("e6");
    db.fault = fault;
    const r = await sync();
    assert.ok(r.errors > 0, "the failure is counted");
    assert.equal(modelCalls, 0, "nothing is read while the old row is unsettled");
    assert.deepEqual(regKeys(), ["e6:invoice.pdf"], "and nothing is written in its place");
    assert.equal(watermark(), WM_START, "the mail stays open");
    db.fault = () => false;
    await sync();
    assert.equal(modelCalls, 0);
    assert.deepEqual(regKeys(), ["e6:invoice.pdf", tk("e6", "invoice (2).pdf"), tk("e6", "invoice.pdf")].sort());
    assert.equal(watermark(), iso(NOW - 3 * DAY));
  });
}

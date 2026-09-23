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
before(async () => {
  ({ textToPdf } = await import(u("lib/text-to-pdf.ts")) as any);
  ({ syncUserEmails } = await import(u("lib/email-integration.ts")) as any);
  ({ currentPeriod, limitForPlan } = await import(u("lib/fair-use-usage.ts")) as any);
  ({ runIntakeDrain } = await import(u("lib/intake-drain.ts")) as any);
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

// ── the model ─────────────────────────────────────────────────────────────────────────────────

let modelCalls = 0;
/** Return a status to fail THIS call (e.g. 529 = overloaded, transient). */
let modelFault: (body: string, n: number) => number | null = () => null;
const unknownUrls: string[] = [];

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

function anthropicAnswer() {
  const answer = { is_invoice: false, confidence: 0.95, reason: "geen factuur (testantwoord)", document_kind: "other" };
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
      return json({
        value: m.atts.map((a, i) => a.item === "message"
          ? { "@odata.type": "#microsoft.graph.itemAttachment", id: `a${i}`, name: "Fwd: dagafsluiting", contentType: "message/rfc822", size: a.bytes.length + 2000 }
          : {
            "@odata.type": "#microsoft.graph.fileAttachment", id: `a${i}`, name: a.name,
            contentType: a.mime ?? "application/x-zip-compressed", size: a.bytes.length,
            // A large attachment comes back WITHOUT contentBytes; the walker must fetch $value.
            ...(a.inline ? { contentBytes: a.bytes.toString("base64") } : {}),
          }),
      });
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
  modelFault = () => null;
  mailbox = [];
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
  assert.deepEqual(regKeys(), ["g1:Jouw dagafsluiting - 1 — dagafsluiting.pdf"], "the member is registered; the archive has no stale row");
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
    "g2:bundel — dagafsluiting.pdf",
    "g2:bundel — readme.exe",
    "g2:bundel — winkel-a/factuur.pdf",
    "g2:bundel — winkel-b/factuur.pdf",
  ], "every member has a durable outcome under its own full-path key; chrome is silent");
  const exe = registry().find((x) => x.source_message_id.endsWith("readme.exe"))!;
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
  assert.deepEqual(regKeys(), ["o1:dag — dagafsluiting.pdf"]);
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
  assert.deepEqual(regKeys(), ["o2:dag — dagafsluiting.pdf"]);
  assert.equal(db.t("invoices").length, 0);
});

test("[ARCHIEF-WAAR] Outlook: a zip WITH inline contentBytes goes the same way", async () => {
  seedAccount("outlook");
  mailbox = [{ id: "o3", at: NOW - 2 * DAY, atts: [{ name: "b.zip", inline: true, bytes: await zip({ "x.pdf": await otherPdf("X") }) }] }];
  await sync();
  assert.equal(modelCalls, 1);
  assert.deepEqual(regKeys(), ["o3:b — x.pdf"]);
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
  assert.match(row.reason, /beschadigd|wachtwoord/);
  assert.match(row.reason, /Uploaden/, "and names what the owner can do");
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
  const row = registry().find((x) => x.source_message_id === "l1:bom — bom.pdf");
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
  assert.deepEqual(regKeys(), ["s1:dag — dagafsluiting.pdf"]);
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
  assert.deepEqual(regKeys(), ["s3:dag — dagafsluiting.pdf"]);
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
  assert.deepEqual(regKeys(), ["u1:z — a.pdf"], "and registered, so the next sync knows it");
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
  assert.deepEqual(regKeys(), ["v1:dag — dagafsluiting.pdf"], "the stale archive row is gone, the member row is there");
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

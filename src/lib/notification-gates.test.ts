// [NOTIFY] Pure node test — run: npx tsx --test src/lib/notification-gates.test.ts
//
// The findings from the audit of the notification + message surface, held as gates.
//
// They share one shape. Every one of them is a place where the app KNEW something — that a
// notification was refused, that a message could not be sent, that a name could not be read, that
// the list on screen was not the whole list — and the person it concerned was shown something else,
// or nothing. None of it throws, so none of it is visible from a log or a Sentry alert; the screen
// simply looks calm and says the wrong thing.
//
// They are source-level because that is where these defects live: not in what a function returns,
// but in which client it uses, which branch swallows a result, and which sentence is printed when a
// read failed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

/**
 * Source with comments stripped. These files explain the very mistakes the gates look for, so a
 * gate reading the raw text would match its own description instead of the code.
 *
 * Same delimiter rule as lifecycle-gates.test.ts, and for the same reason ([STRIPPER-BLIND]): a
 * real comment always follows a line start, whitespace, or one of `{(,;=`, while the `/*` inside a
 * string like `accept=".pdf,image/*"` follows a letter or a dot. Without that rule this helper
 * deletes live code, and every doesNotMatch gate over the hole then passes vacuously.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/(^|[\s{(,;=])\/\*[\s\S]*?\*\//g, "$1 ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Every .ts/.tsx under src, so a new file cannot slip past these rules by being new. */
function sourceFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Two shapes, because there are two ways to write the row directly: straight through
// `.from('notifications').insert(`, and the split form a file needs when the payload carries a
// column that is not in the generated types — `const x = pipeline.from('notifications') as any`
// followed by `x.insert(`. The canonical writer uses the second, and a gate that only knew the
// first would have gone quiet about both the moment it did.
const DIRECT_INSERT =
  /from\(\s*['"]notifications['"]\s*\)\s*(\.insert|as\s+any[\s\S]{0,400}?\.insert)/;

// ── [NOTIFY-EEN-DEUR] ────────────────────────────────────────────────────────
test("[NOTIFY-EEN-DEUR] every notification is written through the one writer", () => {
  // docs/PUSH_NOTIFICATIONS.md draws the whole feature as one line:
  //     event → createNotification() → sendPushToUser() → the device
  // That was the design. In practice four files called createNotification and TWENTY wrote the row
  // themselves with `pipeline.from('notifications').insert(...)`, which does everything except the
  // second half of that arrow. So push was built, tested, documented, opt-in-able in Settings, and
  // wired to almost nothing an owner would want a phone notification for — a new message from your
  // accountant, an invoice that failed to send, a payment booked, a question about a document: all
  // of them wrote a row and stopped.
  //
  // Nothing could go red over it, because both halves work perfectly on their own.
  const offenders = sourceFiles()
    .filter((f) => f !== "src/lib/notifications.ts" && !f.endsWith(".test.ts"))
    .filter((f) => DIRECT_INSERT.test(code(f)));

  assert.deepEqual(
    offenders,
    [],
    "notifications rows must be written by createNotification() — a direct insert writes the bell " +
      "but never reaches the device, and swallows a refused write:\n  " + offenders.join("\n  "),
  );

  // Positive control for the walk AND the regex: the one writer does contain the shape, so an
  // empty offender list above means "nobody else does it", not "the search found nothing".
  assert.match(
    code("src/lib/notifications.ts"),
    DIRECT_INSERT,
    "the canonical writer must still be the thing that inserts — otherwise this gate proves nothing",
  );
});

test("[NOTIFY-EEN-DEUR] negative control — the gate catches the shape it is about", () => {
  assert.match("await pipeline.from('notifications').insert({ user_id: x })", DIRECT_INSERT);
  assert.match('await pipeline.from("notifications").insert({', DIRECT_INSERT);
  // The split form, which is how the canonical writer itself does it — and how any other file
  // would have to do it to write a hand-applied column. It must not be a way past this gate.
  assert.match(
    "const rows = pipeline.from('notifications') as any\n  const { error } = await rows.insert({",
    DIRECT_INSERT,
  );
  assert.doesNotMatch("await createNotification({ userId: x })", DIRECT_INSERT);
  // And it must still be about notifications: a relaxed handle on another table, followed much
  // later by an unrelated insert, is not this shape.
  assert.doesNotMatch("const rows = pipeline.from('documents') as any\n  await rows.insert({", DIRECT_INSERT);
});

// ── [NOTIFY-EERLIJK] ─────────────────────────────────────────────────────────
test("[NOTIFY-EERLIJK] the writer reads its own error, and does not push a row that was not written", () => {
  const src = code("src/lib/notifications.ts");

  // supabase-js does not throw on a rejected write. `await pipeline.from(...).insert(...)` with no
  // destructuring returns normally on an RLS refusal, a CHECK violation on `type`, or a dead
  // connection — and the caller, which had just booked the payment the notification is about, goes
  // on believing the owner was told.
  assert.match(
    src,
    /const\s*\{\s*error\s*\}\s*=\s*await\s+rows\.insert\(/,
    "the insert result must be destructured — an unread error is an unnoticed silence",
  );
  // `rows` is the relaxed handle on the SAME self-created service-role client, needed because
  // notifications.event_key is applied by hand and is not in the generated types. It must not have
  // become a second client, which is the mistake this file's header exists to prevent.
  assert.match(
    src,
    /const\s+rows\s*=\s*pipeline\.from\('notifications'\)\s*as\s+any/,
    "the relaxed handle must come from the pipeline client this function built, not a new one",
  );

  // And the order matters as much as the check. A push for a row that does not exist is worse than
  // no push: it repeats the title on the phone, and the tap lands on a bell with nothing in it.
  const errorBranch = src.indexOf("if (error)");
  const push = src.indexOf("sendPushToUser(");
  assert.ok(errorBranch > 0, "there must be an error branch");
  assert.ok(
    errorBranch < push,
    "the failed-write branch must return BEFORE the push — a device notification for a row that " +
      "does not exist is a claim the app cannot back up",
  );
  assert.match(
    src.slice(errorBranch, push),
    /return\s*\{\s*ok:\s*false/,
    "and it must actually return there",
  );
});

test("[ONTVANGEN-MELDING] the event key is only ever SENT when a caller asked for it", () => {
  const src = code("src/lib/notifications.ts");

  // Forty existing call sites report things that happened because a human pressed something. They
  // must keep writing exactly the row they wrote before — including on a database where
  // notifications.event_key does not exist yet. So the column is spread in conditionally, never
  // written as a plain `event_key: ... ?? null`, which would send it on every notification in the
  // app and turn one unapplied migration into forty broken doors.
  assert.match(
    src,
    /\.\.\.\(key\s*\?\s*\{\s*event_key:\s*key\s*\}\s*:\s*\{\}\)/,
    "event_key must be absent from the payload unless the caller supplied one",
  );
  assert.doesNotMatch(
    src,
    /event_key:\s*(eventKey|key)\s*\?\?/,
    "a defaulted event_key is sent on every write, including the forty that never asked",
  );

  // The meaning of the two error codes lives in one pure function, so the branch can be proved by
  // value (notification-event-key.test.ts) instead of by reading this file.
  assert.match(src, /classifyNotificationInsert\(error,\s*key\s*!==\s*null\)/,
    "the verdict must be computed from the real error and whether a key was actually sent");

  // And the duplicate arm must not push. The first run already sent that push; a second one arrives
  // with no row of its own, which is the exact duplicate the key exists to prevent.
  const already = src.indexOf("'already_reported'", src.indexOf("const verdict"));
  const push = src.indexOf("sendPushToUser(");
  assert.ok(already > 0 && already < push, "the already-reported arm must sit before the push");
  assert.match(
    src.slice(already, push),
    /return\s*\{\s*ok:\s*true,\s*error:\s*null,\s*duplicate:\s*true\s*\}/,
    "an event already reported returns ok WITHOUT writing or pushing a second time",
  );
});

// ── [NAAM-TEGENPARTIJ] ───────────────────────────────────────────────────────
test("[NAAM-TEGENPARTIJ] the message screens do not read profiles from the browser", () => {
  // RLS on profiles is `id = auth.uid()` plus ONE policy that lets an accountant read a linked
  // client. There is no policy the other way round, so a zzp'er reading his accountant's row from
  // the browser gets nothing back. Both message screens did exactly that: the conversation list
  // showed "Onbekend" with a "?" avatar, and the chat header showed "..." with the input field
  // reading "Bericht aan ...". Only for the owner — the accountant saw the names fine — which is
  // why it survived: the person who builds and demos this app is usually looking at the other side.
  for (const screen of [
    "src/app/dashboard/messages/page.tsx",
    "src/app/dashboard/messages/[id]/page.tsx",
  ]) {
    assert.doesNotMatch(
      code(screen),
      /from\(\s*['"]profiles['"]\s*\)/,
      `${screen} must not read profiles directly — RLS returns nothing for the owner's side`,
    );
  }

  // Positive control: the names have to come from somewhere, and it is the server.
  assert.match(code("src/app/dashboard/messages/page.tsx"), /\/api\/messages\/conversations/);
  assert.match(code("src/app/dashboard/messages/[id]/page.tsx"), /partner/);
});

test("[NAAM-TEGENPARTIJ] the send route reads BOTH profiles through the service-role client", () => {
  // The e-mail told one side and not the other. senderProfile is the caller's own row, so RLS
  // allowed it; receiverProfile was read with the SAME session client, and for a client writing to
  // his accountant that returns null — so the `if (senderProfile && receiverProfile?.email)` fell
  // through and no mail was sent. Accountant → client mailed; client → accountant did not. Nothing
  // on either screen said so, and the sibling route (/api/accountant/vraag-stukken) had always read
  // both sides through the pipeline.
  const src = code("src/app/api/messages/route.ts");
  const profileReads = src.match(/(\w+)\.from\(\s*['"]profiles['"]\s*\)/g) ?? [];
  assert.ok(profileReads.length >= 2, "the route reads both profiles");
  for (const read of profileReads) {
    assert.match(
      read,
      /^pipeline\./,
      `profiles must be read via the service-role client here, not "${read}" — RLS hides the ` +
        "accountant from his own client",
    );
  }
});

// ── [SERVER-ZEGT-WAAROM] ─────────────────────────────────────────────────────
test("[SERVER-ZEGT-WAAROM] the chat shows the server's refusal, not its own guess", () => {
  // The route refuses with a reason: 403 "je kunt alleen berichten sturen naar een gekoppelde klant
  // of boekhouder", 503 "de koppeling kon niet worden gecontroleerd". The screen printed
  // "Verzenden mislukt — probeer opnieuw" over all of it, which on a 403 is an instruction to keep
  // repeating something that can never work.
  const src = code("src/app/dashboard/messages/[id]/page.tsx");
  const sendFn = src.slice(src.indexOf("async function handleSend"), src.indexOf("function handleKeyDown"));
  // [SERVER-ZIN] The rule is unchanged; the shape is. `setError(data.error || 'Verzenden mislukt')`
  // preferred the server's sentence AND would have printed a machine code the day this route grew
  // one. failureText keeps the first half and closes the second: a sentence passes through
  // untouched, a snake_case code is replaced by the screen's own line.
  assert.match(
    sendFn,
    /setError\(failureText\(res\.status, data,/,
    "the failure branch must prefer the server's own sentence over the generic retry line",
  );
  assert.doesNotMatch(
    sendFn, /setError\(\s*data\??\.?error\s*\|\|/,
    "…and must not put whatever the route sent on screen unchecked",
  );
});

// ── [NO-SILENT-EMPTY] ────────────────────────────────────────────────────────
test("[NO-SILENT-EMPTY] a failed read is never rendered as an empty inbox", () => {
  // "Nog geen berichten" and "Geen meldingen" are claims about what is waiting for someone. A read
  // that failed knows nothing about that — least of all on the surface where an accountant's
  // question arrives.
  const listRoute = code("src/app/api/messages/conversations/route.ts");
  assert.match(listRoute, /if \(error\)/, "the conversation list must read its error");
  assert.match(listRoute, /status: 503/, "and refuse, rather than answer an empty list");

  const listScreen = code("src/app/dashboard/messages/page.tsx");
  assert.match(listScreen, /loadError/, "the list screen must hold a failure state");
  // [TAAL] Anchored on the KEY, not the Dutch sentence — a gate written against one language
  // fails the day the app gains a second, and this one did.
  const emptyAt = listScreen.indexOf("t('ber.leeg')");
  const errorAt = listScreen.indexOf("loadError ?");
  assert.ok(emptyAt > 0 && errorAt > 0 && errorAt < emptyAt,
    "and it must be checked BEFORE the empty state, or the empty state still wins");

  const chatScreen = code("src/app/dashboard/messages/[id]/page.tsx");
  assert.match(chatScreen, /loadError/, "the chat screen must hold one too");
});

test("[NO-SILENT-EMPTY] both homes prove the bell was cleared before showing it cleared", () => {
  // The ZZP home had already learned this one: the update result was ignored, the badge went to
  // zero, and the same notifications were back unread on the next visit with nothing explaining it.
  // The accountant home — the one that gets the daily "X klanten te bevestigen" — still did it.
  for (const home of [
    "src/app/dashboard/zzp/ZzpDashboard.tsx",
    "src/modules/accountant/pages/AccountantHome.tsx",
  ]) {
    const src = code(home);
    const at = src.indexOf("async function markAllRead");
    assert.ok(at > 0, `${home} has a markAllRead`);
    const fn = src.slice(at, src.indexOf("setNotifications(prev => prev.map", at));
    assert.match(
      fn,
      /const\s*\{\s*error\s*\}\s*=\s*await/,
      `${home}: mark-all-read must read the outcome before the screen claims it`,
    );
    assert.match(fn, /return/, `${home}: and stop when it failed, rather than clearing the badge anyway`);
  }
});

test("[NO-SILENT-EMPTY] the bell can say it could not read, instead of 'Geen meldingen'", () => {
  const shared = code("src/app/dashboard/_shared/index.tsx");
  assert.match(shared, /loadError/, "the bell takes a failure state");
  // [TAAL] Op de sleutel gepind — zevende poort die alleen door de vertaling rood werd.
  const errorAt = shared.indexOf("loadError ?");
  const emptyAt = shared.indexOf("t('kop.geenMeldingen')");
  assert.ok(errorAt > 0 && emptyAt > 0 && errorAt < emptyAt,
    "and checks it before falling back to the empty sentence");

  // Both homes must actually pass it — a prop nobody sets is a fix nobody gets.
  for (const home of [
    "src/app/dashboard/zzp/ZzpDashboard.tsx",
    "src/app/dashboard/accountant/page.tsx",
  ]) {
    assert.match(code(home), /notificationsError=/, `${home} must pass the failure through`);
  }
});

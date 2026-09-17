// src/app/api/bank/enablebanking/callback/route.ts
// [ENABLEBANKING] The owner comes back from his bank.
//
// GET /api/bank/enablebanking/callback?code=<auth code>&state=<our nonce>[&error=...]
//   → 303 to /dashboard/bank with a Dutch result in the query string.
//
// ── Why this route trusts almost nothing ───────────────────────────────────────────────────────
//
// This URL is a REDIRECT TARGET. It arrives in the owner's browser, which means anyone can
// construct a request to it with any query string they like. So:
//
//   · `state` is a 256-bit nonce we generated and stored ourselves. It is a LOOKUP KEY, never a
//     claim. There is no user id in this URL, and adding one would be the whole vulnerability:
//     "finish this connection into account X" must not be something a visitor can ask for.
//   · Whether the consent actually succeeded is decided by EXCHANGING the code with Enable
//     Banking, never by believing a `success=true` in the query string. A forged callback with a
//     valid-looking state but no usable code gets nothing.
//   · No session is required. The owner may well finish the bank flow on his phone while the
//     session lives on his laptop, and the row itself carries the owner — it was written by us
//     before he ever left. Requiring a session here would break a normal, honest journey; it would
//     not add safety, because the nonce is what authorises the lookup.
//
// The response is a redirect rather than JSON because a human lands here, not a script.

import { NextRequest, NextResponse } from "next/server";
import { logAuditAction, getClientIP } from "@/lib/audit";
import {
  createEnableBankingClient,
  dutchEnableBankingError,
  EnableBankingError,
  isEnableBankingConfigured,
  canUseEnableBanking,
} from "@/lib/enablebanking-client";
import {
  attachSession,
  findBankConnectionByReference,
  saveConnectionAccounts,
  setConnectionStatus,
} from "@/lib/enablebanking-connection";

export const dynamic = "force-dynamic";

/** Everything the owner is told lands in the query string of /dashboard/bank. */
function back(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL("/dashboard/bank", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // 303: the browser must follow with a GET, whatever it used to get here.
  return NextResponse.redirect(url, 303);
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const params = req.nextUrl.searchParams;
  const reference = params.get("state");

  if (!reference) {
    return back(origin, { bank: "fout", reden: "De koppeling kon niet worden herkend." });
  }

  const connection = await findBankConnectionByReference(reference);
  if (!connection) {
    // An unknown nonce is either a stale link or someone poking at the endpoint. Same neutral
    // answer for both — nothing here confirms whether a reference exists.
    return back(origin, {
      bank: "fout",
      reden: "Deze koppellink is verlopen. Probeer opnieuw te koppelen.",
    });
  }

  // [EB-TESTER] The gate, placed exactly here and nowhere else.
  //
  // The owner of this flow is the `user_id` on the row we stored when the consent was STARTED —
  // found above by the high-entropy `state`, which is this endpoint's whole security boundary.
  // That is deliberate and stays: the callback must keep working when the bank sends the owner
  // back in another browser, on a phone, or after the session cookie has expired, and it must
  // never take ownership from a query parameter.
  //
  // So the question asked here is not "who is browsing" but "is the account this connection
  // already belongs to allowed to use the bank link". A list that shrinks between starting and
  // finishing a consent stops the finish — which is the correct direction: an authorization that
  // was withdrawn mid-flow must not complete.
  if (!canUseEnableBanking(connection.userId)) {
    return back(origin, {
      bank: "fout",
      reden: "De bankkoppeling is voor dit account niet beschikbaar.",
    });
  }

  // The bank appends its own error when the owner cancelled or it refused. There is no code to
  // exchange in that case, so this is the most honest thing we can tell him.
  const upstreamError = params.get("error");
  const code = params.get("code");

  if (!code) {
    const reden = upstreamError
      ? "Je bank heeft de koppeling niet afgerond. Probeer het opnieuw."
      : "De bank gaf geen bevestiging terug. Probeer het opnieuw.";
    await setConnectionStatus({
      connectionId: connection.id,
      status: "error",
      lastError: upstreamError ? `bank: ${upstreamError}`.slice(0, 200) : "geen autorisatiecode",
    });
    return back(origin, { bank: "fout", reden });
  }

  if (!isEnableBankingConfigured()) {
    return back(origin, { bank: "fout", reden: dutchEnableBankingError("NOT_CONFIGURED") });
  }

  let session;
  try {
    const client = createEnableBankingClient();
    session = await client.createSession(code);
  } catch (err) {
    const errCode = err instanceof EnableBankingError ? err.code : null;
    console.warn("[ENABLEBANKING] exchanging the authorisation code failed", {
      connectionId: connection.id,
      code: errCode ?? "UNKNOWN",
    });
    await setConnectionStatus({
      connectionId: connection.id,
      status: "error",
      lastError: errCode ?? "sessie aanmaken mislukt",
    });
    return back(origin, {
      bank: "fout",
      reden: errCode ? dutchEnableBankingError(errCode) : "Koppelen bij je bank is mislukt.",
    });
  }

  // [EB-ACCOUNT-IDENTITY] An account is usable only if it carries a uid — the reference says one
  // is absent exactly when the bank already knows balances and transactions CANNOT be fetched
  // (the account is blocked or closed). That is a different fact from "the owner picked nothing",
  // and the two must not be reported with the same sentence: one is fixed by re-linking, the other
  // by calling the bank.
  const offered = session.accounts ?? [];
  const accounts = offered.filter((a) => typeof a?.uid === "string" && a.uid);
  if (accounts.length === 0) {
    await attachSession({
      connectionId: connection.id,
      sessionId: session.session_id,
      accessValidUntil: session.access?.valid_until ?? null,
    });
    const blocked = offered.length > 0;
    await setConnectionStatus({
      connectionId: connection.id,
      status: "error",
      lastError: blocked ? "rekeningen niet leesbaar" : "geen rekeningen geselecteerd",
    });
    return back(origin, {
      bank: "fout",
      reden: blocked
        ? "Je bank heeft de rekening wel gedeeld, maar geeft er geen toegang toe — dat gebeurt bij een geblokkeerde of opgeheven rekening. Neem contact op met je bank."
        : "Er is geen rekening geselecteerd bij je bank. Probeer opnieuw te koppelen.",
    });
  }

  await attachSession({
    connectionId: connection.id,
    sessionId: session.session_id,
    accessValidUntil: session.access?.valid_until ?? null,
  });

  const stored = await saveConnectionAccounts({
    userId: connection.userId,
    connectionId: connection.id,
    accounts: accounts.map((a) => ({
      // [EB-ACCOUNT-IDENTITY] Who the account IS, across every future session. Required by the
      // reference; the fallback exists so a bank that omits it still gets a working link instead
      // of a dropped account — it degrades to the old per-session behaviour (a reconnect makes a
      // new row) and the prefix keeps the two namespaces from ever colliding.
      identificationHash: a.identification_hash?.trim() || `uid:${a.uid as string}`,
      // The handle we CALL with. Refreshed here on every reconnect, by design.
      accountId: a.uid as string,
      iban: a.account_id?.iban ?? null,
      ownerName: a.name ?? null,
      currency: a.currency ?? null,
      // The session's own view of the account. Not invented: an account the bank has not finished
      // preparing reports its state here, and the sync reads it rather than assuming READY.
      status: session.status ?? null,
    })),
  });

  if (stored === 0) {
    await setConnectionStatus({
      connectionId: connection.id,
      status: "error",
      lastError: "rekeningen opslaan mislukt",
    });
    return back(origin, { bank: "fout", reden: "De rekeningen konden niet worden opgeslagen." });
  }

  await setConnectionStatus({
    connectionId: connection.id,
    status: "linked",
    lastError: null,
    connectedAt: new Date().toISOString(),
  });

  await logAuditAction({
    userId: connection.userId,
    action: "bank.connected",
    entityType: "bank_connection",
    entityId: connection.id,
    newValue: { aspspName: connection.aspspName, accounts: stored },
    ipAddress: getClientIP(req),
  });

  return back(origin, { bank: "gekoppeld", rekeningen: String(stored) });
}

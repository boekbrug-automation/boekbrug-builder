// src/lib/enablebanking-client.ts
// [ENABLEBANKING] Client for the Enable Banking aggregation API.
//
// ── How this differs from the GoCardless client it replaces ───────────────────────────────────
//
// There is NO token endpoint. GoCardless made us POST credentials to /token/new/, hold an access
// token, refresh it, and handle the day it refused to exchange a refresh token it had just issued.
// Enable Banking has none of that: the application signs its OWN JWT with the private key whose
// public half was uploaded at registration, and sends it as a bearer token. Nothing is exchanged,
// so nothing can fail to exchange, and a "token" here is never a secret in flight — it is a
// signature over a timestamp.
//
// That also means the private key IS the credential. It never leaves this module, is never logged,
// and never reaches a client bundle: every export here is server-only and the routes that use them
// are server routes.
//
// ── Source ────────────────────────────────────────────────────────────────────────────────────
//
// Enable Banking's own published samples (github.com/enablebanking/enablebanking-api-samples),
// seven languages that agree with each other. Their docs site is not reachable from this network,
// so the samples are the authority used here; where the samples are silent this file says so
// rather than inventing a parameter.
//
// Note their JavaScript sample encodes the JWT with `Buffer.toString("base64").replace("=", "")`,
// which strips only the FIRST padding character and never converts to base64url. Their Python
// sample uses PyJWT and is correct. This file follows the Python one — a JWT with "+" or "/" in it
// is rejected, intermittently, depending on what the timestamp happens to encode to.

import { createSign, createHash } from "node:crypto";

/** The one API origin. The samples hard-code it in all seven languages. */
export const ENABLEBANKING_API_BASE = "https://api.enablebanking.com";

/** How long a minted JWT claims to be valid. The samples use an hour. */
export const JWT_LIFETIME_SECONDS = 3600;

/** Re-mint this long before expiry so a request never travels with an almost-dead token. */
const JWT_REFRESH_MARGIN_SECONDS = 300;

/**
 * PSD2 caps a consent at 90 days without re-authentication. Enable Banking takes an absolute
 * timestamp rather than a day count, so this is the number we add to "now" when starting one.
 */
export const DEFAULT_CONSENT_DAYS = 90;

/** A single fetch's ceiling on pages. A bank that never stops sending a continuation key would
 *  otherwise loop forever inside a cron with a wall-clock budget. */
export const MAX_TRANSACTION_PAGES = 50;

export type EnableBankingErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_KEY"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "CONSENT_EXPIRED"
  | "SESSION_INVALID"
  | "NOT_FOUND"
  | "VALIDATION"
  | "SERVER"
  | "NETWORK";

export class EnableBankingError extends Error {
  readonly code: EnableBankingErrorCode;
  readonly status: number | null;
  /** The provider's own message, kept for the log. Never shown to an owner as-is. */
  readonly detail: string | null;

  constructor(code: EnableBankingErrorCode, message: string, status: number | null = null, detail: string | null = null) {
    super(message);
    this.name = "EnableBankingError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * What the OWNER reads. Dutch, because he does — and phrased so he knows whether the next move is
 * his or ours. Telling someone to "contact support" when one tap would fix it wastes his day.
 */
export function dutchEnableBankingError(code: EnableBankingErrorCode): string {
  switch (code) {
    case "CONSENT_EXPIRED":
    case "SESSION_INVALID":
      return "De toestemming bij je bank is verlopen. Koppel je rekening opnieuw — dat duurt een minuut.";
    case "RATE_LIMITED":
      return "Je bank staat even geen nieuwe opvragingen toe. We proberen het vanzelf later opnieuw.";
    case "FORBIDDEN":
      return "Je bank staat deze opvraging niet toe. Koppel je rekening opnieuw of neem contact met ons op.";
    case "NOT_FOUND":
      return "Deze rekening bestaat niet meer bij je bank. Koppel opnieuw om verder te gaan.";
    case "NOT_CONFIGURED":
    case "INVALID_KEY":
    case "UNAUTHORIZED":
      return "De bankkoppeling is nog niet klaar voor gebruik. Wij pakken dit op — je hoeft niets te doen.";
    case "VALIDATION":
    case "SERVER":
    case "NETWORK":
    default:
      return "Je bank is even niet bereikbaar. We proberen het vanzelf later opnieuw.";
  }
}

/** Does this failure mean the owner has to re-authorise, rather than us waiting it out? */
export function needsReconnect(code: EnableBankingErrorCode): boolean {
  return code === "CONSENT_EXPIRED" || code === "SESSION_INVALID" || code === "NOT_FOUND";
}

/**
 * After this failure, should the account count as "read today"?
 *
 * A bank being down is not the owner spending his daily allowance. Marking those as read greys out
 * "Ververs" for twenty hours over a hiccup, so only failures that a retry cannot help count.
 */
export function shouldBackOffAfter(code: EnableBankingErrorCode | null): boolean {
  if (code === null) return true;
  return code !== "SERVER" && code !== "NETWORK";
}

export function classifyStatus(status: number): EnableBankingErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 422) return "VALIDATION";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER";
  if (status >= 400) return "VALIDATION";
  return "SERVER";
}

/**
 * Sharpen a status-derived code using the provider's own message.
 *
 * A 401 is either "your JWT is wrong" (ours to fix, and every account is broken) or "this consent
 * is over" (the owner's to fix, and one tap does it). Telling him to wait for support when he could
 * reconnect in a minute is the failure this exists to prevent — the same one the GoCardless client
 * had to be corrected for.
 */
export function refineErrorCode(code: EnableBankingErrorCode, body: string | null): EnableBankingErrorCode {
  if (!body) return code;
  const text = body.toLowerCase();

  if (/expired|no longer valid|consent/.test(text)) {
    if (code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "VALIDATION") return "CONSENT_EXPIRED";
  }
  if (/session/.test(text) && /invalid|not found|revoked|cancelled|canceled/.test(text)) {
    return "SESSION_INVALID";
  }
  if (code === "UNAUTHORIZED" && /signature|jwt|token|key|kid/.test(text)) return "INVALID_KEY";
  return code;
}

// ─── credentials ──────────────────────────────────────────────────────────────────────────────

export interface EnableBankingCredentials {
  applicationId: string;
  /** PEM-encoded RSA private key. */
  privateKey: string;
}

/**
 * Read the credentials from the environment, or null when the integration is simply not set up.
 *
 * Null is a first-class answer, not an error: with no credentials the bank card hides itself, the
 * routes answer 503 and the cron reports `configured:false`, exactly as the GoCardless stack did.
 * Uploading a file keeps working either way, which is what most owners do today.
 *
 * The key arrives through an environment variable, and those flatten newlines. Vercel and most CI
 * systems store a PEM with literal "\n" between the armour lines, so both forms are accepted —
 * a key that looks right but was pasted through a single-line field would otherwise fail with a
 * signature error that reads like a permissions problem.
 */
export function readCredentials(env: NodeJS.ProcessEnv = process.env): EnableBankingCredentials | null {
  const applicationId = env.ENABLEBANKING_APPLICATION_ID?.trim();
  const rawKey = env.ENABLEBANKING_PRIVATE_KEY;
  if (!applicationId || !rawKey) return null;

  const privateKey = normalizePrivateKey(rawKey);
  if (!privateKey) return null;
  return { applicationId, privateKey };
}

/** Turn whatever the environment held into a PEM, or null if it cannot be one. */
export function normalizePrivateKey(raw: string): string | null {
  const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  const trimmed = pem.trim();
  if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(trimmed)) return null;
  if (!/-----END [A-Z ]*PRIVATE KEY-----$/.test(trimmed)) return null;
  return trimmed + "\n";
}

export function isEnableBankingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readCredentials(env) !== null;
}

/**
 * [EB-TESTER] May THIS account use the bank link at all?
 *
 * A separate question from isEnableBankingConfigured(), and they must stay separate. That one
 * answers "are the credentials technically present"; this one answers "is this person allowed to
 * reach the bank with them". Folding the second into the first would mean every caller that asks
 * whether the integration exists also silently asks who is asking — and the two answers drift the
 * moment one caller has no user to hand over (the callback is exactly that caller).
 *
 * WHY IT EXISTS. The panel's only gate was `configured`, so the moment the two credentials land
 * in the environment every logged-in owner sees "Koppel je bank" and can start a consent against
 * whatever application those credentials name. During a Sandbox proof that application is a
 * Sandbox application: the wrong people, pointed at a mock bank, with a real consent screen.
 *
 * FAIL CLOSED. An unset or empty list allows NOBODY. The other direction — empty means everyone —
 * is one forgotten variable away from being the public feature this exists to prevent. When the
 * integration is ready for real users the list is removed deliberately, in a commit, with that
 * decision written down; it must not happen by omission.
 *
 * IDENTITY. Supabase user UUIDs, never e-mail: an address can be changed by its owner and is
 * re-assignable, and this is an authorization list. Comma, whitespace or newline separated, so a
 * value pasted from a dashboard works without reformatting.
 */
export function enableBankingTesters(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const raw = env.ENABLEBANKING_TESTERS ?? "";
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((v) => v.trim().toLowerCase())
      .filter((v) => v.length > 0),
  );
}

export function canUseEnableBanking(
  userId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const id = typeof userId === "string" ? userId.trim().toLowerCase() : "";
  if (!id) return false;
  return enableBankingTesters(env).has(id);
}

// ─── the JWT ──────────────────────────────────────────────────────────────────────────────────

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Mint a bearer JWT. Pure apart from the clock, so a test can pin the exact bytes.
 *
 * The claims are the vendor's: iss and aud are the literal strings below in every one of their
 * samples, and the key id in the header is the application id from the control panel.
 */
export function mintJwt(
  credentials: EnableBankingCredentials,
  nowSeconds: number,
  lifetimeSeconds: number = JWT_LIFETIME_SECONDS,
): string {
  const header = base64url(
    JSON.stringify({ typ: "JWT", alg: "RS256", kid: credentials.applicationId }),
  );
  const payload = base64url(
    JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: nowSeconds,
      exp: nowSeconds + lifetimeSeconds,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  let signature: Buffer;
  try {
    signature = signer.sign(credentials.privateKey);
  } catch (err) {
    // A malformed or mismatched key fails HERE, before any request. Say so plainly: this is ours
    // to fix and no amount of retrying or reconnecting by the owner will change it.
    throw new EnableBankingError(
      "INVALID_KEY",
      "Enable Banking private key could not sign — check ENABLEBANKING_PRIVATE_KEY",
      null,
      err instanceof Error ? err.message : null,
    );
  }
  return `${header}.${payload}.${base64url(signature)}`;
}

/** Cached per credential pair, keyed on a hash so the key itself is never a map key in memory. */
const JWT_CACHE = new Map<string, { token: string; expiresAtSeconds: number }>();

function credentialFingerprint(c: EnableBankingCredentials): string {
  return createHash("sha256").update(`${c.applicationId}\n${c.privateKey}`).digest("hex");
}

export function clearJwtCache(): void {
  JWT_CACHE.clear();
}

function bearerToken(credentials: EnableBankingCredentials, now: Date): string {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const fingerprint = credentialFingerprint(credentials);
  const cached = JWT_CACHE.get(fingerprint);
  if (cached && cached.expiresAtSeconds - JWT_REFRESH_MARGIN_SECONDS > nowSeconds) {
    return cached.token;
  }
  const token = mintJwt(credentials, nowSeconds);
  JWT_CACHE.set(fingerprint, { token, expiresAtSeconds: nowSeconds + JWT_LIFETIME_SECONDS });
  return token;
}

// ─── response shapes ──────────────────────────────────────────────────────────────────────────

export interface EnableBankingApplication {
  name?: string | null;
  redirect_urls?: string[] | null;
  environment?: string | null;
  services?: string[] | null;
}

export interface EnableBankingAspsp {
  name: string;
  country: string;
  logo?: string | null;
  psu_types?: string[] | null;
  /** Present on some banks; the samples never send it, so it is read but never required. */
  maximum_consent_validity?: number | null;
}

/**
 * One account a session unlocked, as AccountResource defines it.
 *
 * The two identifiers are NOT interchangeable, and the reference says so field by field:
 *
 *   uid                 Required FALSE. "Unique account identificator used for fetching account
 *                       balances and transactions. It is valid only until the session to which the
 *                       account belongs is in the AUTHORIZED status. It can be not set in case it
 *                       is know that it is not possible to fetch balances and transactions for the
 *                       account (for example, in case the account is blocked or closed."
 *   identification_hash Required TRUE. "Primary account identification hash. It can be used for
 *                       matching accounts between multiple sessions (even in case the sessions are
 *                       authorized by different PSUs)."
 *
 * So: uid is the handle you CALL with and it dies with the session; identification_hash is who the
 * account IS and it outlives every reconnect. Storing the uid as the account's identity is the bug
 * this comment exists to prevent — see [EB-ACCOUNT-IDENTITY] in bank_connections.sql.
 *
 * `uid` is typed optional because the reference says it is, and an account without one genuinely
 * cannot be read (blocked or closed at the bank). That is a different fact from "the owner picked
 * no account", and the callback must not report it as the latter.
 */
export interface EnableBankingSessionAccount {
  uid?: string | null;
  identification_hash?: string | null;
  /** Every identification the bank offers. The primary one is included in identification_hash. */
  identification_hashes?: string[] | null;
  account_id?: { iban?: string | null; other?: { identification?: string | null } | null } | null;
  /** "Account holder(s) name" — a person or company, never a product label. */
  name?: string | null;
  /** "Account description set by PSU or provided by ASPSP" — the human label, if the bank has one. */
  details?: string | null;
  currency?: string | null;
  product?: string | null;
  /** CACC (current), CARD (card account, has no IBAN), SVGS, … Required by the reference. */
  cash_account_type?: string | null;
  /** PRIV or ORGA. A bookkeeping app has a real interest in telling those apart. */
  usage?: string | null;
}

export interface EnableBankingSession {
  session_id: string;
  status?: string | null;
  accounts?: EnableBankingSessionAccount[] | null;
  aspsp?: { name?: string | null; country?: string | null } | null;
  access?: { valid_until?: string | null } | null;
}

export interface EnableBankingTransactionPage {
  transactions: unknown[];
  continuation_key?: string | null;
}

export interface EnableBankingClientOptions {
  credentials?: EnableBankingCredentials | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

// ─── the client ───────────────────────────────────────────────────────────────────────────────

export interface EnableBankingClient {
  getApplication(): Promise<EnableBankingApplication>;
  listAspsps(country?: string): Promise<EnableBankingAspsp[]>;
  startAuthorization(params: {
    aspspName: string;
    aspspCountry: string;
    redirectUrl: string;
    state: string;
    psuType?: string;
    validUntil?: Date;
  }): Promise<{ url: string }>;
  createSession(authCode: string): Promise<EnableBankingSession>;
  getSession(sessionId: string): Promise<EnableBankingSession>;
  deleteSession(sessionId: string): Promise<void>;
  /** Every booked transaction from `dateFrom`, following continuation keys to the end.
   *
   *  `onPage` is called with the page number after each page lands. [EB-TELLING] The caller cannot
   *  see pagination from the returned array — a truncated import and a complete one both look like
   *  "some transactions" — so the count is handed out from where the pages actually turn. */
  getTransactions(
    accountUid: string,
    params: { dateFrom: string; dateTo?: string; onPage?: (page: number) => void },
  ): Promise<unknown[]>;
}

export function createEnableBankingClient(options: EnableBankingClientOptions = {}): EnableBankingClient {
  const credentials = options.credentials ?? readCredentials();
  if (!credentials) {
    throw new EnableBankingError(
      "NOT_CONFIGURED",
      "Enable Banking is not configured — set ENABLEBANKING_APPLICATION_ID and ENABLEBANKING_PRIVATE_KEY",
    );
  }
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  async function request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const url = `${ENABLEBANKING_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${bearerToken(credentials!, now())}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // The network, not the bank. Deliberately its own code so shouldBackOffAfter does not spend
      // the account's daily read on our own connectivity.
      throw new EnableBankingError(
        "NETWORK",
        `Enable Banking is unreachable (${method} ${path})`,
        null,
        err instanceof Error ? err.message : null,
      );
    }

    const raw = await response.text().catch(() => "");

    if (!response.ok) {
      const code = refineErrorCode(classifyStatus(response.status), raw || null);
      throw new EnableBankingError(
        code,
        `Enable Banking ${method} ${path} failed with ${response.status}`,
        response.status,
        raw ? raw.slice(0, 500) : null,
      );
    }

    if (!raw) return undefined as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new EnableBankingError(
        "SERVER",
        `Enable Banking returned a body that is not JSON (${method} ${path})`,
        response.status,
        raw.slice(0, 200),
      );
    }
  }

  return {
    async getApplication() {
      return request<EnableBankingApplication>("GET", "/application");
    },

    async listAspsps(country?: string) {
      const query = country ? `?country=${encodeURIComponent(country)}` : "";
      const data = await request<{ aspsps?: EnableBankingAspsp[] }>("GET", `/aspsps${query}`);
      return data?.aspsps ?? [];
    },

    async startAuthorization({ aspspName, aspspCountry, redirectUrl, state, psuType, validUntil }) {
      const until = validUntil ?? new Date(now().getTime() + DEFAULT_CONSENT_DAYS * 24 * 60 * 60 * 1000);
      const data = await request<{ url?: string }>("POST", "/auth", {
        access: { valid_until: until.toISOString() },
        aspsp: { name: aspspName, country: aspspCountry },
        state,
        redirect_url: redirectUrl,
        psu_type: psuType ?? "business",
      });
      if (!data?.url) {
        throw new EnableBankingError("SERVER", "Enable Banking did not return an authorisation URL");
      }
      return { url: data.url };
    },

    async createSession(authCode: string) {
      const session = await request<EnableBankingSession>("POST", "/sessions", { code: authCode });
      if (!session?.session_id) {
        throw new EnableBankingError("SERVER", "Enable Banking did not return a session id");
      }
      return session;
    },

    async getSession(sessionId: string) {
      return request<EnableBankingSession>("GET", `/sessions/${encodeURIComponent(sessionId)}`);
    },

    async deleteSession(sessionId: string) {
      await request<void>("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
    },

    async getTransactions(accountUid, { dateFrom, dateTo, onPage }) {
      const collected: unknown[] = [];
      let continuationKey: string | null = null;
      let page = 0;

      do {
        // [ENABLEBANKING-PAGES] The response carries a continuation_key when there is more. Dropping
        // it would import only the first page and look like a complete, quiet success — the worst
        // shape a bug can take here, because the missing money leaves no trace to notice.
        const query = new URLSearchParams({ date_from: dateFrom });
        if (dateTo) query.set("date_to", dateTo);
        if (continuationKey) query.set("continuation_key", continuationKey);

        const data: EnableBankingTransactionPage = await request<EnableBankingTransactionPage>(
          "GET",
          `/accounts/${encodeURIComponent(accountUid)}/transactions?${query.toString()}`,
        );
        if (Array.isArray(data?.transactions)) collected.push(...data.transactions);
        continuationKey = data?.continuation_key ?? null;
        page += 1;
        onPage?.(page);

        if (continuationKey && page >= MAX_TRANSACTION_PAGES) {
          // Stop, but never silently: a truncated import that reports success is how a quarter ends
          // up short with nobody looking for it.
          throw new EnableBankingError(
            "SERVER",
            `Enable Banking kept returning pages past the ${MAX_TRANSACTION_PAGES}-page limit for one account`,
          );
        }
      } while (continuationKey);

      return collected;
    },
  };
}

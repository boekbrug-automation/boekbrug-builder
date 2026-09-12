// src/lib/beheer.ts
// [BEHEER] Who may open the operator page — and the pure shaping of what it shows.
//
// The operator surface is deliberately NOT a role in the database. A role is self-chosen at
// registration in this app (see decidePlan's note on why the boekhouder exemption needs no
// proof), so "role = beheer" would be a checkbox anyone can tick. An environment variable is
// owned by whoever owns the deployment — exactly the person this page is for — and adding an
// operator costs a redeploy, which is the right amount of friction for handing out a view over
// every customer's name.
//
// BEHEER_EMAILS: comma-separated e-mail addresses, compared case-insensitively. Unset (the
// default) means the page exists for nobody — it 404s, indistinguishable from a route that was
// never built, so this ships dark and turns on only when the env var is set.

/** The operator addresses, parsed once. Empty means the feature is off — see the note above. */
export function beheerEmails(): string[] {
  return (process.env.BEHEER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isBeheerder(email: string | null | undefined): boolean {
  if (!email) return false;
  return beheerEmails().includes(email.trim().toLowerCase());
}

/** One row of the operator's user list. A projection — never the whole profile. */
export interface BeheerUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
  createdAt: string | null;
  plan: string;
}

export interface BeheerLink {
  accountantName: string;
  clientName: string;
  since: string | null;
}

export interface BeheerOverview {
  users: BeheerUser[];
  links: BeheerLink[];
  counts: { total: number; accountants: number; owners: number; links: number };
}

/**
 * Shape raw rows into the overview. Pure, so the page's numbers are testable without a database.
 * The plan label mirrors decidePlan's OUTCOME (free/plus/boekhouder), not its inputs — the
 * operator wants to know what the account IS, not which Stripe status produced it.
 */
export function buildBeheerOverview(
  profiles: Array<{
    id: string; company_name: string | null; full_name: string | null; email: string | null;
    role: string | null; created_at: string | null; subscription_status?: string | null;
    current_period_end?: string | null;
  }>,
  links: Array<{ accountant_id: string; zzper_id: string; created_at?: string | null }>,
  // [TOEKENNING] `id` hoort erbij sinds toekenningen bestaan: de aanroeper zoekt de lopende
  // toekenningen van DIT account op voordat hij het plan bepaalt. Zonder de id kan hij dat niet,
  // en staat iedereen in zijn welkomstperiode hier als "gratis" — het tegendeel van wat de
  // gebruiker op zijn eigen scherm leest.
  planOf: (p: { id: string; role: string | null; subscriptionStatus: string | null; currentPeriodEnd: string | null }) => string,
): BeheerOverview {
  const nameOf = (p: { company_name: string | null; full_name: string | null; email: string | null }) =>
    p.company_name || p.full_name || p.email || "(zonder naam)";
  const byId = new Map(profiles.map((p) => [p.id, p]));

  const users: BeheerUser[] = profiles
    .map((p) => ({
      id: p.id,
      name: nameOf(p),
      email: p.email,
      role: p.role === "accountant" ? "boekhouder" : (p.role || "zzp"),
      createdAt: p.created_at ? p.created_at.slice(0, 10) : null,
      plan: planOf({
        id: p.id,
        role: p.role ?? null,
        subscriptionStatus: p.subscription_status ?? null,
        currentPeriodEnd: p.current_period_end ?? null,
      }),
    }))
    // Newest first: the operator's most common question is "who just registered".
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const shapedLinks: BeheerLink[] = links.map((l) => ({
    accountantName: byId.has(l.accountant_id) ? nameOf(byId.get(l.accountant_id)!) : "(onbekend)",
    clientName: byId.has(l.zzper_id) ? nameOf(byId.get(l.zzper_id)!) : "(onbekend)",
    since: l.created_at ? l.created_at.slice(0, 10) : null,
  }));

  const accountants = users.filter((u) => u.role === "boekhouder").length;
  return {
    users,
    links: shapedLinks,
    counts: {
      total: users.length,
      accountants,
      owners: users.length - accountants,
      links: shapedLinks.length,
    },
  };
}

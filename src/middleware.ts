// middleware.ts
// Auth guard + onboarding redirect (BOEK-015)
// Runs on every request before the page renders
// modified by 028 Accou Portal v2
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessScreen, resolveActingFor, isActingForOther, type MemberLink } from "@/lib/acting-for";

// [PUBLIC-SURFACE] The public path list moved to src/lib/public-paths.ts so the smoke test can
// assert against the SAME array this guard enforces. It was unreachable from anywhere else, which
// is how /eerlijk-gebruik ended up in the footer of every public page, in sitemap.xml and in the
// terms as "volledig openbaar" while this guard redirected every logged-out visitor to /login.
import { isPublic } from "@/lib/public-paths";
import { isDemoTenant, demoRefusalFor, demoRefusalMessage } from "@/lib/demo-tenant";

// [2FA] The rule itself is NOT in this file. See the block at the point of use below and the
// header of src/lib/mfa.ts: this file has no tests of its own, and this is the one decision in the
// app that can shut every user out of every page.
import { asAalLevel, mfaGate, MFA_CHALLENGE_PATH, type AalLevel } from "@/lib/mfa";

/**
 * [BESTEMMING] A redirect URL for a request, carrying where the visitor was going.
 *
 * This used to be inlined at the single redirect below; it is a function now because the
 * env-degrade branch above sends people to the same place and must send them there the same way —
 * a second, slightly different copy is how "?redirect=" quietly stops working on one of the paths.
 *
 * [2FA] The destination is a parameter for that same reason, not because two are needed today: the
 * second-step gate below interrupts a navigation exactly like the login guard does, and has to hand
 * the visitor back to the page he was opening in exactly the same shape. Carrying the bestemming is
 * a property of this file, not of the /login URL.
 *
 * pathname + search, so a quarter filter or a search term travels along. The value comes from our
 * own request, so it always starts with a single "/" — and the receiving screen re-checks it with
 * safeRedirect regardless.
 */
function redirectUrlFor(request: NextRequest, destination: string): URL {
  const url = new URL(destination, request.url);
  const vandaan = request.nextUrl.pathname + request.nextUrl.search;
  // "/" is de openbare homepage en geen bestemming om naar terug te keren.
  if (vandaan !== "/") url.searchParams.set("redirect", vandaan);
  return url;
}

/** The login URL for a request, with the bestemming attached. See redirectUrlFor above. */
function loginUrlFor(request: NextRequest): URL {
  return redirectUrlFor(request, "/login");
}

/**
 * [SESSION-REFRESH] Carry the freshly written session cookies onto a response that REPLACES the
 * one they were written on.
 *
 * getUser() above refreshes an expired-but-refreshable token and writes the new pair onto
 * `response` through the setAll() callback. Every branch that returns something else — a redirect,
 * a 403 — throws that response away, and with it the new cookies. The browser then keeps the OLD
 * refresh token, which has just been spent: Supabase issues refresh tokens for single use, so the
 * next attempt is a reuse, and a reuse ends the session. The user is signed out for no reason he
 * can see, at the exact moment we were sending him somewhere.
 *
 * It cost nothing to be right about this, so: no branch in this file returns a bare response any
 * more. Cheap when there is nothing to carry — the loop runs over an empty list.
 */
function withRefreshedCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  // [ENV-DEGRADE] The two keys were read with `!`, which is a promise to TypeScript and nothing at
  // all at runtime: with either one missing, createServerClient throws HERE — in middleware, before
  // any route handler runs. And the matcher deliberately does NOT exclude /api (see [SESSION-REFRESH]
  // at the bottom), so ONE typo in a Vercel environment variable takes down every page and every
  // API route at once, including:
  //   · /privacy and /voorwaarden — which AVG art. 13 requires to stay reachable;
  //   · /api/health — the diagnostic built for exactly this outage, dead in the outage.
  // A missing key is not "the session is invalid", it is "we cannot check any session". So degrade
  // to the honest version of that: no session, public pages and API routes still served, everything
  // else sent to the login it would have been sent to anyway. Loud in the logs, never a 500.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[ENV-DEGRADE] Supabase env vars missing — serving without a session check", {
      hasUrl: !!supabaseUrl,
      hasAnonKey: !!supabaseAnonKey,
      path: request.nextUrl.pathname,
    });
    // /api/* answers for itself (its handlers return their own 401/503 with a body a caller can
    // read); a public page renders. Both keep working while the deployment is repaired.
    if (request.nextUrl.pathname.startsWith("/api") || isPublic(request.nextUrl.pathname)) {
      return response;
    }
    return NextResponse.redirect(loginUrlFor(request));
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // [2FA] Two-step verification: does this session still owe the second step?
  //
  // Read HERE, above the /api branch, and that placement is the whole point of this block. A gate
  // that only covers pages is a lock on the shop door with the delivery entrance open: the attacker
  // this feature exists to stop holds a stolen PASSWORD, so he holds a valid session cookie at
  // aal1, and he does not need a screen —
  //     curl -H 'Cookie: sb-…' -X POST /api/invoice/send
  // issues an invoice in the owner's name and in his doorlopende nummerreeks, which cannot be
  // withdrawn afterwards. That is precisely the harm the enrolment screen promises to prevent, so
  // the API has to be behind the same step as the screens.
  //
  // WHY THIS APPLIES THE RULE AND DOES NOT RESTATE IT. A wrong branch in these few lines fails
  // nothing that runs in CI: it type-checks, it builds, and the smoke test never logs in. What it
  // does instead is send EVERY page of EVERY user to /verificatie — including the settings screen
  // that would switch two-step back off, and the sign-out that would end the session. That is an
  // entrepreneur locked out of seven years of records he is legally obliged to keep, by us, with no
  // door left open. So the decision lives in src/lib/mfa.ts, in a function with no I/O and a test
  // per branch (the exemptions for /verificatie, /login and /uitloggen are precisely what stop this
  // redirect from looping), and this file only fetches the two levels and does what it says. If the
  // rule has to change, change it there — where it is tested — and not here.
  //
  // Only for a signed-in request: a logged-out visitor has no level to read, and this runs on every
  // navigation, crawlers included.
  let owesSecondStep = false;
  if (user) {
    // getAuthenticatorAssuranceLevel() reads the session that is already in hand — verified at
    // node_modules/@supabase/auth-js: it decodes the `aal` claim and counts the verified factors on
    // the session user. No extra network round-trip per navigation.
    //
    // Wrapped anyway, because a throw HERE is not "this session is unverified", it is a 500 on every
    // page at once — the exact outage [ENV-DEGRADE] above exists to prevent, and this call sits even
    // deeper in the request. Whatever goes wrong, both levels stay null; mfaGate() leans null to
    // "allow" and its header explains why open is the right direction once the password has already
    // been checked, and why a stolen password cannot produce that null.
    let currentLevel: AalLevel = null;
    let nextLevel: AalLevel = null;
    try {
      const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      // A returned error is not a thrown one: `data` is simply null, both levels stay unknown and
      // the gate opens. That is the direction we want, but it must be LOUD — "two-step is switched
      // on and nobody is ever asked for a code" is a failure that looks precisely like success from
      // every screen, so the log is the only place it can ever surface.
      if (error) {
        console.error("[2FA] Assurance level unreadable — letting the request through", {
          path: request.nextUrl.pathname,
          error: error.message,
        });
      }
      currentLevel = asAalLevel(aal?.currentLevel);
      nextLevel = asAalLevel(aal?.nextLevel);
    } catch (thrown) {
      console.error("[2FA] Assurance level threw — letting the request through", {
        path: request.nextUrl.pathname,
        error: thrown instanceof Error ? thrown.message : String(thrown),
      });
    }

    owesSecondStep =
      mfaGate({ currentLevel, nextLevel, pathname: request.nextUrl.pathname }).action === "challenge";
  }

  // [SESSION-REFRESH] API routes: getUser() above already refreshed the token
  // (and wrote new cookies onto `response`) if it was expired-but-refreshable.
  // We must NOT redirect API requests — a fetch() caller expects JSON, not an
  // HTML login page. So for /api/*, return here: the session is refreshed, and
  // if it was truly dead the route itself returns a proper 401 JSON. This is
  // what fixes the intermittent 42501 on API writes (e.g. accountant invite),
  // which previously never ran middleware at all (api was in the matcher exclude).
  if (request.nextUrl.pathname.startsWith("/api")) {
    // [2FA] The same answer as a page gets, in the shape a fetch() caller can read. Never a
    // redirect: a caller expecting JSON follows a 302 to an HTML login page and reports "unexpected
    // token <" — which is how a security refusal turns into a bug nobody can diagnose.
    //
    // 403 and not 401: the session is valid, it is the second step that is missing. The code is
    // what a client checks to know it should send the user to /verificatie rather than to /login.
    if (owesSecondStep) {
      return withRefreshedCookies(
        response,
        NextResponse.json(
          { error: "mfa_required", redirect: MFA_CHALLENGE_PATH },
          { status: 403 },
        ),
      );
    }

    // [DEMO-DICHT] The demo account's password is published on purpose (Play Console reviewers,
    // store screenshots) and is in a PUBLIC git history for good. So it is fenced by capability
    // rather than by secrecy: it may type and edit all it likes, but nothing leaves the building
    // and nothing is paid for. See demo-tenant.ts for where that line is and why.
    //
    // It sits HERE, and not in each route, for the reason the icon subset and PUBLIC_PATHS both
    // demonstrated today: a rule that has to be remembered at twenty call sites is a rule that is
    // eventually forgotten at one, silently. Middleware runs on every /api/* request; a route
    // added next month is covered before it is written.
    if (user && isDemoTenant(user.id)) {
      const refusal = demoRefusalFor(request.nextUrl.pathname, request.method);
      if (refusal) {
        return withRefreshedCookies(
          response,
          NextResponse.json(
            { error: "demo_account", reason: refusal, message: demoRefusalMessage(refusal) },
            { status: 403 },
          ),
        );
      }
    }
    return response;
  }

  // Not logged in → send to login (except public paths).
  //
  // [BESTEMMING] Mét waar hij heen wilde: deze regel stuurde naar een kaal /login, dus na het
  // inloggen kwam iedereen op /dashboard uit — ook wie halverwege zijn werk zat. Hoe dat wordt
  // meegegeven staat bij loginUrlFor hierboven, zodat er één versie van die regel bestaat.
  if (!user && !isPublic(request.nextUrl.pathname)) {
    return withRefreshedCookies(response, NextResponse.redirect(loginUrlFor(request)));
  }

  // [2FA] The page shape of the answer read above: hand him the challenge, then hand him back the
  // page he was opening.
  if (owesSecondStep) {
    // [BESTEMMING] The same "?redirect=" as the login guard, from the same helper: after the six
    // digits he lands back where he was, not on a generic dashboard.
    return withRefreshedCookies(
      response,
      NextResponse.redirect(redirectUrlFor(request, MFA_CHALLENGE_PATH)),
    );
  }

  // Logged in, on dashboard → check onboarding
  if (
    user &&
    request.nextUrl.pathname.startsWith("/dashboard") &&
    !request.nextUrl.pathname.startsWith("/onboarding")
  ) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_done")
      .eq("id", user.id)
      .single();

    if (profile && !profile.onboarding_done) {
      return withRefreshedCookies(response, NextResponse.redirect(new URL("/onboarding", request.url)));
    }

    // [ACTING-FOR] Een verkoopmedewerker hoort op zijn eigen scherm, niet in de bank of de aangifte
    // van zijn baas.
    //
    // WAT DEZE CONTROLE WEL EN NIET IS. De Next-documentatie is er expliciet over: een controle
    // hier is OPTIMISTISCH. Hij voorkomt dat iemand op een leeg scherm belandt; hij is niet de
    // grens. De grens ligt waar de gegevens worden gelezen — RLS geeft een medewerker op die
    // pagina's simpelweg niets, en de twee pagina's die service_role gebruiken (brug, vragen)
    // filteren op de sessiegebruiker. Zou deze redirect morgen verdwijnen, dan ziet een
    // medewerker lege schermen, geen cijfers van zijn baas.
    //
    // Vandaar ook één query en niet meer: dit draait op elke navigatie.
    // [EEN-POORT] Dezelfde vraag, hetzelfde antwoord. Hier stond een eigen versie van "namens wie
    // handelt deze mens": één kolom, en daarna een HARD GECODEERDE `role: "verkoop"`. Dat sloeg
    // drie van de vijf regels van resolveActingFor over — de zelfkoppeling, een revoked_at in de
    // toekomst, en vooral de rol zelf. Een rij met een andere rol kreeg zo het schermenlijstje van
    // verkoop, en ACCOUNTANT_SCREENS was daardoor onbereikbare code.
    //
    // Nu leest hij de hele rij en laat hij de pure regel beslissen. De middleware blijft doen wat
    // middleware hoort te doen — authenticatie en een optimistische omleiding — en beslist zelf
    // niets meer over wie iemand is.
    const { data: koppeling } = await supabase
      .from("company_members")
      .select("owner_id, member_id, role, revoked_at")
      .eq("member_id", user.id)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();

    const handelt = resolveActingFor(user.id, koppeling as MemberLink | null, Date.now());
    if (isActingForOther(handelt) && !canAccessScreen(handelt, request.nextUrl.pathname)) {
      return withRefreshedCookies(response, NextResponse.redirect(new URL("/dashboard/verkoop", request.url)));
    }
  }

  return response;
}

export const config = {
  // [SESSION-REFRESH] `api` removed from the exclude list so middleware runs on
  // /api/* and refreshes the Supabase session before the route handler executes.
  // (Previously `|api` here meant API routes never refreshed the token → an
  // expired JWT reached Postgres → auth.uid() null → RLS 42501 on writes.)
  // API requests are handled early above (session refreshed, never redirected).
  // [SEO] sitemap.xml, robots.txt and the generated social images
  // (opengraph-image / twitter-image) must be fetchable without a session, so
  // exclude them from the matcher entirely — otherwise the auth guard below
  // redirects an unauthenticated crawler to /login and search engines / social
  // scrapers never see them.
  // [ANDROID/TWA] Same reasoning for the PWA/TWA install assets: the launcher
  // icons under /icons/ and the Digital Asset Links file at
  // /.well-known/assetlinks.json are fetched by Android / PWABuilder / Google's
  // link verifier with no session — if the auth guard redirects them to /login
  // the app icon is missing and the URL-bar-hiding verification silently fails.
  // [PWA] sw.js must be reachable at the origin root (its scope) and offline.html
  // is the fallback the worker serves with no session — both must skip the auth
  // guard, or SW registration / the offline page break.
  // [PDF-TOOLS] /pdfjs/ is pdf.js's runtime: the worker, the character maps and
  // the standard fonts (scripts/copy-pdfjs.mjs). They are fetched by the WORKER
  // rather than by the page, so the guard redirected them to /login and the
  // browser refused what came back — "Expected a JavaScript-or-Wasm module
  // script but the server responded with a MIME type of text/html". Every PDF
  // then failed as unreadable, on a page that is public, with nothing in the
  // server log to say why. They are static files like the icons above, so they
  // belong here rather than in PUBLIC_PATHS — a middleware invocation per cmap
  // is also a bill nobody wants.
  // [LLMS-TXT] /llms.txt is the third crawler-facing text file, beside robots.txt and sitemap.xml,
  // and it was missing from this list for its whole first day. The route built, the gates were
  // green, and the file answered 200 — with the LOGIN PAGE in it, because the guard redirected an
  // unauthenticated fetch and Next served /login under the requested URL. A file whose only reader
  // is a crawler is exactly the file where that is invisible: nothing on any screen changes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|llms\\.txt|manifest.webmanifest|icons/|pdfjs/|\\.well-known/|sw.js|offline.html|opengraph-image|twitter-image).*)"],
};
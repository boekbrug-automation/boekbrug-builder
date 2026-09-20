// src/app/onboarding/page.tsx
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getSessionUser } from "@/lib/session-user";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
// [PROFILE-READ] A failed read is not a missing row — see the header of src/lib/profile-read.ts.
import { classifyProfileRead } from "@/lib/profile-read";

export default async function OnboardingPage() {
  const supabase = await createServerSupabaseClient();

  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // [HERVATTEN] Mét de bedrijfsgegevens die er al staan. Ze werden hier niet gelezen en dus ook
  // niet meegegeven, terwijl de wizard zijn formulier leeg begon — zie de toelichting bij
  // initialCompany in OnboardingWizard.
  const readProfile = async () =>
    classifyProfileRead(
      await supabase
        .from("profiles")
        .select("full_name, onboarding_done, onboarding_step, role, email, company_name, kvk_number, btw_number, iban, address")
        .eq("id", user.id)
        .maybeSingle(),
    );

  // [PROFILE-READ] Three answers, and only one of them may create a row. This used to insert a
  // fresh step-1 profile whenever `data` was null — which is also what a refused or timed-out read
  // looks like. A completed owner then met the wizard from the start, over a profile that exists.
  // A failed read stops here, loudly: a wizard that does not know whom it is for must not guess.
  const firstRead = await readProfile();
  if (firstRead.kind === "failed") {
    console.error("[PROFILE-READ] profile unreadable on the wizard — refusing to guess", {
      userId: user.id,
      code: firstRead.code,
      error: firstRead.message,
    });
    throw new Error("[PROFILE-READ] profile unreadable");
  }
  let profile = firstRead.kind === "row" ? firstRead.row : null;

  // [KLUIS] Een archiefaccount heeft hier niets te zoeken: deze wizard vraagt om
  // bedrijfsgegevens, een mailboxkoppeling en een eerste factuur, en wie zijn gestopte zaak
  // komt archiveren heeft geen van drieën. De trigger zet onboarding_done al op true bij
  // registratie, dus normaal komt hij hier nooit — maar wie via een oude link of een
  // bookmark toch binnenvalt hoort in zijn kluis te landen en niet in een vragenlijst.
  //
  // Apart gelezen zodat de select hierboven blijft werken als de kolom nog niet bestaat.
  // ⚠️ En de redirect staat BUITEN de try: `redirect()` werkt door een NEXT_REDIRECT-fout te
  // gooien, dus binnen de try zou de catch hem opvangen en stilzwijgend negeren — de
  // gebruiker zag dan alsnog de wizard en niets verried waarom.
  let isArchief = false;
  try {
    const { data: doel } = await supabase
      .from("profiles")
      .select("account_purpose")
      .eq("id", user.id)
      .single();
    isArchief = doel?.account_purpose === "archief";
  } catch {
    /* kolom bestaat nog niet → gewoon de wizard, zoals altijd */
  }
  if (isArchief) redirect("/dashboard/kluis");

  if (!profile) {
    // Genuinely no row — the read succeeded and found none — so the trigger did not fire for this
    // account. The one case in which creating a profile here is right.
    const { error: insertError } = await supabase.from("profiles").insert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name ?? null,
      onboarding_step: 1,
      onboarding_done: false,
      role: "zzper",
    });
    if (insertError) {
      // Not fatal on its own: the re-read below is the truth, and a conflict means the row
      // arrived in the meantime. Logged, because a silent insert failure is how a wizard renders
      // for nobody.
      console.error("[PROFILE-READ] creating the missing profile failed", {
        userId: user.id,
        code: insertError.code,
        error: insertError.message,
      });
    }

    const secondRead = await readProfile();
    if (secondRead.kind === "failed") {
      console.error("[PROFILE-READ] profile unreadable after creating it — refusing to guess", {
        userId: user.id,
        code: secondRead.code,
        error: secondRead.message,
      });
      throw new Error("[PROFILE-READ] profile unreadable");
    }
    profile = secondRead.kind === "row" ? secondRead.row : null;
  }

  if (profile?.onboarding_done) redirect("/dashboard");

  const userName =
    profile?.full_name ??
    user.user_metadata?.full_name ??
    user.email ??
    "daar";

  // [VAK-BRUG] The trade, so someone resuming the wizard a day later sees the answer he already
  // gave rather than an empty dropdown. Read APART from the select above, exactly like
  // account_purpose two blocks up and for the same reason: profile_vak.sql is applied by hand, and
  // a missing column must cost the trade question, never the whole wizard.
  let initialVak = "";
  try {
    const { data: vakRow } = await supabase
      .from("profiles").select("vak").eq("id", user.id).maybeSingle();
    initialVak = (vakRow as { vak?: string | null } | null)?.vak ?? "";
  } catch {
    /* kolom bestaat nog niet → gewoon een lege keuze, zoals altijd */
  }

  const initialStep = Math.max(1, profile?.onboarding_step ?? 1);
  const initialRole = profile?.role === "accountant" ? "accountant" : "zzp";

  // [BOEK-015] P2 fix: role was explicitly chosen if profile.role is a real role
  // (not the auto-inserted default). We treat a saved 'accountant' OR a step > 1
  // as evidence the user already passed the role choice.
  const roleWasSet = profile?.role === "accountant" || (profile?.onboarding_step ?? 0) >= 2;

  // [UITNODIGING] Is deze verse gebruiker al aan een kantoor gekoppeld? Dat gebeurt wanneer hij
  // via de uitnodigingsmail van zijn boekhouder binnenkwam en accepteerde vóór de wizard. Stap 5
  // vroeg hem daarna doodleuk "Heb je een boekhouder?" en bood aan er een uit te nodigen — een
  // tweede, omgekeerde uitnodiging naar het kantoor waar hij al aan vastzit. Best-effort: als
  // deze lezing hapert, doet de wizard wat hij altijd deed.
  let linkedAccountantName: string | null = null;
  try {
    const { data: link } = await supabase
      .from("accountant_clients")
      .select("accountant_id")
      .eq("zzper_id", user.id)
      .limit(1)
      .maybeSingle();
    if (link?.accountant_id) {
      const { data: kantoor } = await supabase
        .from("profiles")
        .select("company_name, full_name")
        .eq("id", link.accountant_id)
        .maybeSingle();
      linkedAccountantName = kantoor?.company_name || kantoor?.full_name || "je boekhouder";
    }
  } catch {
    /* wizard gedraagt zich als vanouds */
  }

  return (
    <OnboardingWizard
      linkedAccountantName={linkedAccountantName}
      userName={userName}
      initialStep={initialStep}
      initialRole={initialRole}
      roleWasSet={roleWasSet}
      initialCompany={{
        company_name: profile?.company_name ?? "",
        kvk_number: profile?.kvk_number ?? "",
        btw_number: profile?.btw_number ?? "",
        iban: profile?.iban ?? "",
        address: profile?.address ?? "",
        // [VAK-BRUG] Read apart from the select above and tolerantly — see the block that reads it.
        vak: initialVak,
      }}
    />
  );
}
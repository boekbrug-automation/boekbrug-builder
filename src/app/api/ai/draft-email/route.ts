// src/app/api/ai/draft-email/route.ts
// [AI-SERVERKANT] POST /api/ai/draft-email — de AI-assistent van het boekhoudersscherm.
// Body: { prompt: string }
// Antwoord: { subject: string, body: string }
//
// ── WAAROM DEZE ROUTE BESTAAT ──
// Hij bestond niet, en dat was precies het probleem. AccountantHome riep composeDraftEmail
// RECHTSTREEKS aan uit een 'use client'-component. Die functie loopt via callClaude, en die doet
// fetch('https://api.anthropic.com/v1/messages') met process.env.ANTHROPIC_API_KEY.
//
// In een browser bestaat die variabele niet: Next vervangt alleen NEXT_PUBLIC_*-variabelen in de
// clientbundel, dus de sleutel werd `undefined ?? ''` — een lege sleutel. En zelfs mét sleutel
// zou het verzoek stranden, want api.anthropic.com staat geen browser-origin toe. De assistent
// kón dus nooit werken: de boekhouder typte zijn vraag, klikte, en las "AI niet beschikbaar —
// Probeer het opnieuw." Dat advies klopte niet; opnieuw proberen loste hier niets op.
//
// Nagemeten in de gebouwde bundel: api.anthropic.com en de systeemprompts stonden gewoon in
// .next/static/chunks — de hele serverlaag werd meegestuurd naar elke bezoeker. Er lekte geen
// sleutel (Next laat niet-publieke variabelen als runtime-lookup staan, en er stond geen enkele
// sk-ant-waarde in), maar werken kon het niet.
//
// Vandaar dit eindpunt: dezelfde functie, maar op de server, waar de sleutel wél bestaat — en
// mét dezelfde poorten als elke andere betaalde Claude-route (ratelimiet + eerlijk gebruik).
// Daarna kan ai.ts zijn `server-only`-markering krijgen, zodat deze fout niet nog eens gemaakt
// kan worden: dan is zo'n import een bouwfout in plaats van een scherm dat stil niets doet.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { composeDraftEmail } from '@/lib/ai';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  let body: { prompt?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ongeldige aanvraag' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 });

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return NextResponse.json({ error: 'Schrijf eerst waar de mail over gaat' }, { status: 400 });
  // Een prompt is één vraag, geen document. De bovengrens houdt een geplakte mailwisseling
  // buiten de tokenrekening.
  if (prompt.length > 2000) {
    return NextResponse.json({ error: 'Dit is te lang — vat het samen in een paar zinnen' }, { status: 400 });
  }

  // [COST] Zelfde plafond als de andere korte tekstroute: dit is één Claude-call van dezelfde orde.
  const rl = await checkRateLimit({ userId: user.id, endpoint: '/api/ai/draft-email', ...RATE_LIMITS.AI_TRANSLATE });
  if (!rl.allowed) return rateLimitResponse(rl);

  // Geen fair-use-teller: die meters gaan over DOCUMENTEN (aiDocuments), verstuurde facturen en
  // opslag. Dit is een korte tekstaanroep, net als /api/ai/translate — dat is de route van
  // dezelfde soort, en die leunt ook op de ratelimiet alleen. Het euro-plafond per dag geldt
  // hoe dan ook: reserveAiBudget zit in callClaude zelf.

  // De naam waarmee de mail ondertekend wordt komt van de SERVER, niet uit de aanvraag: anders
  // bepaalt de afzender zelf onder wiens naam er iets wordt opgesteld.
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, company_name')
    .eq('id', user.id)
    .single();

  try {
    const result = await composeDraftEmail(
      user.id,
      profile?.full_name || profile?.company_name || 'Boekhouder',
      prompt,
      [prompt],
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('[AI-SERVERKANT] /api/ai/draft-email error:', error);
    return NextResponse.json({ error: 'De AI is even niet bereikbaar' }, { status: 502 });
  }
}

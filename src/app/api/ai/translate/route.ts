// src/app/api/ai/translate/route.ts
// [BOEK-018] translate factuurregels to Dutch route — May 2026
// POST /api/ai/translate
// Body: { text: string, sourceLanguage: string }
// Returns: { translation: string, original: string }
// Note: output always Dutch, always professional

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { translateToNL } from '@/lib/ai';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  // [BOEK-018] fix: parse body once before try/catch — req.json() can only be called once — May 2026
  let body: { text?: unknown; sourceLanguage?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    // Auth check
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // [COST] Per-user ceiling on AI translation (Claude calls).
    const rl = await checkRateLimit({ userId: user.id, endpoint: '/api/ai/translate', ...RATE_LIMITS.AI_TRANSLATE });
    if (!rl.allowed) return rateLimitResponse(rl);

    const { text, sourceLanguage } = body;

    // Input validation
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    if (!sourceLanguage || typeof sourceLanguage !== 'string') {
      return NextResponse.json({ error: 'sourceLanguage is required' }, { status: 400 });
    }

    const result = await translateToNL(user.id, text, sourceLanguage);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[BOEK-018] /api/ai/translate error:', error);
    // Safe fallback — return original text (body.text already parsed above)
    const originalText = typeof body.text === 'string' ? body.text : '';
    return NextResponse.json(
      { translation: originalText, original: originalText },
      { status: 200 }
    );
  }
}
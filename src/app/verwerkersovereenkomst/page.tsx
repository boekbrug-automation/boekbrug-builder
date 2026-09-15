// src/app/verwerkersovereenkomst/page.tsx
// [DPA-BEREIKBAAR] The processing agreement an accountant needs before they may hand us a single
// client file. Public, like the other three legal pages — a document you have to ask for is a
// document that answers the question too late.

import type { Metadata } from 'next'
import LegalArticle from '@/components/legal-article'
import markdown from '@/content/legal/verwerkersovereenkomst'

export const metadata: Metadata = {
  title: 'Verwerkersovereenkomst | BoekBrug',
  description:
    'De verwerkersovereenkomst (AVG art. 28) tussen jouw kantoor en BoekBrug: wat wij met de gegevens van jouw klanten doen, wie ze verwerkt en wat je van ons mag eisen.',
  alternates: { canonical: '/verwerkersovereenkomst' },
}

export default function VerwerkersovereenkomstPage() {
  return <LegalArticle markdown={markdown} />
}

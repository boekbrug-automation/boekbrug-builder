// src/app/api/documents/duplicate-questions/route.ts
// [ONTVANGEN-BESLUIT] The open questions, for the owner who is looking at them.
//
// Session client, deliberately: this reads the caller's own documents, so the filter and RLS say
// the same thing and neither is the only boundary. Nothing here writes.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { DOC_TYPE_WACHT_OP_BESLUIT } from "@/lib/skipped-import";
import { fetchAllRowsForIds } from "@/lib/supabase-paginate";
import {
  candidateIdsOf, lookUpCandidates, buildQuestions,
  type QuestionRow, type CandidateRow,
} from "@/lib/duplicate-questions-read";

export const dynamic = "force-dynamic";

/** Enough to answer them in one sitting; more than this is a backlog, not a question list. */
const MAX_QUESTIONS = 25;

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ontvangen_intake_intent.sql is applied BY HAND, so duplicate_candidate_invoice_id is not in
  // the generated types — same relaxed handle, and the same reason, as everywhere else it is read.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs = supabase.from("documents") as any;
  const { data, error } = await docs
    .select("id, file_name, duplicate_candidate_invoice_id")
    .eq("user_id", user.id)
    .eq("ai_doc_type", DOC_TYPE_WACHT_OP_BESLUIT)
    .order("created_at", { ascending: true })
    .limit(MAX_QUESTIONS);
  if (error) {
    // 42703 — the column is not there — is the one error that is not a failure to read. A database
    // without duplicate_candidate_invoice_id cannot hold a document in wacht_op_besluit, so "no
    // open questions" is literally true rather than a guess, and the screen stays calm on a
    // deployment where receive-first has not been switched on yet.
    if ((error as { code?: string }).code === "42703") {
      return NextResponse.json({ questions: [], open: 0 });
    }
    // [NO-SILENT-EMPTY] Everything else IS a failed read, and an empty list would hide the one
    // thing this panel exists to show — the owner would never know to look again.
    console.error("[ONTVANGEN-BESLUIT] could not read the open questions", { error: error.message });
    return NextResponse.json(
      { error: "We konden je openstaande vragen nu niet ophalen." },
      { status: 503 },
    );
  }

  const rows = (data ?? []) as QuestionRow[];
  const candidateIds = candidateIdsOf(rows);

  // The candidate's own number and supplier, read in one go and scoped to this owner — the FK
  // proves the invoice exists, never whose it is.
  //
  // [VRAAG-BLIJFT] The lookup may fail without taking the questions with it; that decision lives in
  // duplicate-questions-read.ts, where it can be run rather than read.
  //
  // [IN-CHUNK] Chunked, even though MAX_QUESTIONS bounds this at 25 today: an unchunked .in() on a
  // growing table dies past a few hundred ids with a 414 that supabase-js reports as an ordinary
  // error, so a caller that only destructures `data` reads a failed call as "no rows".
  const found = await lookUpCandidates(
    candidateIds,
    (ids) => fetchAllRowsForIds<CandidateRow, string>(ids, (chunk, from, to) =>
      supabase
        .from("invoices")
        .select("id, invoice_number, client_name")
        .eq("receiver_id", user.id)
        .in("id", chunk)
        .range(from, to)),
    (message) => {
      // Named, because this is invisible from the screen: such a question looks exactly like one
      // whose reader never found a candidate at all.
      console.error("[ONTVANGEN-BESLUIT] could not load the candidate invoices — showing the questions without them", {
        count: candidateIds.length, error: message,
      });
    },
  );

  const questions = buildQuestions(rows, found);

  // `candidatesUnavailable` lets the screen say WHY a question has no invoice beside it, instead of
  // implying the reader never found one. It never suppresses a question.
  return NextResponse.json({ questions, open: questions.length, candidatesUnavailable: found.unavailable });
}

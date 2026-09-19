"use client";
// src/components/intake/DuplicateQuestions.tsx
// [ONTVANGEN-BESLUIT] "1 vraag voor jou" — the one thing a reader cannot decide.
//
// ── WHY IT IS NOT IN "OVERGESLAGEN BIJ IMPORT" ───────────────────────────────────────────────
//
// That panel is for files we could NOT read, and it offers a button to read them again. Here the
// read succeeded: it found an invoice that is already booked from a different file. Reading it
// again buys the same answer, for the same money. What is missing is not a read but a judgement,
// and only the owner can make it.
//
// ── AND WHY IT SURVIVES CLOSING THE APP ──────────────────────────────────────────────────────
//
// The question lives on the document (wacht_op_besluit), not in a modal. That is the whole point
// of making it durable: the owner photographed a bon in a van, was told "Ontvangen", and closed
// the app. The question has to be here tomorrow morning, and it is.
//
// The component holds no language of its own — see duplicate-question.ts.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/use-locale";
import { translator } from "@/lib/i18n/t";
import {
  questionCopy, questionsHeading, questionsUnknownText, candidatesUnavailableText,
  type QuestionsState, type DuplicateQuestion,
} from "@/lib/duplicate-question";
import { nextRecheckDelayMs } from "@/lib/duplicate-recheck";

export default function DuplicateQuestions({ awaitDocumentIds }: {
  /**
   * [ONTVANGEN-WAAR] documentIds of receive-first handoffs that just happened on this screen.
   *
   * Supplying them arms a BOUNDED re-check (see duplicate-recheck.ts): the reader runs after the
   * owner has been told "Ontvangen", so a question about one of these documents can come into
   * existence while this panel is already on screen and has already been handed an empty list.
   *
   * Absent or empty — which is every screen except an upload screen mid-batch — the panel behaves
   * exactly as it always did: it asks once and then stays quiet.
   */
  awaitDocumentIds?: readonly string[];
} = {}) {
  const t = translator(useLocale());
  const [state, setState] = useState<QuestionsState>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // [VRAAG-BLIJFT] A failed read is `unknown`, never an empty list. The two look the same on a
  // screen that renders nothing, and they mean opposite things: "nothing waits for you" versus
  // "we could not find out". The first is the one that makes an owner stop looking.
  //
  // Returns the documentIds it now knows a question for, so the bounded re-check below can tell
  // "the question I was waiting for has arrived" from "still nothing". A failed read returns [] —
  // it has learned nothing, which keeps the window open rather than closing it on an error.
  const load = useCallback(async (): Promise<string[]> => {
    try {
      const res = await fetch("/api/documents/duplicate-questions");
      if (!res.ok) {
        setState({ kind: "unknown" });
        return [];
      }
      const data = await res.json();
      const questions: DuplicateQuestion[] = Array.isArray(data.questions) ? data.questions : [];
      setState({
        kind: "loaded",
        questions,
        candidatesUnavailable: data.candidatesUnavailable === true,
      });
      return questions.map((q) => q.documentId);
    } catch {
      setState({ kind: "unknown" });
      return [];
    }
  }, []);

  // An IIFE so the effect body stays synchronous (react-hooks/set-state-in-effect): the state is
  // set from the awaited answer, not during the effect itself.
  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  // [ONTVANGEN-WAAR] The bounded window after a fresh handoff.
  //
  // Keyed on the CONTENTS of the list, not its identity: the caller rebuilds this array on every
  // render, and depending on the array itself would re-arm the window several times a second.
  const awaitKey = Array.from(awaitDocumentIds ?? []).sort().join(",");
  useEffect(() => {
    const awaited = awaitKey ? awaitKey.split(",") : [];
    if (awaited.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const arm = (delayMs: number) => {
      timer = setTimeout(() => {
        void (async () => {
          const answered = await load();
          if (cancelled) return;
          attempt += 1;
          const next = nextRecheckDelayMs({ attempt, awaited, answered });
          if (next !== null) arm(next);
        })();
      }, delayMs);
    };

    const first = nextRecheckDelayMs({ attempt: 0, awaited, answered: [] });
    if (first !== null) arm(first);
    // Unmounting stops it, and so does a new batch: the cleanup runs before the next arming.
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [awaitKey, load]);

  // [BRIDGE-REFRESH] The other half of the same problem, with the app's existing answer: a panel
  // the owner left open on a phone is a panel that has been wrong for as long as they were away.
  // Event-driven and free when nothing happens — no timer, so no traffic on an idle screen.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      // Debounced for the reason BrugClient documents: returning to a tab fires both events.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void load(); }, 150);
    };
    window.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function answer(documentId: string, decision: "keep_existing" | "add_anyway") {
    setBusy(documentId);
    setFailed(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/duplicate-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        setFailed(documentId);
        return;
      }
      // Answered. Drop it from the list rather than re-reading: the document has left this state,
      // and the next load will agree.
      setState((prev) =>
        prev.kind === "loaded"
          ? { ...prev, questions: prev.questions.filter((q) => q.documentId !== documentId) }
          : prev,
      );
    } catch {
      setFailed(documentId);
    } finally {
      setBusy(null);
    }
  }

  // Nothing is drawn while the answer is still on its way: a panel that flashes "we could not load
  // your questions" for 300ms on every page view is worse than one that appears when it knows.
  if (state.kind === "loading") return null;

  if (state.kind === "unknown") {
    const text = questionsUnknownText(t);
    return (
      <section
        aria-label={text}
        style={{
          background: "#fff", border: "1px solid #e8eaed", borderRadius: 16,
          padding: 16, marginBottom: 16, fontSize: 13, color: "#5f6368",
        }}
      >
        {text}
      </section>
    );
  }

  const { questions, candidatesUnavailable } = state;
  if (questions.length === 0) return null;

  return (
    <section
      aria-label={questionsHeading(t, questions.length)}
      style={{
        background: "#fff", border: "1px solid #e8eaed", borderRadius: 16,
        padding: 16, marginBottom: 16,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, color: "#202124", marginBottom: 10 }}>
        {questionsHeading(t, questions.length)}
      </div>

      {candidatesUnavailable && (
        <div style={{ fontSize: 13, color: "#5f6368", marginBottom: 4 }}>
          {candidatesUnavailableText(t)}
        </div>
      )}

      {questions.map((q) => {
        const copy = questionCopy(t, q);
        const working = busy === q.documentId;
        return (
          <div
            key={q.documentId}
            style={{
              borderTop: "1px solid #f1f3f4", paddingTop: 12, marginTop: 12,
              display: "flex", flexDirection: "column", gap: 8,
            }}
          >
            <div style={{ fontSize: 14, color: "#202124" }}>{copy.sentence}</div>
            <div style={{ fontSize: 13, color: "#5f6368", wordBreak: "break-word" }}>
              {copy.heading}
              {q.candidate?.invoiceNumber ? ` · ${q.candidate.invoiceNumber}` : ""}
              {q.candidate?.vendor ? ` · ${q.candidate.vendor}` : ""}
            </div>

            {/* [ONTVANGEN-WAAR] What is true about the invoice already in the books. Assembled in
                duplicate-question.ts — this holds no language and no rule of its own, and prints
                nothing at all when nothing is known. */}
            {copy.contextLines.length > 0 && (
              <div style={{ fontSize: 13.5, color: "#202124", lineHeight: 1.5, wordBreak: "break-word" }}>
                {copy.contextLines.map((line, i) => (
                  // The amount comes first and is the one line that carries weight: [RUSTIG] says
                  // a number beats a sentence, and this is the number the owner compares.
                  <div key={line} style={{ fontWeight: i === 0 ? 700 : 400 }}>{line}</div>
                ))}
              </div>
            )}

            {copy.candidateLink && (
              <Link
                href={copy.candidateLink.href}
                style={{ fontSize: 13, color: "#1a73e8", textDecoration: "none" }}
              >
                {copy.candidateLink.label}
              </Link>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
              <button
                type="button"
                disabled={working}
                onClick={() => void answer(q.documentId, "keep_existing")}
                style={{
                  border: "1px solid #dadce0", background: "#fff", color: "#202124",
                  borderRadius: 9999, padding: "8px 14px", fontSize: 14, fontWeight: 600,
                  cursor: working ? "default" : "pointer",
                }}
              >
                {working ? copy.busyLabel : copy.keepLabel}
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => void answer(q.documentId, "add_anyway")}
                style={{
                  border: "none", background: "#1a73e8", color: "#fff",
                  borderRadius: 9999, padding: "8px 14px", fontSize: 14, fontWeight: 600,
                  cursor: working ? "default" : "pointer",
                }}
              >
                {working ? copy.busyLabel : copy.addLabel}
              </button>
            </div>

            {failed === q.documentId && (
              <div style={{ fontSize: 13, color: "#5f6368" }}>{copy.failureText}</div>
            )}
          </div>
        );
      })}
    </section>
  );
}

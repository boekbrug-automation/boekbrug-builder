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
  type QuestionsState,
} from "@/lib/duplicate-question";

export default function DuplicateQuestions() {
  const t = translator(useLocale());
  const [state, setState] = useState<QuestionsState>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // [VRAAG-BLIJFT] A failed read is `unknown`, never an empty list. The two look the same on a
  // screen that renders nothing, and they mean opposite things: "nothing waits for you" versus
  // "we could not find out". The first is the one that makes an owner stop looking.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/documents/duplicate-questions");
      if (!res.ok) {
        setState({ kind: "unknown" });
        return;
      }
      const data = await res.json();
      setState({
        kind: "loaded",
        questions: Array.isArray(data.questions) ? data.questions : [],
        candidatesUnavailable: data.candidatesUnavailable === true,
      });
    } catch {
      setState({ kind: "unknown" });
    }
  }, []);

  // An IIFE so the effect body stays synchronous (react-hooks/set-state-in-effect): the state is
  // set from the awaited answer, not during the effect itself.
  useEffect(() => {
    void (async () => { await load(); })();
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

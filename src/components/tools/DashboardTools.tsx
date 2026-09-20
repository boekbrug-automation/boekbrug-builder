'use client'

// src/components/tools/DashboardTools.tsx
// [DASHBOARD-TOOLS] The file tools, within reach from inside the app.
//
// LINKS, not components. Every one of these pages loads pdf-lib or pdfjs — a
// megabyte between them — and the dashboard is the screen people open every
// day. Rendering the tools here would put that in its first load whether or not
// anybody touches a file, which is the exact shape of the finding in
// bundle-weight-gates.test.ts: a deferral written, commented, and cancelled by
// an ordinary import somewhere along the chain. An <a> costs nothing.
//
// Not every tool is here either. The market has favicon generators and
// Instagram sizes; those belong on /tools, where somebody who wants one goes
// looking. What a bookkeeping screen should offer is the handful that come up
// while handling documents — and the shorter the list, the more it reads as an
// answer rather than as a drawer.

import Link from "next/link";
// [TAAL] A component holds no language of its own: the words live in the catalogue and reach the
// owner in their own language. This block was plain Dutch on both homes, and outside the sweep.
import { useLocale } from "@/lib/i18n/use-locale";
import { translator } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/messages";

interface Tool {
  slug: string;
  emoji: string;
  label: MessageKey;
  /** Why it is on THIS screen — the moment it answers, not what it does. */
  when: MessageKey;
}

/** For the owner: getting documents in, and out again in one piece. */
const FOR_OWNER: Tool[] = [
  { slug: "/pdf-verkleinen", emoji: "📉", label: "tools.pdfVerkleinen", when: "tools.wanneer.teGroot" },
  { slug: "/afbeeldingen-naar-pdf", emoji: "🖼️", label: "tools.fotosNaarPdf", when: "tools.wanneer.bonnetjesEenDocument" },
  { slug: "/pdf-samenvoegen", emoji: "🔗", label: "tools.pdfSamenvoegen", when: "tools.wanneer.lossePaginas" },
  { slug: "/pdf-splitsen", emoji: "✂️", label: "tools.pdfSplitsen", when: "tools.wanneer.eenBonUitStapel" },
  { slug: "/pdf-ondertekenen", emoji: "🖊️", label: "tools.pdfOndertekenen", when: "tools.wanneer.offerteTekenen" },
  { slug: "/afbeelding-verkleinen", emoji: "📷", label: "tools.fotoVerkleinen", when: "tools.wanneer.telefoonfoto" },
];

/** For the accountant: the same work, plus what you do to somebody else's file. */
const FOR_ACCOUNTANT: Tool[] = [
  { slug: "/pdf-samenvoegen", emoji: "🔗", label: "tools.pdfSamenvoegen", when: "tools.wanneer.stukkenBundelen" },
  { slug: "/pdf-splitsen", emoji: "✂️", label: "tools.pdfSplitsen", when: "tools.wanneer.factuurUitBatch" },
  { slug: "/pdf-verkleinen", emoji: "📉", label: "tools.pdfVerkleinen", when: "tools.wanneer.teGrootDoorsturen" },
  { slug: "/pdf-paginas-ordenen", emoji: "🔃", label: "tools.paginasOrdenen", when: "tools.wanneer.scheveScan" },
  { slug: "/pdf-naar-tekst", emoji: "📝", label: "tools.pdfNaarTekst", when: "tools.wanneer.bedragenOvernemen" },
  { slug: "/pdf-eigenschappen", emoji: "🏷️", label: "tools.pdfEigenschappen", when: "tools.wanneer.naamEruit" },
];

export default function DashboardTools({ audience }: { audience: "owner" | "accountant" }) {
  const t = translator(useLocale());
  const tools = audience === "accountant" ? FOR_ACCOUNTANT : FOR_OWNER;

  return (
    <section
      aria-labelledby="dashboard-tools-heading"
      style={{ marginTop: 32, fontFamily: "'Roboto', system-ui, sans-serif" }}
    >
      <h2
        id="dashboard-tools-heading"
        style={{ fontSize: 15, fontWeight: 600, color: "#202124", margin: "0 0 4px" }}
      >
        {t("tools.kop")}
      </h2>
      <p style={{ fontSize: 13, color: "#5f6368", margin: "0 0 14px" }}>
        {t("tools.sub")}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
          gap: 10,
        }}
      >
        {tools.map((tool) => (
          <Link
            key={tool.slug}
            href={tool.slug}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              background: "#fff",
              border: "1px solid #e0e0e0",
              borderRadius: 14,
              padding: "12px 14px",
              textDecoration: "none",
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>
              {tool.emoji}
            </span>
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "#202124",
                }}
              >
                {t(tool.label)}
              </span>
              <span style={{ display: "block", fontSize: 12, color: "#5f6368" }}>{t(tool.when)}</span>
            </span>
          </Link>
        ))}
      </div>

      <Link
        href="/tools"
        style={{
          display: "inline-block",
          marginTop: 12,
          fontSize: 13,
          fontWeight: 600,
          color: "#1a73e8",
          textDecoration: "none",
        }}
      >
        {t("tools.alle")} →
      </Link>
    </section>
  );
}

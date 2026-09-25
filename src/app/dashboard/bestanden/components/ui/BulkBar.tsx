"use client";
// src/app/dashboard/bestanden/components/ui/BulkBar.tsx
// [BOEK-033] Floating bulk action bar — appears when files/folders are selected

import { T } from "../../tokens";
import { Icon } from "./Icon";
// [TAAL] A component holds no language of its own.
import { useLocale } from "@/lib/i18n/use-locale";
import { translator } from "@/lib/i18n/t";

interface BulkBarProps {
  selectedCount: number;
  onShare: () => void;
  onMove: () => void;
  onDelete: () => void;
  onStar: () => void;
  onClear: () => void;
}

export function BulkBar({ selectedCount, onShare, onMove, onDelete, onStar, onClear }: BulkBarProps) {
  const t = translator(useLocale());
  if (selectedCount === 0) return null;

  return (
    <div style={{
      // [SAFE-AREA] Clears the home indicator now that viewportFit:cover is on.
      position: "fixed", bottom: "calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))",
      // [ZIJBALK] Centred over the CONTENT, not the window: with a 240px rail, plain 50% puts this
      // bar 120px left of the list it belongs to. --rail-w is 0px below the breakpoint.
      left: "calc(50% + var(--rail-w) / 2)",
      transform: "translateX(-50%)",
      zIndex: 100,
      display: "flex", alignItems: "center", gap: 4,
      background: T.onSurface,
      borderRadius: T.xl,
      boxShadow: T.elev3,
      padding: "10px 16px",
      animation: "m3fadeUp 0.2s cubic-bezier(0.4,0,0.2,1)",
      whiteSpace: "nowrap",
      // [PILOT-3] The bar is centred and FIXED, so anything wider than the window hangs off both
      // edges — and a fixed element cannot be scrolled to. Measured on a 320px phone in Dutch, the
      // bar wants 391px and "Selectie wissen" sat at x=-35: the one control that ends the selection
      // was unreachable. Containing it to the window keeps every action within reach, and the
      // overflow that no longer fits becomes a scroll INSIDE the bar rather than off the screen.
      // Nothing shrinks: the buttons measure the same before and after, so the icons stay tappable.
      // Above ~360px the bar is narrower than the window and neither rule does anything, which is
      // why the desktop bar — still centred over the content, not the window — is untouched.
      maxWidth: "calc(100vw - 16px)",
      overflowX: "auto",
    }}>
      <style>{`
        @keyframes m3fadeUp {
          from { opacity:0; transform:translateX(-50%) translateY(8px); }
          to   { opacity:1; transform:translateX(-50%) translateY(0); }
        }
      `}</style>

      <span style={{ fontSize: 14, fontWeight: 600, color: "white", marginInlineEnd: 4 }}>
        {t("bst.geselecteerd", { count: selectedCount })}
      </span>
      <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)", margin: "0 4px" }} />

      {[
        { label: "Ster", icon: "star", onClick: onStar },
        { label: "Delen", icon: "share", onClick: onShare },
        { label: "Verplaatsen", icon: "drive_file_move", onClick: onMove },
      ].map(btn => (
        <button key={btn.label} onClick={btn.onClick} style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 10px", background: "none", border: "none",
          color: "white", fontSize: 13, cursor: "pointer",
          borderRadius: T.md, transition: "background 0.1s",
        }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
          onMouseLeave={e => (e.currentTarget.style.background = "none")}
        >
          <Icon name={btn.icon} size={16} color="white" />
          <span className="hidden sm:block">{btn.label}</span>
        </button>
      ))}

      <button onClick={onDelete} style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "6px 10px", background: "none", border: "none",
        color: "#F28B82", fontSize: 13, cursor: "pointer", borderRadius: T.md,
      }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(242,139,130,0.12)")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
      >
        <Icon name="delete" size={16} color="#F28B82" />
        <span className="hidden sm:block">{t("bst.verwijderen")}</span>
      </button>

      <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)", margin: "0 4px" }} />
      <button onClick={onClear} aria-label={t("bst.selectieWissen")} style={{
        width: 28, height: 28, border: "none", background: "none",
        cursor: "pointer", display: "flex", alignItems: "center",
        justifyContent: "center", borderRadius: T.full,
      }}>
        <Icon name="close" size={16} color="white" />
      </button>
    </div>
  );
}
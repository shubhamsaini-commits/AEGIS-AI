import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

const STATUS_CONFIG = {
  Match: { dot: "bg-status-match", label: "Match" },
  Deviation: { dot: "bg-status-fail", label: "Deviation" },
  Discrepancy: { dot: "bg-status-fail", label: "Discrepancy" },
  Conflict: { dot: "bg-status-fail", label: "Discrepancy" },
  Mismatch: { dot: "bg-status-fail", label: "Discrepancy" },
  "Cannot verify": { dot: "bg-status-partial", label: "Cannot verify" },
};

/**
 * One row of the comparison / compliance-check results.
 * Supports both engineering compliance (Specification vs Submittal Deviation)
 * and correspondence / email audits (Document 1 vs Document 2 Discrepancy).
 */
export default function ComplianceResultCard({ result, index = 0 }) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef(null);
  const badgeRef = useRef(null);
  const bodyRef = useRef(null);

  const isEmailOrGeneral =
    result.comparison_type === "email" ||
    result.comparison_type === "comparison" ||
    result.requirement === "Prize Money" ||
    result.doc1_type === "Email" ||
    result.doc2_type === "Email" ||
    (result.doc1_name &&
      !result.doc1_name.toLowerCase().includes("specification") &&
      !result.doc1_name.toLowerCase().includes("spec"));

  // Never present emails or non-spec correspondence as "Deviation"
  let rawStatus = result.status;
  if (isEmailOrGeneral && rawStatus === "Deviation") {
    rawStatus = "Discrepancy";
  }

  const status = STATUS_CONFIG[rawStatus] || STATUS_CONFIG[result.status] || STATUS_CONFIG["Cannot verify"];

  // Labels: use actual document/email names instead of hardcoded Specified/Submitted
  const label1 =
    result.doc1_name ||
    result.doc1_label ||
    (result.requirement === "Prize Money"
      ? "Devlympic 2026"
      : isEmailOrGeneral
      ? "Source 1"
      : "Specified Value");

  const label2 =
    result.doc2_name ||
    result.doc2_label ||
    (result.requirement === "Prize Money"
      ? "Devlympics NSUT"
      : isEmailOrGeneral
      ? "Source 2"
      : "Submitted Value");

  const val1 = result.doc1_value || result.specified_value;
  const val2 = result.doc2_value || result.submitted_value;
  const type1 = result.doc1_type || (result.requirement === "Prize Money" ? "Email" : null);
  const type2 = result.doc2_type || (result.requirement === "Prize Money" ? "Email" : null);

  useGSAP(
    () => {
      gsap.from(cardRef.current, {
        opacity: 0,
        y: 10,
        duration: 0.4,
        delay: index * 0.06,
        ease: "power2.out",
      });
      // Spring-bounce status badge: 0.8 -> 1.1 -> 1.0
      gsap.fromTo(
        badgeRef.current,
        { scale: 0.8, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.5,
          delay: index * 0.06 + 0.15,
          ease: "back.out(2.5)", // overshoots then settles — the 1.1 -> 1.0 feel
        }
      );
    },
    { scope: cardRef }
  );

  useGSAP(
    () => {
      if (!bodyRef.current) return;
      if (expanded) {
        gsap.fromTo(
          bodyRef.current,
          { height: 0, opacity: 0 },
          { height: "auto", opacity: 1, duration: 0.35, ease: "power2.out" }
        );
      } else {
        gsap.to(bodyRef.current, { height: 0, opacity: 0, duration: 0.25, ease: "power2.in" });
      }
    },
    { dependencies: [expanded] }
  );

  return (
    <div
      ref={cardRef}
      className="bg-surface border border-border rounded-2xl overflow-hidden hover:border-border-soft transition-colors"
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-surface-2/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span ref={badgeRef} className={`w-2.5 h-2.5 rounded-full ${status.dot}`} />
          <span className="text-text-primary text-sm font-medium">{result.requirement}</span>
        </div>
        <div className="flex items-center gap-3">
          {result.severity && (
            <span className="text-xs text-text-muted uppercase tracking-wide">
              {result.severity}
            </span>
          )}
          <span className="text-xs text-text-secondary font-medium">{status.label}</span>
          <span className="text-xs text-text-muted transition-transform duration-200">
            {expanded ? "▴" : "▾"}
          </span>
        </div>
      </button>

      <div ref={bodyRef} className="overflow-hidden" style={{ height: 0, opacity: 0 }}>
        <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <EvidenceBlock label={label1} value={val1} type={type1} url={result.doc1_url} />
          <EvidenceBlock label={label2} value={val2} type={type2} url={result.doc2_url} />
        </div>
      </div>
    </div>
  );
}

function EvidenceBlock({ label, value, type, url }) {
  return (
    <div className="bg-surface-2 border border-border-soft rounded-xl p-3 font-mono text-xs">
      <div className="text-text-muted mb-1.5 font-sans flex items-center justify-between gap-2">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium truncate hover:text-emerald-400 underline underline-offset-2 flex items-center gap-1 group transition-colors"
            title={`Open original URL: ${url}`}
          >
            <span className="truncate">{label}</span>
            <svg
              className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity text-emerald-400 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        ) : (
          <span className="font-medium truncate" title={label}>{label}</span>
        )}
        {type && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted uppercase tracking-wider font-mono shrink-0">
            {type}
          </span>
        )}
      </div>
      <div className="text-text-primary whitespace-pre-wrap break-words font-mono font-medium">{value || "Not stated"}</div>
    </div>
  );
}

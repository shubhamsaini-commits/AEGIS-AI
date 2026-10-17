import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatCard from "../components/StatCard";
import { getStats } from "../api/client";

/**
 * AEGIS AI Home Dashboard (SIH PS ID: 26117)
 * Air-gapped on-premises intelligence for Refineries, PSUs,
 * defence manufacturing, and government offices.
 */
export default function Home() {
  const [stats, setStats] = useState({ total_documents: 0, total_chunks: 0, deviations_found: 0 });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getStats()
      .then((res) => setStats(res.data))
      .catch(() => {
        // /stats not implemented yet, or backend unreachable
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h2
          className="text-2xl sm:text-3xl font-semibold mb-2 leading-tight"
          style={{
            background: "linear-gradient(90deg, rgba(255,255,255,0.95), rgba(255,255,255,0.5))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          AEGIS AI
        </h2>
        <p className="text-text-primary/90 text-sm font-medium mb-2">
          Autonomous Engineering Governance and Intelligence System
        </p>
        <p className="text-text-secondary text-sm leading-relaxed max-w-3xl">
          Air-gapped on-premises engineering intelligence for Refineries, PSUs, Defence manufacturing, and Government offices.
          Safeguarding Piping &amp; Instrument Diagrams (P&amp;IDs), technical specifications, vendor negotiations,
          financials, and internal correspondence on local GPU hardware — with zero external network transmission.
        </p>
      </div>

      {/* ── Headline Metrics ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Technical Documents Ingested" value={stats.total_documents} index={0} />
        <StatCard label="Chunks in Knowledge Base" value={stats.total_chunks} index={1} />
        <StatCard label="Deviations & Discrepancies Identified" value={stats.deviations_found} index={2} />
      </div>

      {/* ── Quick Action Shortcuts ── */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => navigate("/ask")}
          className="px-5 py-3 rounded-xl bg-surface border border-border text-text-primary text-sm hover:border-accent/50 hover:bg-surface-2 transition-all flex items-center gap-2"
        >
          <span>💬</span>
          <span>Ask Documents (Air-Gapped RAG) →</span>
        </button>
        <button
          onClick={() => navigate("/compliance")}
          className="px-5 py-3 rounded-xl bg-surface border border-border text-text-primary text-sm hover:border-accent/50 hover:bg-surface-2 transition-all flex items-center gap-2"
        >
          <span>🔍</span>
          <span>Run Technical Compliance Audit →</span>
        </button>
        <button
          onClick={() => navigate("/emails")}
          className="px-5 py-3 rounded-xl bg-surface border border-border text-text-primary text-sm hover:border-accent/50 hover:bg-surface-2 transition-all flex items-center gap-2"
        >
          <span>✉️</span>
          <span>Internal Correspondence →</span>
        </button>
        <button
          onClick={() => navigate("/documents")}
          className="px-5 py-3 rounded-xl bg-surface border border-border text-text-primary text-sm hover:border-accent/50 hover:bg-surface-2 transition-all flex items-center gap-2"
        >
          <span>📁</span>
          <span>Document Vault →</span>
        </button>
      </div>
    </div>
  );
}

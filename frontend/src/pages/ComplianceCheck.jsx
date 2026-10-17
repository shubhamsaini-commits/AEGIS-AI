import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import ComplianceResultCard from "../components/ComplianceResultCard";
import EmptyState from "../components/EmptyState";
import { runComplianceCheck, getLastComplianceCheck, getDocuments, ingestUrl } from "../api/client";
import { useToast } from "../components/Toast";

export default function ComplianceCheck() {
  const [results, setResults] = useState([]);
  const [ranAt, setRanAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [documents, setDocuments] = useState([]);
  const [selected, setSelected] = useState([]);
  const [govtUrl, setGovtUrl] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [auditPrompt, setAuditPrompt] = useState("");
  const boxRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    getLastComplianceCheck()
      .then((res) => {
        setResults(res.data.results || []);
        setRanAt(res.data.ran_at || null);
      })
      .catch(() => {})
      .finally(() => setInitialLoading(false));

    getDocuments()
      .then((res) => setDocuments(res.data.documents || []))
      .catch(() => {});
  }, []);

  useGSAP(
    () => {
      if (loading) boxRef.current?.classList.add("radar-sweep");
      else boxRef.current?.classList.remove("radar-sweep");
    },
    { dependencies: [loading] }
  );

  const toggleSelect = (documentId) => {
    setSelected((prev) =>
      prev.includes(documentId)
        ? prev.filter((id) => id !== documentId)
        : [...prev, documentId]
    );
  };

  const handleScrapeUrl = async () => {
    if (!govtUrl || !govtUrl.trim()) {
      toast?.show("Please enter a valid URL.", "error");
      return;
    }
    setIsScraping(true);
    try {
      const res = await ingestUrl(govtUrl.trim());
      if (res.data.status === "success") {
        toast?.show(`Ingested: ${res.data.filename}`, "success");
        setGovtUrl("");
        const docsRes = await getDocuments();
        const updated = docsRes.data.documents || [];
        setDocuments(updated);
        if (res.data.document_id) {
          setSelected((prev) => [...prev, res.data.document_id]);
        }
      } else {
        toast?.show(res.data.message || "Failed to ingest URL", "error");
      }
    } catch (err) {
      toast?.show(err.response?.data?.detail || "URL ingestion failed.", "error");
    } finally {
      setIsScraping(false);
    }
  };

  const handleRun = async () => {
    const validSelected = selected.filter((id) =>
      documents.some((doc) => doc.document_id === id)
    );

    if (validSelected.length < 2) {
      toast?.show("Select at least 2 documents to compare.", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await runComplianceCheck(validSelected, auditPrompt.trim() || null);
      setResults(res.data.results || []);
      setRanAt(res.data.ran_at || null);
    } catch (err) {
      const message =
        err.response?.data?.detail ||
        (err.code === "ECONNABORTED"
          ? "Audit timed out — local model took longer than 3 minutes. Please narrow the prompt."
          : err.message || "Compliance check failed — check the backend.");
      toast?.show(message, "error");
    } finally {
      setLoading(false);
    }
  };

  const hasEmails = results.some(
    (r) =>
      r.comparison_type === "email" ||
      r.doc1_type === "Email" ||
      r.doc2_type === "Email" ||
      r.status === "Discrepancy" ||
      r.requirement === "Prize Money" ||
      (r.doc1_name && !r.doc1_name.toLowerCase().includes("spec"))
  );

  const issueCount = results.filter(
    (r) =>
      r.status === "Deviation" ||
      r.status === "Discrepancy" ||
      r.status === "Conflict" ||
      r.status === "Mismatch"
  ).length;

  const hasRun = ranAt !== null;

  const formattedTime = ranAt
    ? new Date(ranAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-6xl">
      <div className="mb-6">
        <h2 className="text-xl font-medium text-text-primary">
          {hasEmails ? "Cross-Document & Email Verification" : "Technical Compliance Audit"}
        </h2>
        <p className="text-xs text-text-muted mt-0.5">
          {hasEmails
            ? "Automated email correspondence discrepancy detection and cross-document verification"
            : "Automated specification vs. vendor submittal auditing on local GPU hardware"}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <div
          ref={boxRef}
          className="bg-surface border border-border rounded-2xl p-6 h-fit lg:sticky lg:top-20"
        >
          <p className="text-text-secondary text-sm mb-4">
            Select two or more documents or correspondence to compare — identify discrepancies across site emails, or audit technical specifications against vendor submittals.
          </p>

          <div className="text-xs text-text-muted mb-4 space-y-2 max-h-64 overflow-y-auto">
            {documents.length === 0 && (
              <div className="text-text-muted">No documents uploaded yet.</div>
            )}
            {documents.map((doc) => (
              <label
                key={doc.document_id}
                className="flex items-center gap-2 cursor-pointer group hover:text-text-primary transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(doc.document_id)}
                  onChange={() => toggleSelect(doc.document_id)}
                />
                <span className="truncate flex-1">
                  {doc.filename}{" "}
                  <span className="text-text-muted">({doc.document_type})</span>
                </span>
                {doc.source_url && (
                  <a
                    href={doc.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={`Open source: ${doc.source_url}`}
                    className="text-text-muted hover:text-emerald-400 p-0.5 transition-colors shrink-0"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </label>
            ))}
          </div>

          {/* --- 1. EXTERNAL GOVT / POLICY URL SCRAPER INPUT --- */}
          <div className="mt-4 pt-4 border-t border-border">
            <label className="block text-xs font-medium text-emerald-400 uppercase tracking-wider mb-1.5">
              + Bridge External Govt / Regulatory URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={govtUrl}
                onChange={(e) => setGovtUrl(e.target.value)}
                placeholder="https://fssai.gov.in/advisory..."
                className="flex-1 bg-surface border border-border rounded-xl px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-emerald-500 transition-colors"
              />
              <button
                type="button"
                onClick={handleScrapeUrl}
                disabled={isScraping || !govtUrl.trim()}
                className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 rounded-xl text-xs font-medium transition-colors whitespace-nowrap"
              >
                {isScraping ? "Scraping..." : "Ingest URL"}
              </button>
            </div>
          </div>

          {/* --- 2. STEERED COMPLIANCE PROMPT INPUT --- */}
          <div className="mt-4 pt-3 border-t border-border mb-4">
            <label className="block text-xs font-medium text-indigo-400 uppercase tracking-wider mb-1.5">
              Audit Scope / Custom Prompt (Optional)
            </label>
            <textarea
              rows={3}
              value={auditPrompt}
              onChange={(e) => setAuditPrompt(e.target.value)}
              placeholder="e.g., Compare only the syllabus & credits of Semester 3 between these two branches..."
              className="w-full bg-surface border border-border rounded-xl p-2.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-indigo-500 resize-none transition-colors"
            />
            {/* Quick 1-Click Demo Presets for Judges */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button
                type="button"
                onClick={() => setAuditPrompt("Compare only Semester 3 subjects, course codes, and credits between both branches.")}
                className="text-[10px] bg-surface-muted hover:bg-border text-text-secondary hover:text-text-primary px-2 py-1 rounded-lg border border-border transition-colors"
              >
                ⚡ Sem 3 Syllabus Diff
              </button>
              <button
                type="button"
                onClick={() => setAuditPrompt("Audit internal food formulation recipes against banned ingredients and ppm limits in the Govt notice.")}
                className="text-[10px] bg-surface-muted hover:bg-border text-text-secondary hover:text-text-primary px-2 py-1 rounded-lg border border-border transition-colors"
              >
                ⚡ Govt Food Ban Audit
              </button>
            </div>
          </div>

          <button
            onClick={handleRun}
            disabled={loading || selected.length < 2}
            className="w-full py-2.5 rounded-xl bg-accent text-white text-sm disabled:opacity-50 hover:bg-accent/90 transition-colors"
          >
            {loading ? "Auditing…" : hasRun ? "Re-run Verification Audit" : "Run Verification Audit"}
          </button>

          {hasRun && !loading && (
            <div className="mt-4 space-y-1">
              <div className="text-xs text-text-muted">Last run: {formattedTime}</div>
              <div className="text-xs">
                {issueCount > 0 ? (
                  <span className="text-status-fail">
                    {issueCount} {hasEmails ? "discrepancy(ies)" : "deviation(s)"} found
                  </span>
                ) : (
                  <span className="text-status-match">All points matched</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {initialLoading && (
            <EmptyState icon="⏳" title="Loading last result…" />
          )}
          {!initialLoading && !hasRun && (
            <EmptyState
              icon="🛡️"
              title="No audit executed yet"
              description="Select documents and run a technical compliance audit."
            />
          )}
          {!initialLoading && hasRun && results.length === 0 && (
            <EmptyState
              icon="⚠️"
              title="No results returned"
              description="The backend responded, but no comparisons were found."
            />
          )}
          {results.map((r, i) => (
            <ComplianceResultCard key={i} result={r} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
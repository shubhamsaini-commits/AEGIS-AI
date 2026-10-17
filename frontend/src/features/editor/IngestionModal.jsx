import { useState, useMemo } from "react";
import StatusBadge from "../../components/StatusBadge";

export default function IngestionModal({
  isOpen,
  onClose,
  draft,
  existingDocuments = [],
  onConfirmIngest,
  isIngesting = false,
  ingestionResult = null,
  ingestionError = null,
  onRetry,
  onOpenInVault,
}) {
  const [useDistinctName, setUseDistinctName] = useState(false);
  const [distinctTitle, setDistinctTitle] = useState("");

  // Check if same filename already exists in ChromaDB vault
  const duplicateMatch = useMemo(() => {
    if (!draft) return null;
    return existingDocuments.find(
      (d) => d.filename.toLowerCase() === draft.title.toLowerCase()
    );
  }, [draft, existingDocuments]);

  if (!isOpen || !draft) return null;

  const finalTitle = useDistinctName && distinctTitle ? distinctTitle : draft.title;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in text-xs font-sans"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#191C20] border border-[#2B3036] rounded shadow-dialog overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-[#2B3036] bg-[#17191C] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base text-[#38BDF8]">⛁</span>
            <h3 className="text-sm font-semibold text-text-primary">
              Ingest Document into AEGIS Knowledge Base
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={isIngesting}
            className="text-text-muted hover:text-text-primary p-1 text-xs"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Success State */}
          {ingestionResult ? (
            <div className="space-y-3">
              <div className="p-3 rounded bg-[#4ADE80]/10 border border-[#4ADE80]/30 flex items-start gap-2.5">
                <span className="text-[#4ADE80] font-bold text-sm">✓</span>
                <div>
                  <h4 className="font-semibold text-[#4ADE80] text-xs">
                    Document Successfully Indexed into ChromaDB!
                  </h4>
                  <p className="text-text-secondary text-xs mt-0.5">
                    "{finalTitle}" was parsed, chunked, and embedded into the local vector store.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-[#111315] border border-[#2B3036] rounded font-mono text-xs space-y-1.5 text-text-secondary">
                <div>Document ID: <span className="text-text-primary">{ingestionResult.document_id}</span></div>
                <div>Chunks Generated: <span className="text-[#38BDF8]">{ingestionResult.chunks_added} chunks</span></div>
                <div>Classified Type: <span className="text-text-primary">{ingestionResult.document_type || "Specification / Notes"}</span></div>
                <div>Status: <span className="text-[#4ADE80]">Active &amp; Queryable in Grounded RAG</span></div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded bg-[#22262B] hover:bg-[#2C323A] text-text-primary border border-[#2B3036]"
                >
                  Close
                </button>
                <button
                  onClick={onOpenInVault}
                  className="px-3.5 py-1.5 rounded bg-[#38BDF8] hover:bg-[#0284C7] text-black font-semibold"
                >
                  View in Document Vault →
                </button>
              </div>
            </div>
          ) : ingestionError ? (
            /* Error State with Retain Draft */
            <div className="space-y-3">
              <div className="p-3 rounded bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-start gap-2.5">
                <span className="text-[#F87171] font-bold text-sm">✕</span>
                <div>
                  <h4 className="font-semibold text-[#F87171] text-xs">Ingestion Failed</h4>
                  <p className="text-text-primary text-xs mt-0.5">{ingestionError.message}</p>
                </div>
              </div>

              <p className="text-text-muted text-[11px] leading-relaxed">
                Your draft has been preserved locally in your browser. You can inspect the diagnostic details below and retry when the local backend service is ready.
              </p>

              {ingestionError.detail && (
                <pre className="p-2.5 rounded bg-[#111315] border border-[#2B3036] font-mono text-[10px] text-text-secondary max-h-32 overflow-auto">
                  {typeof ingestionError.detail === "object"
                    ? JSON.stringify(ingestionError.detail, null, 2)
                    : ingestionError.detail}
                </pre>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded bg-[#22262B] hover:bg-[#2C323A] text-text-primary border border-[#2B3036]"
                >
                  Return to Editor
                </button>
                <button
                  onClick={() => onRetry && onRetry(finalTitle)}
                  className="px-3.5 py-1.5 rounded bg-[#38BDF8] hover:bg-[#0284C7] text-black font-semibold"
                >
                  Retry Ingestion
                </button>
              </div>
            </div>
          ) : (
            /* Pre-ingestion Confirmation Form */
            <div className="space-y-4">
              {/* Duplicate Filename Warning */}
              {duplicateMatch && !useDistinctName && (
                <div className="p-3 rounded bg-[#FBBF24]/10 border border-[#FBBF24]/30 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-[#FBBF24]">
                    <span>⚠</span> Same Filename Already Indexed
                  </div>
                  <p className="text-text-secondary leading-relaxed">
                    A document titled <code className="text-text-primary font-mono">{draft.title}</code> already exists in ChromaDB ({duplicateMatch.chunk_count} chunks). To prevent duplicate indexing confusion, choose an option:
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => {
                        setUseDistinctName(true);
                        const parts = draft.title.split(".");
                        const ext = parts.pop();
                        setDistinctTitle(`${parts.join(".")}_v2.${ext}`);
                      }}
                      className="px-2.5 py-1 rounded bg-[#22262B] hover:bg-[#2C323A] text-text-primary border border-[#2B3036] text-[11px]"
                    >
                      Ingest with Distinct Name
                    </button>
                    <button
                      onClick={onClose}
                      className="px-2.5 py-1 rounded bg-transparent hover:bg-[#22262B] text-text-muted text-[11px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Distinct Name Input */}
              {useDistinctName && (
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-text-muted">Distinct Filename:</label>
                  <input
                    type="text"
                    value={distinctTitle}
                    onChange={(e) => setDistinctTitle(e.target.value)}
                    className="w-full bg-[#111315] text-text-primary px-3 py-1.5 rounded border border-[#38BDF8] font-mono text-xs focus:outline-none"
                  />
                </div>
              )}

              {/* Document Overview Metadata */}
              <div className="grid grid-cols-2 gap-2 p-3 rounded bg-[#111315] border border-[#2B3036] text-xs font-mono">
                <div>
                  <span className="text-text-muted">Target Filename:</span>
                  <div className="font-semibold text-text-primary mt-0.5 truncate">{finalTitle}</div>
                </div>
                <div>
                  <span className="text-text-muted">Format:</span>
                  <div className="font-semibold text-[#38BDF8] mt-0.5 uppercase">
                    {draft.format === "text" ? "Plain Text (.txt)" : "Markdown (.md)"}
                  </div>
                </div>
                <div>
                  <span className="text-text-muted">Content Size:</span>
                  <div className="text-text-secondary mt-0.5">
                    {draft.content.length.toLocaleString()} characters ({draft.content.split("\n").length} lines)
                  </div>
                </div>
                <div>
                  <span className="text-text-muted">Target Database:</span>
                  <div className="text-text-secondary mt-0.5">ChromaDB (epc_documents)</div>
                </div>
              </div>

              {/* Content Preview */}
              <div>
                <label className="text-[11px] font-mono uppercase tracking-wider text-text-muted block mb-1">
                  Content Preview:
                </label>
                <div className="p-3 rounded bg-[#111315] border border-[#2B3036] font-mono text-[11px] text-text-secondary max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
                  {draft.content.slice(0, 800)}
                  {draft.content.length > 800 ? "\n... (remaining content truncated for preview)" : ""}
                </div>
              </div>

              {/* Security Statement */}
              <p className="text-[11px] text-text-muted leading-relaxed">
                ℹ <strong>Enclave Ingestion Statement:</strong> This file will be generated in-browser as a native file object and submitted directly to the on-premises sandboxed ingestion pipeline for chunking and SentenceTransformer embedding. Zero cloud transmission.
              </p>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#2B3036]">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isIngesting}
                  className="px-3.5 py-1.5 rounded bg-[#22262B] hover:bg-[#2C323A] text-text-secondary hover:text-text-primary border border-[#2B3036] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onConfirmIngest(finalTitle)}
                  disabled={isIngesting || !draft.content.trim()}
                  className="px-4 py-1.5 rounded bg-[#38BDF8] hover:bg-[#0284C7] disabled:opacity-40 text-black font-semibold shadow-sm flex items-center gap-1.5 transition-colors"
                >
                  {isIngesting ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full border-2 border-black border-t-transparent animate-spin" />
                      <span>Ingesting into Vector DB...</span>
                    </>
                  ) : (
                    <>
                      <span>⛁ Confirm &amp; Ingest</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

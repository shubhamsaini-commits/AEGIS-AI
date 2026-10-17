import { useState, useEffect } from "react";
import StatusBadge from "../../components/StatusBadge";

export default function EditorToolbar({
  title,
  onRename,
  status = "draft", // 'draft' | 'unsaved' | 'ingesting' | 'ingested' | 'failed'
  isDirty = false,
  onSave,
  onIngest,
  onExport,
  onDelete,
  previewMode = false,
  onTogglePreview,
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(title);

  useEffect(() => {
    setTitleInput(title);
  }, [title]);

  const handleTitleSubmit = () => {
    if (titleInput.trim()) {
      onRename(titleInput.trim());
    } else {
      setTitleInput(title);
    }
    setEditingTitle(false);
  };

  const getStatusLabel = () => {
    if (isDirty) return { label: "Unsaved Changes", status: "partial" };
    switch (status) {
      case "ingesting":
        return { label: "Ingesting into Vector DB...", status: "active" };
      case "ingested":
        return { label: "Indexed in ChromaDB", status: "match" };
      case "failed":
        return { label: "Ingestion Failed", status: "fail" };
      default:
        return { label: "Local Draft", status: "neutral" };
    }
  };

  const statusInfo = getStatusLabel();

  return (
    <div className="h-11 bg-[#17191C] border-b border-[#2B3036] flex items-center justify-between px-3 select-none flex-shrink-0 text-xs">
      {/* Left: Document Title & Rename */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span className="text-sm font-mono text-[#38BDF8]">📝</span>
        {editingTitle ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={titleInput}
              autoFocus
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTitleSubmit();
                if (e.key === "Escape") {
                  setTitleInput(title);
                  setEditingTitle(false);
                }
              }}
              className="bg-[#111315] text-text-primary px-2 py-0.5 rounded border border-[#38BDF8] text-xs font-mono focus:outline-none"
            />
            <button
              onClick={handleTitleSubmit}
              className="px-2 py-0.5 rounded bg-[#22262B] text-[11px] text-[#4ADE80] font-mono hover:bg-[#2C323A]"
            >
              ✓
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditingTitle(true)}
            className="flex items-center gap-1.5 font-mono text-xs font-semibold text-text-primary hover:text-[#38BDF8] px-1.5 py-0.5 rounded hover:bg-[#22262B] transition-colors truncate"
            title="Click to rename document"
          >
            <span className="truncate">{title}</span>
            <span className="text-[10px] text-text-muted opacity-60">✎</span>
          </button>
        )}

        <StatusBadge status={statusInfo.status} label={statusInfo.label} size="xs" />
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Toggle Markdown Preview */}
        <button
          onClick={onTogglePreview}
          className={`px-2.5 py-1 rounded text-xs font-mono transition-colors border ${
            previewMode
              ? "bg-[#22262B] text-[#38BDF8] border-[#38BDF8]"
              : "bg-[#17191C] text-text-secondary border-[#2B3036] hover:text-text-primary hover:bg-[#22262B]"
          }`}
          title="Toggle Markdown Preview"
        >
          {previewMode ? "Editor View" : "Preview"}
        </button>

        {/* Export Button */}
        <button
          onClick={onExport}
          className="px-2.5 py-1 rounded text-xs font-medium bg-[#17191C] hover:bg-[#22262B] text-text-secondary hover:text-text-primary border border-[#2B3036] transition-colors"
          title="Download draft to disk"
        >
          Export
        </button>

        {/* Save Draft */}
        <button
          onClick={onSave}
          className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors border ${
            isDirty
              ? "bg-[#38BDF8]/10 text-[#38BDF8] border-[#38BDF8] hover:bg-[#38BDF8]/20"
              : "bg-[#22262B] text-text-muted border-[#2B3036] hover:text-text-primary"
          }`}
          title="Save draft to local browser profile (Ctrl+S)"
        >
          <span>Save</span>
          <kbd className="hidden sm:inline font-mono text-[9px] opacity-70">Ctrl+S</kbd>
        </button>

        {/* Ingest to Knowledge Base */}
        <button
          onClick={onIngest}
          disabled={status === "ingesting"}
          className="px-3 py-1 rounded text-xs font-semibold bg-[#38BDF8] hover:bg-[#0284C7] disabled:opacity-40 text-black transition-colors shadow-sm flex items-center gap-1.5"
          title="Ingest draft into ChromaDB vector knowledge base (Ctrl+Shift+I)"
        >
          <span>⛁</span>
          <span>{status === "ingesting" ? "Ingesting..." : "Ingest Document"}</span>
        </button>

        {/* Delete Draft */}
        <button
          onClick={onDelete}
          className="p-1 rounded text-text-muted hover:text-[#F87171] hover:bg-[#22262B] transition-colors ml-1"
          title="Delete draft"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

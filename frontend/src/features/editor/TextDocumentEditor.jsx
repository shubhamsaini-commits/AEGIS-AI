import { useState, useEffect, useRef, useMemo } from "react";
import EditorToolbar from "./EditorToolbar";
import MarkdownPreview from "./MarkdownPreview";
import IngestionModal from "./IngestionModal";
import ConfirmDialog from "./ConfirmDialog";
import {
  saveDraft,
  updateDraftStatus,
  deleteDraft,
  exportDraft,
} from "./DraftStore";
import { uploadDocument } from "../../services/documentsApi";
import { useNotification } from "../../components/NotificationCenter";

export default function TextDocumentEditor({
  draft,
  onDraftChange,
  onDeleteDraft,
  onOpenVault,
  existingDocuments = [],
  onDocumentIngested,
}) {
  const [content, setContent] = useState(draft ? draft.content : "");
  const [title, setTitle] = useState(draft ? draft.title : "Untitled.md");
  const [format, setFormat] = useState(draft ? draft.format : "markdown");
  const [isDirty, setIsDirty] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestionResult, setIngestionResult] = useState(null);
  const [ingestionError, setIngestionError] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const notification = useNotification();
  const textareaRef = useRef(null);

  // Sync state when draft prop changes
  useEffect(() => {
    if (draft) {
      setContent(draft.content || "");
      setTitle(draft.title || "Untitled.md");
      setFormat(draft.format || (draft.title.endsWith(".txt") ? "text" : "markdown"));
      setIsDirty(false);
      setPreviewMode(false);
      setIngestionResult(null);
      setIngestionError(null);
    }
  }, [draft?.id]);

  // Handle content changes
  const handleContentChange = (e) => {
    const newContent = e.target.value;
    setContent(newContent);
    setIsDirty(true);
  };

  // Keyboard shortcut handler inside editor
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl + S -> Save draft
      if ((e.ctrlKey || e.metaKey) && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        handleSave();
        return;
      }

      // Ctrl + Shift + I -> Ingest
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "I" || e.key === "i")) {
        e.preventDefault();
        setShowIngestModal(true);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draft, content, title, format]);

  // Tab key indentation support in textarea
  const handleTextareaKeyDown = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const newContent = content.substring(0, start) + "  " + content.substring(end);
      setContent(newContent);
      setIsDirty(true);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  // Save current draft
  const handleSave = () => {
    if (!draft) return;
    try {
      const updated = saveDraft({
        ...draft,
        title,
        content,
        format,
      });
      setIsDirty(false);
      onDraftChange?.(updated);
      notification.success(`Draft "${title}" saved to local browser storage.`, {
        title: "Draft Saved",
      });
    } catch (err) {
      notification.error("Failed to save draft locally.", { detail: err.message });
    }
  };

  // Rename draft
  const handleRename = (newTitle) => {
    setTitle(newTitle);
    setIsDirty(true);
    if (draft) {
      const updated = saveDraft({
        ...draft,
        title: newTitle,
        content,
      });
      onDraftChange?.(updated);
    }
  };

  // Ingestion execution
  const handleConfirmIngest = async (finalTitle) => {
    if (!draft) return;
    setIsIngesting(true);
    setIngestionError(null);
    setIngestionResult(null);

    // Save draft content first
    const updatedDraft = saveDraft({
      ...draft,
      title: finalTitle,
      content,
    });
    setTitle(finalTitle);
    setIsDirty(false);

    try {
      // 1. Create native browser File object
      const mimeType = finalTitle.endsWith(".txt") ? "text/plain" : "text/markdown";
      const blob = new Blob([content], { type: mimeType });
      const file = new File([blob], finalTitle, { type: mimeType, lastModified: Date.now() });

      // 2. Submit to existing FastAPI upload endpoint via documentsApi
      const res = await uploadDocument(file);

      if (res.status === "error") {
        throw new Error(res.message || "Backend rejected document parsing.");
      }

      // 3. Update Draft status to 'ingested'
      const ingestedDraft = updateDraftStatus(draft.id, {
        status: "ingested",
        backendDocId: res.document_id,
        chunkCount: res.chunks_added,
      });

      setIngestionResult(res);
      onDraftChange?.(ingestedDraft);
      onDocumentIngested?.(res);
      notification.success(
        `"${finalTitle}" ingested! Generated ${res.chunks_added} chunks in ChromaDB.`,
        { title: "Ingestion Successful" }
      );
    } catch (err) {
      const msg = err.message || "Failed to complete document ingestion.";
      setIngestionError({
        message: msg,
        detail: err.detail,
      });
      updateDraftStatus(draft.id, { status: "failed", error: msg });
      notification.error(msg, { title: "Ingestion Error", detail: err.detail });
    } finally {
      setIsIngesting(false);
    }
  };

  // Metrics calculation
  const metrics = useMemo(() => {
    const lines = content.split("\n");
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const chars = content.length;
    return { lineCount: lines.length, wordCount: words, charCount: chars };
  }, [content]);

  // Line numbers generation
  const lineNumbers = useMemo(() => {
    return Array.from({ length: Math.max(1, metrics.lineCount) }, (_, i) => i + 1);
  }, [metrics.lineCount]);

  if (!draft) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-center bg-[#111315]">
        <div className="text-text-muted text-xs">No active document selected.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#111315] text-text-primary overflow-hidden font-sans">
      {/* ── Editor Toolbar ── */}
      <EditorToolbar
        title={title}
        onRename={handleRename}
        status={draft.status}
        isDirty={isDirty}
        onSave={handleSave}
        onIngest={() => setShowIngestModal(true)}
        onExport={() => exportDraft({ ...draft, title, content })}
        onDelete={() => setShowDeleteConfirm(true)}
        previewMode={previewMode}
        onTogglePreview={() => setPreviewMode((prev) => !prev)}
      />

      {/* ── Main Editor Stage ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {previewMode ? (
          <div className="flex-1 overflow-auto bg-[#17191C]">
            <MarkdownPreview content={content} />
          </div>
        ) : (
          <div className="flex-1 flex min-h-0 bg-[#111315]">
            {/* Line Numbers Gutter */}
            <div className="w-12 bg-[#17191C] border-r border-[#2B3036] py-3 text-right pr-2.5 font-mono text-xs text-text-muted select-none flex-shrink-0 overflow-hidden">
              {lineNumbers.map((num) => (
                <div key={num} className="h-5 leading-5">
                  {num}
                </div>
              ))}
            </div>

            {/* Code / Markdown Textarea */}
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              onKeyDown={handleTextareaKeyDown}
              placeholder="Enter technical specifications, inspection notes, or site observations here... (Markdown supported)"
              className="flex-1 bg-transparent text-text-primary p-3 font-mono text-xs leading-5 focus:outline-none resize-none select-text overflow-y-auto whitespace-pre tab-4"
              spellCheck="false"
            />
          </div>
        )}
      </div>

      {/* ── Editor Bottom Status Bar ── */}
      <footer className="h-6 bg-[#17191C] border-t border-[#2B3036] flex items-center justify-between px-3 select-none flex-shrink-0 text-[11px] font-mono text-text-secondary">
        <div className="flex items-center gap-3">
          <span className="text-[#38BDF8] uppercase font-semibold">
            {format === "text" ? "Plain Text" : "Markdown"}
          </span>
          <span className="text-[#2B3036]">|</span>
          <span>UTF-8</span>
          <span className="text-[#2B3036]">|</span>
          <span>{metrics.lineCount} Lines</span>
          <span className="text-[#2B3036] hidden sm:inline">|</span>
          <span className="hidden sm:inline">{metrics.wordCount} Words</span>
          <span className="text-[#2B3036] hidden sm:inline">|</span>
          <span className="hidden sm:inline">{metrics.charCount} Chars</span>
        </div>

        <div className="flex items-center gap-2">
          {draft.status === "ingested" && !isDirty ? (
            <span className="text-[#4ADE80] flex items-center gap-1">
              <span>✓</span> Ingested ({draft.chunkCount || "Indexed"} chunks)
            </span>
          ) : isDirty ? (
            <span className="text-[#FBBF24] flex items-center gap-1">
              <span>●</span> Unsaved Edits
            </span>
          ) : (
            <span className="text-text-muted">Draft saved in browser</span>
          )}
        </div>
      </footer>

      {/* ── Ingestion Confirmation Modal ── */}
      <IngestionModal
        isOpen={showIngestModal}
        onClose={() => {
          setShowIngestModal(false);
          setIngestionResult(null);
          setIngestionError(null);
        }}
        draft={{ ...draft, title, content, format }}
        existingDocuments={existingDocuments}
        onConfirmIngest={handleConfirmIngest}
        isIngesting={isIngesting}
        ingestionResult={ingestionResult}
        ingestionError={ingestionError}
        onRetry={handleConfirmIngest}
        onOpenInVault={onOpenVault}
      />

      {/* ── Delete Draft Confirmation Dialog ── */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Discard Engineering Draft"
        message={`Are you sure you want to delete "${title}"?`}
        detail="This draft will be removed from your browser storage. If previously ingested into ChromaDB, the indexed vectors will remain unless deleted from the Document Vault."
        confirmLabel="Discard Draft"
        confirmVariant="danger"
        onConfirm={() => {
          deleteDraft(draft.id);
          onDeleteDraft?.(draft.id);
          setShowDeleteConfirm(false);
          notification.info(`Draft "${title}" deleted.`);
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

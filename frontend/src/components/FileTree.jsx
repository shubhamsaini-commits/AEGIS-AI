import { useState, useMemo } from "react";
import FileRow from "./FileRow";
import SearchBar from "./SearchBar";

export default function FileTree({
  documents = [],
  drafts = [],
  activeDocId = null,
  activeDraftId = null,
  onSelectDocument,
  onSelectDraft,
  onOpenViewer,
  onAskAbout,
  onDeleteDocument,
  onUploadClick,
  onNewNoteClick,
  className = "",
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsed, setCollapsed] = useState({
    documents: false,
    specifications: false,
    submittals: false,
    schedules: false,
    otherDocs: false,
    notes: false,
    compliance: false,
    correspondence: false,
  });

  const toggleSection = (key) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Group files logically based on their real backend metadata
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter(
      (d) =>
        d.filename.toLowerCase().includes(q) ||
        (d.document_type && d.document_type.toLowerCase().includes(q))
    );
  }, [documents, searchQuery]);

  const groups = useMemo(() => {
    const specs = [];
    const submittals = [];
    const schedules = [];
    const other = [];

    filtered.forEach((doc) => {
      const type = (doc.document_type || "").toLowerCase();
      const fn = (doc.filename || "").toLowerCase();
      if (type.includes("specification") || fn.includes("specification") || fn.includes("spec")) {
        specs.push(doc);
      } else if (type.includes("submittal") || fn.includes("submittal") || fn.includes("vendor")) {
        submittals.push(doc);
      } else if (type.includes("schedule") || type.includes("rfi") || fn.includes("schedule") || fn.includes("rfi")) {
        schedules.push(doc);
      } else {
        other.push(doc);
      }
    });

    return { specs, submittals, schedules, other };
  }, [filtered]);

  return (
    <div className={`flex flex-col h-full bg-[#1B1E22] text-text-primary select-none ${className}`}>
      {/* Search within explorer */}
      <div className="p-2 border-b border-[#2B3036]">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Filter workspace files..."
          shortcut=""
        />
      </div>

      {/* Explorer Tree Content */}
      <div className="flex-1 overflow-y-auto px-1 py-2 space-y-1 font-sans text-xs">
        {/* Workspace root header */}
        <div className="px-2 py-1 flex items-center justify-between text-[11px] font-mono tracking-wider uppercase text-text-muted">
          <span className="flex items-center gap-1.5 font-bold">
            <span className="text-[#38BDF8]">☵</span> AEGIS WORKSPACE
          </span>
          <div className="flex items-center gap-1">
            {onUploadClick && (
              <button
                onClick={onUploadClick}
                title="Upload Document"
                className="hover:text-text-primary p-0.5 rounded hover:bg-[#22262B]"
              >
                +
              </button>
            )}
          </div>
        </div>

        {/* ── DOCUMENTS GROUP ── */}
        <div>
          <button
            onClick={() => toggleSection("documents")}
            className="w-full flex items-center justify-between px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-[#22262B] rounded text-left font-medium"
          >
            <span className="flex items-center gap-1.5">
              <span className="text-[10px]">{collapsed.documents ? "▸" : "▾"}</span>
              <span>📁 Documents</span>
            </span>
            <span className="text-[10px] font-mono text-text-muted">{filtered.length}</span>
          </button>

          {!collapsed.documents && (
            <div className="pl-3 mt-1 space-y-1 border-l border-[#2B3036]/60 ml-2">
              {/* Specifications Sub-branch */}
              <div>
                <button
                  onClick={() => toggleSection("specifications")}
                  className="w-full flex items-center justify-between px-2 py-0.5 text-text-muted hover:text-text-primary rounded text-left text-[11px]"
                >
                  <span className="flex items-center gap-1">
                    <span className="text-[9px]">{collapsed.specifications ? "▸" : "▾"}</span>
                    <span>Specifications</span>
                  </span>
                  <span className="text-[10px] font-mono">{groups.specs.length}</span>
                </button>
                {!collapsed.specifications && (
                  <div className="pl-2 space-y-0.5">
                    {groups.specs.length === 0 ? (
                      <div className="text-[11px] text-text-muted px-2 py-1 italic">No specs uploaded</div>
                    ) : (
                      groups.specs.map((doc) => (
                        <FileRow
                          key={doc.document_id}
                          file={doc}
                          isActive={doc.document_id === activeDocId}
                          onSelect={onSelectDocument}
                          onOpenViewer={onOpenViewer}
                          onAskAbout={onAskAbout}
                          onDelete={onDeleteDocument}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Vendor Submittals Sub-branch */}
              <div>
                <button
                  onClick={() => toggleSection("submittals")}
                  className="w-full flex items-center justify-between px-2 py-0.5 text-text-muted hover:text-text-primary rounded text-left text-[11px]"
                >
                  <span className="flex items-center gap-1">
                    <span className="text-[9px]">{collapsed.submittals ? "▸" : "▾"}</span>
                    <span>Vendor Submittals</span>
                  </span>
                  <span className="text-[10px] font-mono">{groups.submittals.length}</span>
                </button>
                {!collapsed.submittals && (
                  <div className="pl-2 space-y-0.5">
                    {groups.submittals.length === 0 ? (
                      <div className="text-[11px] text-text-muted px-2 py-1 italic">No submittals</div>
                    ) : (
                      groups.submittals.map((doc) => (
                        <FileRow
                          key={doc.document_id}
                          file={doc}
                          isActive={doc.document_id === activeDocId}
                          onSelect={onSelectDocument}
                          onOpenViewer={onOpenViewer}
                          onAskAbout={onAskAbout}
                          onDelete={onDeleteDocument}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Schedules & RFIs */}
              <div>
                <button
                  onClick={() => toggleSection("schedules")}
                  className="w-full flex items-center justify-between px-2 py-0.5 text-text-muted hover:text-text-primary rounded text-left text-[11px]"
                >
                  <span className="flex items-center gap-1">
                    <span className="text-[9px]">{collapsed.schedules ? "▸" : "▾"}</span>
                    <span>Schedules &amp; RFIs</span>
                  </span>
                  <span className="text-[10px] font-mono">{groups.schedules.length}</span>
                </button>
                {!collapsed.schedules && (
                  <div className="pl-2 space-y-0.5">
                    {groups.schedules.length === 0 ? (
                      <div className="text-[11px] text-text-muted px-2 py-1 italic">No schedules</div>
                    ) : (
                      groups.schedules.map((doc) => (
                        <FileRow
                          key={doc.document_id}
                          file={doc}
                          isActive={doc.document_id === activeDocId}
                          onSelect={onSelectDocument}
                          onOpenViewer={onOpenViewer}
                          onAskAbout={onAskAbout}
                          onDelete={onDeleteDocument}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Other Documents */}
              {groups.other.length > 0 && (
                <div>
                  <button
                    onClick={() => toggleSection("otherDocs")}
                    className="w-full flex items-center justify-between px-2 py-0.5 text-text-muted hover:text-text-primary rounded text-left text-[11px]"
                  >
                    <span className="flex items-center gap-1">
                      <span className="text-[9px]">{collapsed.otherDocs ? "▸" : "▾"}</span>
                      <span>Other Files</span>
                    </span>
                    <span className="text-[10px] font-mono">{groups.other.length}</span>
                  </button>
                  {!collapsed.otherDocs && (
                    <div className="pl-2 space-y-0.5">
                      {groups.other.map((doc) => (
                        <FileRow
                          key={doc.document_id}
                          file={doc}
                          isActive={doc.document_id === activeDocId}
                          onSelect={onSelectDocument}
                          onOpenViewer={onOpenViewer}
                          onAskAbout={onAskAbout}
                          onDelete={onDeleteDocument}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── MY NOTES (Local Drafts) ── */}
        <div>
          <button
            onClick={() => toggleSection("notes")}
            className="w-full flex items-center justify-between px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-[#22262B] rounded text-left font-medium"
          >
            <span className="flex items-center gap-1.5">
              <span className="text-[10px]">{collapsed.notes ? "▸" : "▾"}</span>
              <span>📝 My Notes</span>
            </span>
            <span className="text-[10px] font-mono text-text-muted">{drafts.length}</span>
          </button>
          {!collapsed.notes && (
            <div className="pl-3 mt-1 space-y-1 border-l border-[#2B3036]/60 ml-2">
              {drafts.length === 0 ? (
                <div className="text-[11px] text-text-muted px-2 py-1 italic">
                  <span>No local notes yet.</span>
                </div>
              ) : (
                drafts.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => onSelectDraft && onSelectDraft(d)}
                    className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-xs select-none transition-colors ${
                      d.id === activeDraftId
                        ? "bg-[#22262B] text-text-primary border-l-2 border-[#38BDF8]"
                        : "text-text-secondary hover:bg-[#1E2227] hover:text-text-primary"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-[10px] font-mono text-[#FBBF24]">MD</span>
                      <span className="truncate">{d.title}</span>
                    </div>
                    <span
                      className={`text-[9px] font-mono px-1 rounded uppercase ${
                        d.status === "ingested"
                          ? "bg-[#4ADE80]/10 text-[#4ADE80]"
                          : "bg-[#22262B] text-text-muted"
                      }`}
                    >
                      {d.status === "ingested" ? "✓ Ingested" : "Draft"}
                    </span>
                  </div>
                ))
              )}
              {onNewNoteClick && (
                <button
                  onClick={onNewNoteClick}
                  className="w-full text-left px-2 py-1 text-[11px] text-[#38BDF8] hover:bg-[#22262B] rounded flex items-center gap-1 transition-colors"
                >
                  <span>+</span>
                  <span>Create note</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── COMPLIANCE AUDITS ── */}
        <div>
          <button
            onClick={() => toggleSection("compliance")}
            className="w-full flex items-center justify-between px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-[#22262B] rounded text-left font-medium"
          >
            <span className="flex items-center gap-1.5">
              <span className="text-[10px]">{collapsed.compliance ? "▸" : "▾"}</span>
              <span>⚖️ Compliance Audits</span>
            </span>
          </button>
          {!collapsed.compliance && (
            <div className="pl-4 py-1.5 space-y-1 border-l border-[#2B3036]/60 ml-2 text-[11px]">
              <div className="flex items-center justify-between text-text-muted pr-2">
                <span>Recent Audit Run</span>
                <span className="text-[#FBBF24] font-mono">1 Discrepancy</span>
              </div>
            </div>
          )}
        </div>

        {/* ── CORRESPONDENCE ── */}
        <div>
          <button
            onClick={() => toggleSection("correspondence")}
            className="w-full flex items-center justify-between px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-[#22262B] rounded text-left font-medium"
          >
            <span className="flex items-center gap-1.5">
              <span className="text-[10px]">{collapsed.correspondence ? "▸" : "▾"}</span>
              <span>✉️ Correspondence</span>
            </span>
          </button>
          {!collapsed.correspondence && (
            <div className="pl-4 py-1.5 text-[11px] text-text-muted border-l border-[#2B3036]/60 ml-2">
              <span>Site memos &amp; IMAP sync ready</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

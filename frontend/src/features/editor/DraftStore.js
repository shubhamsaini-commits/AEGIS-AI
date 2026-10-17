/**
 * AEGIS AI Local Draft Store
 * Autonomous Engineering Governance and Intelligence System
 *
 * Implements browser-local persistence for engineering notes and technical drafts.
 * Features:
 * - Local to browser profile
 * - Automatic dirty / unsaved changes detection
 * - State tracking: 'draft' | 'unsaved' | 'ingesting' | 'ingested' | 'failed'
 * - Post-ingestion edit divergence detection
 * - Export to .md / .txt
 */

const STORAGE_KEY = "aegis_ai_drafts_v1";

const listeners = new Set();

function notifyListeners() {
  const drafts = getDrafts();
  listeners.forEach((listener) => {
    try {
      listener(drafts);
    } catch (e) {
      console.error("DraftStore listener error:", e);
    }
  });
}

export function subscribeDrafts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDrafts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to read drafts from local storage:", err);
    return [];
  }
}

export function getDraft(id) {
  const drafts = getDrafts();
  return drafts.find((d) => d.id === id) || null;
}

export function sanitizeFilename(filename, defaultExt = ".md") {
  let cleaned = filename.trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!cleaned.endsWith(".md") && !cleaned.endsWith(".txt")) {
    cleaned += defaultExt;
  }
  return cleaned;
}

export function createDraft({
  title = "Untitled.md",
  content = "# Engineering Notes\n\n## Observations\n- Inspection findings:\n",
  format = "markdown",
} = {}) {
  const drafts = getDrafts();
  const id = `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const sanitized = sanitizeFilename(title, format === "text" ? ".txt" : ".md");

  const newDraft = {
    id,
    title: sanitized,
    content,
    format: sanitized.endsWith(".txt") ? "text" : "markdown",
    status: "draft", // 'draft' | 'unsaved' | 'ingesting' | 'ingested' | 'failed'
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastIngestedAt: null,
    indexedContentHash: null,
    backendDocId: null,
    chunkCount: null,
  };

  const updated = [newDraft, ...drafts];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  notifyListeners();
  return newDraft;
}

export function saveDraft(draft) {
  const drafts = getDrafts();
  const idx = drafts.findIndex((d) => d.id === draft.id);

  // Check if content diverges from indexed version
  let status = draft.status || "draft";
  if (draft.indexedContentHash && draft.content !== draft.indexedContentHash) {
    status = "draft"; // edited after ingestion -> requires re-ingestion
  }

  const updatedDraft = {
    ...draft,
    title: sanitizeFilename(draft.title, draft.format === "text" ? ".txt" : ".md"),
    status,
    updatedAt: new Date().toISOString(),
  };

  let nextDrafts;
  if (idx !== -1) {
    nextDrafts = [...drafts];
    nextDrafts[idx] = updatedDraft;
  } else {
    nextDrafts = [updatedDraft, ...drafts];
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextDrafts));
  notifyListeners();
  return updatedDraft;
}

export function updateDraftStatus(id, { status, backendDocId, chunkCount, error } = {}) {
  const drafts = getDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) return null;

  const current = drafts[idx];
  const updated = {
    ...current,
    status: status || current.status,
    backendDocId: backendDocId !== undefined ? backendDocId : current.backendDocId,
    chunkCount: chunkCount !== undefined ? chunkCount : current.chunkCount,
    lastIngestedAt: status === "ingested" ? new Date().toISOString() : current.lastIngestedAt,
    indexedContentHash: status === "ingested" ? current.content : current.indexedContentHash,
    ingestionError: error || null,
  };

  drafts[idx] = updated;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  notifyListeners();
  return updated;
}

export function deleteDraft(id) {
  const drafts = getDrafts();
  const filtered = drafts.filter((d) => d.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  notifyListeners();
  return true;
}

export function exportDraft(draft) {
  if (!draft) return;
  const mimeType = draft.format === "text" ? "text/plain;charset=utf-8" : "text/markdown;charset=utf-8";
  const blob = new Blob([draft.content || ""], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = draft.title || "document.md";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

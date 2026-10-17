from vector_store import search, get_document_chunks
from llm_api_provider import ask_ai
from sentence_transformers import CrossEncoder

_reranker = None

def _get_reranker():
    global _reranker
    if _reranker is None:
        _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
    return _reranker
MAX_DISTANCE = 1.5
MAX_FULL_DOC_CHARS = 30000  # safety cap — agar ek document itna bada hai, top-K pe fallback karo


def ask_with_rag(
    question: str, 
    n_results: int = 3, 
    filter_document_type: str = None,
    document_id: str = None, 
    document_ids: list = None, 
    provider: str = "qwen",
    return_sources: bool = True,
):
    if document_ids:
        combined = []
        used_sources = []
        per_doc_budget = MAX_FULL_DOC_CHARS // max(len(document_ids), 1)
        for i, doc_id in enumerate(document_ids):
            chunks = get_document_chunks(doc_id)
            if not chunks:
                continue
            text = "\n\n".join(c["text"] for c in chunks)[:per_doc_budget]
            fname = chunks[0]["metadata"]["filename"]
            doc_type = chunks[0]["metadata"].get("document_type", "Document")
            doc_anchor = chunks[0]["metadata"].get("doc_anchor")
            combined.append(f"[Source {i+1}: {fname}]\n{text}")
            used_sources.append({
                "filename": fname,
                "document_type": doc_type,
                "doc_anchor": doc_anchor,
                "chunk_type": "full_document",
                "text": text[:1000],
                "distance": 0.0,
            })
        context = "\n\n".join(combined)
        prompt = f"""You are an AI assistant. Answer using the context below — it contains content of each document listed.
Cite which source(s) you used by exact number (e.g. [Source 1]). Never cite a source that does not mention the facts you state.

CONTEXT:
{context}

QUESTION: {question}

ANSWER (cite exact sources like [Source 1]):"""
        answer = ask_ai(prompt, provider=provider)
        return (answer, used_sources) if return_sources else answer

    if document_id:
        chunks = get_document_chunks(document_id)
        combined_text = "\n\n".join(c["text"] for c in chunks)

        if chunks and len(combined_text) <= MAX_FULL_DOC_CHARS:
            filename = chunks[0]["metadata"]["filename"]
            doc_type = chunks[0]["metadata"].get("document_type", "Document")
            doc_anchor = chunks[0]["metadata"].get("doc_anchor")
            context = f"[Source 1: {filename}]\n{combined_text}"
            prompt = f"""You are an AI assistant analyzing project documentation. Answer the question using ONLY the context below.
Cite [Source 1] if the information is present. If the answer isn't in the context, say so clearly.

CONTEXT:
{context}

QUESTION: {question}

ANSWER:"""
            answer = ask_ai(prompt, provider=provider)
            used_sources = [{
                "filename": filename,
                "document_type": doc_type,
                "doc_anchor": doc_anchor,
                "chunk_type": "full_document",
                "text": combined_text[:1000],
                "distance": 0.0,
            }]
            return (answer, used_sources) if return_sources else answer

    # Normal path: Hybrid BM25 + Two-stage summary routing search
    relevant_chunks = search(question, n_results=n_results, filter_document_type=filter_document_type)
    
    context_blocks = []
    for i, c in enumerate(relevant_chunks):
        meta = c.get("metadata", {})
        doc_anchor = meta.get("doc_anchor")
        doc_type = meta.get("document_type", "Document")
        filename = meta.get("filename", "Unknown")
        is_summary = c.get("is_summary") or meta.get("chunk_type") == "summary"

        if is_summary:
            header = f"SUMMARY OVERVIEW: {doc_anchor or filename}"
        elif doc_anchor:
            header = f"{doc_anchor} [{doc_type}] — {filename}"
        else:
            header = f"{doc_type} — {filename}"

        context_blocks.append(
            f"[Source {i+1}: {header}]\n{c['text']}"
        )
    context = "\n\n".join(context_blocks)

    prompt = f"""You are an AI assistant analyzing project documentation and records. Answer the question using ONLY the context below.

CRITICAL CITATION RULES:
1. Reference ONLY the exact [Source N] that contains the specific facts, metrics, or numbers you mention.
2. NEVER cite a source number that does not explicitly mention the fact.
3. If only one source contains the fact, cite ONLY that single source (e.g. [Source 1]).
4. If the answer cannot be found in the provided sources, state that clearly.

CONTEXT:
{context}

QUESTION: {question}

ANSWER (cite exact source like [Source 1]):"""

    answer = ask_ai(prompt, provider=provider)

    used_sources = [
        {
            "filename": c.get("metadata", {}).get("filename", "Unknown"),
            "document_type": c.get("metadata", {}).get("document_type", "Document"),
            "doc_anchor": c.get("metadata", {}).get("doc_anchor"),
            "chunk_type": c.get("metadata", {}).get("chunk_type", "content"),
            "source_url": c.get("metadata", {}).get("source_url") or c.get("metadata", {}).get("url") or "",
            "text": c.get("text", ""),
            "distance": c.get("distance", 0.0),
        }
        for c in relevant_chunks
    ]

    return (answer, used_sources) if return_sources else answer
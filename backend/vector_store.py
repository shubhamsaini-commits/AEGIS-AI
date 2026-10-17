import json
import math
import os
import re
import uuid
import requests
import chromadb
from llm_api_provider import embed_text, embed_text_batch

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_PATH = os.getenv("CHROMA_PATH", os.path.join(BASE_DIR, "chroma_db"))
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
SUMMARY_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")

os.makedirs(CHROMA_PATH, exist_ok=True)
_chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)


def get_collection():
    """
    Returns the active ChromaDB collection, automatically recovering
    if the collection was cleared, recreated, or client reconnected.
    """
    global _chroma_client
    try:
        return _chroma_client.get_or_create_collection(name="epc_documents")
    except Exception:
        _chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
        return _chroma_client.get_or_create_collection(name="epc_documents")


class _CollectionProxy:
    """
    Dynamic proxy for ChromaDB collection that prevents stale collection UUID errors
    (e.g. NotFoundError after clearing/recreating the collection while a server runs).
    """
    def __getattr__(self, name):
        col = get_collection()
        return getattr(col, name)


_collection = _CollectionProxy()


def generate_doc_summary_and_anchor(first_chunks: list[str], filename: str) -> dict:
    """
    Takes the first 4-5 chunks of a document and generates via LLM:
    1. doc_anchor: A 5-8 word identity label stating primary entity/person name & document type.
    2. summary: A dense 60-80 word summary stored as a dedicated (N+1)th summary chunk.
    Includes built-in fallback for offline/model timeout scenarios.
    """
    combined_intro = "\n---\n".join(first_chunks[:5])[:3500]

    prompt = f"""You are a document indexing engine. Read the opening chunks of the file '{filename}' below.
Return ONLY valid JSON with two keys:
1. "doc_anchor": A 5 to 8 word identifier stating the primary person/entity/topic name and document type (e.g., "Shubham Saini - B.Tech CSE Resume", "Devlympic 2026 - Hackathon Award Announcement").
2. "summary": A dense 60-80 word summary covering the person/entity's full name, role, institution, key skills/specifications, and document purpose.

Opening Chunks:
{combined_intro}"""

    try:
        resp = requests.post(
            OLLAMA_URL,
            json={
                "model": SUMMARY_MODEL,
                "prompt": prompt,
                "format": "json",
                "stream": False,
                "options": {"temperature": 0.1, "num_ctx": 4096}
            },
            timeout=20
        )
        resp.raise_for_status()
        raw_resp = resp.json().get("response", "{}")
        data = json.loads(raw_resp)

        doc_anchor = data.get("doc_anchor", "").strip() or f"Document: {filename}"
        summary = data.get("summary", "").strip() or combined_intro[:400].strip()
        return {"doc_anchor": doc_anchor, "summary": summary}
    except Exception as e:
        print(f"[Fallback] Summary generation error for '{filename}': {e}")
        # Deterministic fallback from filename and intro text
        cleaned_first_line = combined_intro.split("\n")[0].strip()[:60]
        fallback_anchor = cleaned_first_line if len(cleaned_first_line) > 5 else f"Document: {filename}"
        return {
            "doc_anchor": fallback_anchor,
            "summary": f"Document Overview ({filename}): " + combined_intro[:400].strip()
        }


def add_chunks(chunks: list[dict]):
    """
    Ingests N content chunks + 1 Dedicated Summary Chunk into ChromaDB:
    - Generates doc_anchor and dense summary from opening chunks.
    - Attaches tiny [doc_anchor] header (~30 bytes) to each content chunk so embeddings
      and downstream LLM know the exact owner without bloating context.
    - Appends the (N+1)th Dedicated Summary Chunk (chunk_type="summary").
    - Embeds and persists into ChromaDB.
    """
    if not chunks:
        return

    # Group by document_id in case multiple docs are in the batch
    docs_map = {}
    for c in chunks:
        doc_id = c.get("document_id") or c.get("doc_id") or str(uuid.uuid4())
        if doc_id not in docs_map:
            docs_map[doc_id] = []
        docs_map[doc_id].append(c)

    for doc_id, doc_chunks in docs_map.items():
        has_summary = any(c.get("chunk_type") == "summary" for c in doc_chunks)
        filename = doc_chunks[0].get("filename", "unknown")
        stored_filename = doc_chunks[0].get("stored_filename", "")
        filetype = doc_chunks[0].get("filetype", "")
        doc_type = doc_chunks[0].get("doc_type", "unstructured")
        document_type = doc_chunks[0].get("document_type", "Unknown")

        if not has_summary:
            first_chunk_texts = [c["text"] for c in doc_chunks[:5]]
            meta_info = generate_doc_summary_and_anchor(first_chunk_texts, filename)
            doc_anchor = meta_info["doc_anchor"]
            summary_text = meta_info["summary"]
        else:
            doc_anchor = doc_chunks[0].get("doc_anchor") or f"Document: {filename}"
            summary_text = None

        texts_to_store = []
        metadatas_to_store = []
        ids_to_store = []

        # 1. Prepare N normal content chunks with [doc_anchor] context
        for idx, c in enumerate(doc_chunks):
            if c.get("chunk_type") == "summary":
                continue
            raw_text = c["text"]
            if not raw_text.startswith(f"[{doc_anchor}]"):
                contextualized_text = f"[{doc_anchor}]\n{raw_text}"
            else:
                contextualized_text = raw_text

            source_url = c.get("source_url") or c.get("url") or doc_chunks[0].get("source_url") or doc_chunks[0].get("url") or ""

            texts_to_store.append(contextualized_text)
            metadatas_to_store.append({
                "doc_id": doc_id,
                "document_id": doc_id,
                "filename": filename,
                "stored_filename": stored_filename,
                "filetype": filetype,
                "doc_type": doc_type,
                "document_type": document_type,
                "doc_anchor": doc_anchor,
                "chunk_index": idx,
                "chunk_type": "content",
                "source_url": source_url,
            })
            chunk_id = c.get("chunk_id") or f"{doc_id}_{idx}"
            ids_to_store.append(chunk_id)

        # 2. Append the (N+1)th Dedicated Summary Chunk (ONLY ONCE per document)
        if not has_summary and summary_text:
            summary_formatted = f"[DOCUMENT SUMMARY | {doc_anchor}]\n{summary_text}"
            texts_to_store.append(summary_formatted)
            metadatas_to_store.append({
                "doc_id": doc_id,
                "document_id": doc_id,
                "filename": filename,
                "stored_filename": stored_filename,
                "filetype": filetype,
                "doc_type": doc_type,
                "document_type": document_type,
                "doc_anchor": doc_anchor,
                "chunk_index": len(texts_to_store) - 1,
                "chunk_type": "summary",
                "source_url": source_url,
            })
            ids_to_store.append(f"{doc_id}_summary")

        # 3. Batch embed & store all N+1 chunks in ChromaDB
        embeddings = embed_text_batch(texts_to_store)
        _collection.add(
            ids=ids_to_store,
            documents=texts_to_store,
            metadatas=metadatas_to_store,
            embeddings=embeddings,
        )
        print(f"[ok] Ingested {len(texts_to_store)} chunks ({len(texts_to_store)-1} content + 1 summary) for '{doc_anchor}'")


_STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", 
    "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", 
    "by", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from", 
    "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him", 
    "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", 
    "me", "more", "most", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", 
    "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "she", 
    "should", "so", "some", "such", "than", "that", "the", "their", "theirs", "them", 
    "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too", 
    "under", "until", "up", "very", "was", "we", "were", "what", "when", "where", "which", 
    "while", "who", "whom", "why", "with", "would", "you", "your", "yours", "yourself", 
    "yourselves", "tell", "give", "show", "get", "find"
}


def _tokenize(text: str) -> list[str]:
    return [w.lower() for w in re.findall(r'\b[a-zA-Z0-9_\-\.]{2,}\b', text) if w.lower() not in _STOPWORDS]


class BM25Okapi:
    """
    Lightweight, dependency-free BM25Okapi ranking implementation.
    Prioritizes chunks with exact matches on critical discriminative keywords
    (like CGPA, acronyms, specific metrics, project names).
    """
    def __init__(self, corpus: list[list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.corpus = corpus
        self.doc_len = [len(d) for d in corpus]
        self.avgdl = sum(self.doc_len) / max(len(self.doc_len), 1)
        self.N = len(corpus)
        self.df = {}
        for d in corpus:
            for term in set(d):
                self.df[term] = self.df.get(term, 0) + 1
        self.idf = {}
        for term, freq in self.df.items():
            self.idf[term] = math.log((self.N - freq + 0.5) / (freq + 0.5) + 1.0)

    def get_scores(self, query_tokens: list[str]) -> list[float]:
        scores = []
        for i, doc in enumerate(self.corpus):
            score = 0.0
            doc_len = self.doc_len[i]
            tf = {}
            for t in doc:
                tf[t] = tf.get(t, 0) + 1
            for q in query_tokens:
                if q in tf:
                    f = tf[q]
                    idf = self.idf.get(q, 0.0)
                    tf_norm = (f * (self.k1 + 1)) / (f + self.k1 * (1 - self.b + self.b * (doc_len / self.avgdl)))
                    score += idf * tf_norm
            scores.append(score)
        return scores


def search_with_summary_routing(
    query: str,
    top_k: int = 3,
    filter_document_type: str = None,
    max_distance: float = 1.5,
) -> list[dict]:
    """
    Two-Stage Summary Routing + BM25 Hybrid Retrieval:
    - Stage 1: Query Dedicated Summary Chunks (chunk_type="summary") to identify
      WHICH document/entity the user's question is targeting.
    - Stage 2: Pull candidate Content Chunks scoped to matched document(s) (or global fallback).
    - Stage 3: Score candidates using BM25Okapi + Dense Semantic Similarity.
    - Filters out unstated/irrelevant chunks so only genuinely relevant chunks are returned.
    """
    query_embedding = embed_text(query)
    q_tokens = _tokenize(query)
    matched_doc_ids = []

    # ── Stage 1: Check Dedicated Summary Chunks first for routing ─────────────
    summary_filter = {"chunk_type": "summary"}
    if filter_document_type:
        summary_filter = {
            "$and": [
                {"chunk_type": "summary"},
                {"document_type": filter_document_type}
            ]
        }

    try:
        summary_hits = _collection.query(
            query_embeddings=[query_embedding],
            n_results=3,
            where=summary_filter
        )
        if summary_hits and summary_hits.get("ids") and summary_hits["ids"][0]:
            best_dist = summary_hits["distances"][0][0]
            for i, hit_id in enumerate(summary_hits["ids"][0]):
                dist = summary_hits["distances"][0][i] if "distances" in summary_hits else 0.0
                # Strict routing: only include documents within tight margin of top match
                if dist <= 0.85 and dist <= (best_dist + 0.10):
                    meta = summary_hits["metadatas"][0][i]
                    doc_id = meta.get("document_id") or meta.get("doc_id")
                    if doc_id and doc_id not in matched_doc_ids:
                        matched_doc_ids.append(doc_id)
    except Exception as e:
        print(f"[Summary Routing] Stage 1 note: {e}")

    # ── Stage 2: Pull candidate Content Chunks from matched document(s) ───────
    scoped_where = None
    if matched_doc_ids:
        if len(matched_doc_ids) == 1:
            doc_filter = {"document_id": matched_doc_ids[0]}
        else:
            doc_filter = {"document_id": {"$in": matched_doc_ids}}
        scoped_where = doc_filter
        if filter_document_type:
            scoped_where = {
                "$and": [
                    {"document_type": filter_document_type},
                    doc_filter
                ]
            }
    elif filter_document_type:
        scoped_where = {"document_type": filter_document_type}

    candidates = []
    seen_ids = set()

    try:
        hits = _collection.query(
            query_embeddings=[query_embedding],
            n_results=max(top_k * 4, 12),
            where=scoped_where
        )
        if hits and hits.get("ids") and hits["ids"][0]:
            for i, hit_id in enumerate(hits["ids"][0]):
                dist = hits["distances"][0][i] if "distances" in hits else 0.0
                if hit_id not in seen_ids and dist <= max_distance:
                    seen_ids.add(hit_id)
                    meta = hits["metadatas"][0][i]
                    candidates.append({
                        "chunk_id": hit_id,
                        "text": hits["documents"][0][i],
                        "metadata": meta,
                        "distance": dist,
                        "is_summary": meta.get("chunk_type") == "summary",
                    })
    except Exception as e:
        print(f"[Summary Routing] Stage 2 note: {e}")

    # ── Fallback if no candidate chunks found ──────────────────────────────────
    if not candidates and scoped_where:
        try:
            fallback_hits = _collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k * 2,
            )
            if fallback_hits and fallback_hits.get("ids") and fallback_hits["ids"][0]:
                for i, hit_id in enumerate(fallback_hits["ids"][0]):
                    dist = fallback_hits["distances"][0][i] if "distances" in fallback_hits else 0.0
                    if hit_id not in seen_ids and dist <= max_distance:
                        seen_ids.add(hit_id)
                        meta = fallback_hits["metadatas"][0][i]
                        candidates.append({
                            "chunk_id": hit_id,
                            "text": fallback_hits["documents"][0][i],
                            "metadata": meta,
                            "distance": dist,
                            "is_summary": meta.get("chunk_type") == "summary",
                        })
        except Exception as e:
            print(f"[Summary Routing] Fallback note: {e}")

    if not candidates:
        return []

    # ── Stage 3: BM25 + Dense Hybrid Scoring & Pruning ────────────────────────
    corpus_tokens = [_tokenize(c["text"]) for c in candidates]
    bm25 = BM25Okapi(corpus_tokens)
    bm25_scores = bm25.get_scores(q_tokens) if q_tokens else [0.0] * len(candidates)
    max_bm = max(bm25_scores) if bm25_scores and max(bm25_scores) > 0 else 1.0

    # Check if query is explicitly asking for high-level summary/overview
    is_summary_query = any(w in query.lower() for w in ["summary", "summarize", "overview", "who is", "tell me about", "brief"])

    for i, c in enumerate(candidates):
        dense_sim = 1.0 / (1.0 + c["distance"])
        bm_norm = bm25_scores[i] / max_bm if max_bm > 0 else 0.0

        # Penalize summary chunks for specific factual queries so granular data chunks take precedence
        summary_penalty = 0.25 if (c["is_summary"] and not is_summary_query and bm_norm < 0.5) else 0.0

        c["hybrid_score"] = (0.45 * dense_sim + 0.55 * bm_norm) - summary_penalty
        c["bm25_score"] = bm25_scores[i]

    candidates.sort(key=lambda x: x["hybrid_score"], reverse=True)

    # Prune irrelevant chunks: Drop any chunk scoring less than 60% of top chunk
    top_score = candidates[0]["hybrid_score"]
    filtered_results = [
        c for c in candidates 
        if c["hybrid_score"] >= (top_score * 0.60)
    ][:top_k]

    return filtered_results


def search(query: str, n_results: int = 3, filter_document_type: str = None):
    """
    Search entry point: Uses Two-Stage Summary Routing + BM25 Hybrid Retrieval.
    Returns only high-relevance chunks (top 1-3).
    """
    return search_with_summary_routing(
        query=query,
        top_k=n_results,
        filter_document_type=filter_document_type,
        max_distance=1.5
    )


def list_documents():
    """
    Groups all stored chunks by document_id (NOT filename — two
    uploads can share a filename but never a document_id).
    """
    all_data = _collection.get(include=["metadatas"])

    grouped = {}
    for metadata in all_data["metadatas"]:
        doc_id = metadata["document_id"]
        if doc_id not in grouped:
            grouped[doc_id] = {
                "document_id": doc_id,
                "filename": metadata["filename"],
                "stored_filename": metadata.get("stored_filename"),
                "document_type": metadata["document_type"],
                "filetype": metadata.get("filetype", ""),
                "doc_anchor": metadata.get("doc_anchor"),
                "source_url": metadata.get("source_url") or metadata.get("url") or "",
                "chunk_count": 0,
            }
        else:
            if not grouped[doc_id].get("source_url"):
                grouped[doc_id]["source_url"] = metadata.get("source_url") or metadata.get("url") or ""
        grouped[doc_id]["chunk_count"] += 1

    return list(grouped.values())


def get_stats():
    documents = list_documents()
    total_documents = len(documents)
    total_chunks = sum(doc["chunk_count"] for doc in documents)

    return {
        "total_documents": total_documents,
        "total_chunks": total_chunks,
    }


def delete_document(document_id: str):
    """
    Removes all chunks belonging to a specific upload (by document_id,
    not filename) from ChromaDB.
    """
    _collection.delete(where={"document_id": document_id})


def get_document_chunks(document_id: str):
    """
    Returns ALL chunks of one specific document (no semantic search) —
    used when the user has explicitly selected a single document to
    ask about, so nothing gets missed.
    Safely orders by chunk_index.
    """
    data = _collection.get(
        where={"document_id": document_id},
        include=["documents", "metadatas"],
    )

    items = list(zip(data["ids"], data["documents"], data["metadatas"]))
    # Safely sort using chunk_index metadata to avoid ValueError with _summary ID
    items.sort(key=lambda x: x[2].get("chunk_index", 9999))

    return [{"text": text, "metadata": meta} for _, text, meta in items]


def backfill_summary_chunks():
    """
    Checks all existing documents in ChromaDB and generates summary chunks + doc_anchors
    for any documents that were ingested before this feature was enabled.
    """
    docs = list_documents()
    for doc in docs:
        doc_id = doc["document_id"]
        data = _collection.get(
            where={"document_id": doc_id},
            include=["documents", "metadatas"]
        )
        if not data or not data["ids"]:
            continue

        has_summary = any(m.get("chunk_type") == "summary" for m in data["metadatas"])
        if has_summary:
            continue

        print(f"[backfill] Backfilling summary chunk and doc_anchor for '{doc['filename']}'...")
        chunk_texts = data["documents"][:5]
        meta_info = generate_doc_summary_and_anchor(chunk_texts, doc["filename"])
        doc_anchor = meta_info["doc_anchor"]
        summary_text = meta_info["summary"]

        # 1. Update existing content chunks metadata and texts with [doc_anchor]
        for i, cid in enumerate(data["ids"]):
            m = data["metadatas"][i]
            m["doc_anchor"] = doc_anchor
            m["chunk_type"] = "content"
            m["chunk_index"] = i
            m["doc_id"] = doc_id
            
            raw_text = data["documents"][i]
            if not raw_text.startswith(f"[{doc_anchor}]"):
                new_text = f"[{doc_anchor}]\n{raw_text}"
            else:
                new_text = raw_text

            # Update in collection
            _collection.update(
                ids=[cid],
                documents=[new_text],
                metadatas=[m],
                embeddings=[embed_text(new_text)]
            )

        # 2. Append the dedicated summary chunk
        summary_formatted = f"[DOCUMENT SUMMARY | {doc_anchor}]\n{summary_text}"
        summary_id = f"{doc_id}_summary"
        summary_meta = {
            "doc_id": doc_id,
            "document_id": doc_id,
            "filename": doc["filename"],
            "stored_filename": doc.get("stored_filename", ""),
            "filetype": doc.get("filetype", ""),
            "doc_type": "unstructured",
            "document_type": doc.get("document_type", "Unknown"),
            "doc_anchor": doc_anchor,
            "chunk_index": len(data["ids"]),
            "chunk_type": "summary",
        }
        _collection.add(
            ids=[summary_id],
            documents=[summary_formatted],
            metadatas=[summary_meta],
            embeddings=[embed_text(summary_formatted)]
        )
        print(f"[ok] Backfill complete for '{doc_anchor}'")


# Alias for backwards compatibility / modular imports
ingest_document_chunks = add_chunks

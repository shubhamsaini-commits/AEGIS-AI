import gc
import json
import os
import re
from datetime import datetime

from requests.exceptions import RequestException
from fastapi import HTTPException

from exctractors import extract_file
from llm_api_provider import ask_ai
from vector_store import list_documents, _collection, get_document_chunks

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.getenv("UPLOAD_DIR", os.path.join(BASE_DIR, "uploaded_docs"))
COMPLIANCE_FILE = os.path.join(BASE_DIR, "last_compliance_check.json")
MAX_COMPLIANCE_CHARS = int(os.getenv("MAX_COMPLIANCE_CHARS", 150000))


def _get_document_text_from_chunks(document_id: str) -> str:
    """
    Retrieve and concatenate all content chunks for a document directly from ChromaDB.
    - Preserves exact document order using chunk_index.
    - Excludes the (N+1)th metadata summary chunk so overview text isn't duplicated.
    - Strips repetitive contextual doc_anchor prefixes for clean full-document context.
    """
    chunks = get_document_chunks(document_id)
    if not chunks:
        return ""

    content_parts = []
    for c in chunks:
        meta = c.get("metadata", {})
        if meta.get("chunk_type") == "summary":
            continue

        text = c.get("text", "")
        doc_anchor = meta.get("doc_anchor")
        if doc_anchor and text.startswith(f"[{doc_anchor}]\n"):
            text = text[len(f"[{doc_anchor}]\n"):]

        if text.strip():
            content_parts.append(text.strip())

    return "\n\n".join(content_parts)


def _clean_audit_query(query: str) -> str:
    """Strips conversational framing words so vector search targets key domain keywords."""
    stopwords = {"compare", "comparison", "check", "doc", "document", "documents", "against", "versus", "vs", "between", "wikipedia", "file", "verify", "audit"}
    words = [w for w in query.split() if w.lower().strip(".,:;!?\"'") not in stopwords]
    return " ".join(words) if words else query


def _get_document_scoped_text(document_id: str, query: str, top_k: int = 5) -> str:
    """
    Per-Document Scoped Search for targeted compliance audits:
    - Queries ChromaDB specifically for this document_id.
    - Applies BM25 + dense ranking to pull the most relevant chunks matching the audit focus.
    - Preserves chronological document order (chunk_index) so tables and narrative flow naturally.
    - Guarantees 0% starvation between multi-hundred-page documents.
    """
    all_chunks = get_document_chunks(document_id)
    content_chunks = [c for c in all_chunks if c.get("metadata", {}).get("chunk_type") != "summary"]

    if not content_chunks:
        return ""

    if len(content_chunks) <= top_k:
        cleaned = []
        for c in content_chunks:
            txt = c.get("text", "")
            doc_anchor = c.get("metadata", {}).get("doc_anchor")
            if doc_anchor and txt.startswith(f"[{doc_anchor}]\n"):
                txt = txt[len(f"[{doc_anchor}]\n"):]
            if txt.strip():
                cleaned.append(txt.strip())
        return "\n\n".join(cleaned)

    # Scoped search in ChromaDB for this document_id
    from vector_store import embed_text, _tokenize, BM25Okapi

    cleaned_q = _clean_audit_query(query)
    query_emb = embed_text(cleaned_q)
    q_tokens = _tokenize(cleaned_q)

    try:
        candidate_count = min(len(content_chunks), max(top_k * 4, 25))
        scoped_hits = _collection.query(
            query_embeddings=[query_emb],
            n_results=candidate_count,
            where={"document_id": document_id}
        )
    except Exception as e:
        print(f"[Compliance Scoped Search] Chroma error: {e}")
        scoped_hits = None

    matched_chunks = []
    if scoped_hits and scoped_hits.get("ids") and scoped_hits["ids"][0]:
        for i, hit_id in enumerate(scoped_hits["ids"][0]):
            meta = scoped_hits["metadatas"][0][i]
            if meta.get("chunk_type") == "summary":
                continue
            dist = scoped_hits["distances"][0][i] if "distances" in scoped_hits else 0.0
            matched_chunks.append({
                "chunk_id": hit_id,
                "text": scoped_hits["documents"][0][i],
                "metadata": meta,
                "distance": dist,
                "chunk_index": meta.get("chunk_index", 0)
            })

    if not matched_chunks:
        matched_chunks = [
            {
                "chunk_id": f"{document_id}_{i}",
                "text": c["text"],
                "metadata": c.get("metadata", {}),
                "distance": 0.5,
                "chunk_index": c.get("metadata", {}).get("chunk_index", i)
            }
            for i, c in enumerate(content_chunks[:top_k])
        ]

    # BM25 scoring on candidates
    corpus_tokens = [_tokenize(c["text"]) for c in matched_chunks]
    bm25 = BM25Okapi(corpus_tokens)
    bm_scores = bm25.get_scores(q_tokens) if q_tokens else [0.0] * len(matched_chunks)
    max_bm = max(bm_scores) if bm_scores and max(bm_scores) > 0 else 1.0

    for i, c in enumerate(matched_chunks):
        dense_sim = 1.0 / (1.0 + c.get("distance", 0.0))
        bm_norm = bm_scores[i] / max_bm if max_bm > 0 else 0.0
        c["score"] = 0.45 * dense_sim + 0.55 * bm_norm

    matched_chunks.sort(key=lambda x: x["score"], reverse=True)
    top_matched = matched_chunks[:top_k]

    # Sort back by chunk_index to preserve natural reading order
    top_matched.sort(key=lambda x: x.get("chunk_index", 0))

    cleaned = []
    for c in top_matched:
        txt = c["text"]
        doc_anchor = c.get("metadata", {}).get("doc_anchor")
        if doc_anchor and txt.startswith(f"[{doc_anchor}]\n"):
            txt = txt[len(f"[{doc_anchor}]\n"):]
        if txt.strip():
            cleaned.append(txt.strip())

    return "\n\n".join(cleaned)


def run_compliance_check(document_ids: list[str], audit_prompt: str = None):
    if not document_ids or len(document_ids) < 2:
        raise HTTPException(
            status_code=400,
            detail="Select at least 2 documents to compare (e.g. a Specification and a Vendor Submittal)."
        )

    all_docs = {d["document_id"]: d for d in list_documents()}

    sections = []
    total_chars = 0
    has_audit_prompt = bool(audit_prompt and audit_prompt.strip())

    for doc_id in document_ids:
        if doc_id not in all_docs:
            raise HTTPException(status_code=404, detail="One of the selected documents was not found.")

        doc = all_docs[doc_id]

        if has_audit_prompt:
            # Per-Document Scoped Search directed by user prompt (top_k=5 for fast local inference)
            text = _get_document_scoped_text(doc_id, audit_prompt.strip(), top_k=5)
        else:
            # Full text directly from ChromaDB chunks
            text = _get_document_text_from_chunks(doc_id)

        # Fallback to disk extraction if chunks are unexpectedly absent
        if not text and doc.get("stored_filename"):
            file_path = os.path.join(UPLOAD_DIR, doc["stored_filename"])
            if os.path.exists(file_path):
                extracted = extract_file(file_path)
                text = extracted.get("text")
                if text is None:
                    text = "\n".join(
                        ", ".join(f"{k}: {v}" for k, v in row.items())
                        for row in extracted.get("records", [])
                    )

        if not text or not text.strip():
            raise HTTPException(
                status_code=404, 
                detail=f"Document '{doc['filename']}' has no content in the knowledge base."
            )

        total_chars += len(text)
        sections.append(f"=== {doc['document_type'].upper()} — {doc['filename']} ===\n{text}")

    if total_chars > MAX_COMPLIANCE_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Selected documents are too large to compare in one go "
                f"({total_chars:,} characters, limit is {MAX_COMPLIANCE_CHARS:,}). "
                "Specify an Audit Scope/Custom Prompt to focus the comparison, or select fewer documents."
            )
        )

    combined_docs = "\n\n".join(sections)

    selected_docs = [all_docs[doc_id] for doc_id in document_ids]
    doc1 = selected_docs[0]
    doc2 = selected_docs[1]
    doc1_name = doc1["filename"]
    doc2_name = doc2["filename"]
    doc1_type = doc1.get("document_type", "Document")
    doc2_type = doc2.get("document_type", "Document")

    is_all_emails = all(d.get("document_type") == "Email" for d in selected_docs)
    has_email = any(d.get("document_type") == "Email" for d in selected_docs)

    def is_spec(d):
        t = (d.get("document_type") or "").lower()
        n = (d.get("filename") or "").lower()
        return "spec" in t or "specification" in t or "spec" in n

    def is_submittal(d):
        t = (d.get("document_type") or "").lower()
        n = (d.get("filename") or "").lower()
        return "submittal" in t or "vendor" in t or "submittal" in n

    is_spec_submittal = (is_spec(doc1) and is_submittal(doc2)) or (is_spec(doc2) and is_submittal(doc1))
    if is_spec(doc2) and is_submittal(doc1):
        doc1, doc2 = doc2, doc1
        doc1_name, doc2_name = doc1["filename"], doc2["filename"]
        doc1_type, doc2_type = doc1.get("document_type", "Specification"), doc2.get("document_type", "Vendor Submittal")

    if has_audit_prompt:
        prompt = f"""{combined_docs}

You are an expert technical compliance auditor and cross-document verification analyst.
AUDIT SCOPE: "{audit_prompt.strip()}"

Document 1: "{doc1_name}" ({doc1_type})
Document 2: "{doc2_name}" ({doc2_type})

INSTRUCTIONS:
1. Examine both documents above to identify 5 to 7 key items, substances, chemicals, parameters, requirements, or packaging claims relevant to the AUDIT SCOPE.
2. For each identified item, cross-compare Document 1 against Document 2:
   - If a substance/parameter violates safety standards, is banned, contradicts packaging claims, or differs: status is "Discrepancy" (or "Deviation") with severity "Critical" or "Moderate".
   - If both documents agree or comply: status is "Match", severity is null.
   - If mentioned in only one document and absent in the other: status is "Cannot verify", severity is null.

Respond with ONLY a JSON array, no conversational text, no explanations, no code fences.
Format:
[
  {{
    "requirement": "Specific item or claim name",
    "doc1_name": "{doc1_name}",
    "doc1_value": "Statement or status from {doc1_name}, or 'Not stated'",
    "doc2_name": "{doc2_name}",
    "doc2_value": "Statement or dosage from {doc2_name}, or 'Not stated'",
    "specified_value": "Statement from {doc1_name}, or 'Not stated'",
    "submitted_value": "Statement from {doc2_name}, or 'Not stated'",
    "status": "Match", "Deviation", "Discrepancy", or "Cannot verify",
    "severity": "Critical", "Moderate", "Low", or null
  }}
]
"""
    elif is_spec_submittal:
        prompt = f"""{combined_docs}

You are a technical compliance auditor. Carefully read ALL documents above.
Specification: "{doc1_name}"
Vendor Submittal: "{doc2_name}"

Identify every technical requirement, parameter, specification, or claim that appears in ANY of the documents.
Then cross-compare those parameters between the Specification and the Vendor Submittal:
- If a value appears in the Specification, check whether the Submittal meets it.
- If both state a value and they match, status is "Match".
- If the vendor submittal deviates from the specification, status is "Deviation".
- If a parameter is missing in either document, status is "Cannot verify".

Respond with ONLY a JSON array, no markdown formatting, no explanation, no code fences. Each item must have exactly these fields:
- "requirement": short name of the technical requirement
- "doc1_name": "{doc1_name}"
- "doc1_value": value from the Specification, or "Not stated" if absent
- "doc2_name": "{doc2_name}"
- "doc2_value": value from the Vendor Submittal, or "Not stated" if absent
- "specified_value": value from the Specification, or "Not stated" if absent
- "submitted_value": value from the Vendor Submittal, or "Not stated" if absent
- "status": exactly one of "Match", "Deviation", or "Cannot verify"
- "severity": "Critical", "Moderate", or "Low" if status is "Deviation", otherwise null

IMPORTANT: If either value is "Not stated", status MUST be "Cannot verify" — never "Match".
Example format:
[{{"requirement": "Battery Autonomy", "doc1_name": "{doc1_name}", "doc1_value": "15 minutes", "doc2_name": "{doc2_name}", "doc2_value": "10 minutes", "specified_value": "15 minutes", "submitted_value": "10 minutes", "status": "Deviation", "severity": "Critical"}}]
"""
    else:
        # Email or general document cross-comparison
        prompt = f"""{combined_docs}

You are comparing information, claims, and figures across the documents above.
Document 1: "{doc1_name}" ({doc1_type})
Document 2: "{doc2_name}" ({doc2_type})

Carefully read ALL documents above. Identify every factual data point, statement, prize, date, amount, position, claim, or condition that appears in ANY of the documents.
Cross-compare these data points between Document 1 ("{doc1_name}") and Document 2 ("{doc2_name}"):
- If both documents state a value for the same data point and they agree, status is "Match".
- If both documents state differing or conflicting values for the same data point, status is "Discrepancy".
- If a value appears in only one document and is missing from the other, status is "Cannot verify".

Respond with ONLY a JSON array, no markdown formatting, no explanation, no code fences. Each item must have exactly these fields:
- "requirement": short name of the data point or topic being compared (e.g. "Prize Money", "Winning Position")
- "doc1_name": "{doc1_name}"
- "doc1_value": value or statement from "{doc1_name}", or "Not stated" if absent
- "doc2_name": "{doc2_name}"
- "doc2_value": value or statement from "{doc2_name}", or "Not stated" if absent
- "status": exactly one of "Match", "Discrepancy", or "Cannot verify"
- "severity": "Critical", "Moderate", or "Low" if status is "Discrepancy", otherwise null

IMPORTANT: If either value is "Not stated", status MUST be "Cannot verify" — never "Match".
Example format:
[{{"requirement": "Prize Money", "doc1_name": "{doc1_name}", "doc1_value": "30000 rupess", "doc2_name": "{doc2_name}", "doc2_value": "60000 rupess", "status": "Discrepancy", "severity": "Moderate"}}]
"""

    print(f"[Compliance Audit] Running audit for '{doc1_name}' vs '{doc2_name}' (context: {len(prompt)} chars)...")
    t_start = datetime.now()
    try:
        raw_response = ask_ai(prompt)
    except RequestException:
        raise HTTPException(
            status_code=503,
            detail="AI model is currently unreachable — check if local Ollama or the API tunnel is running."
        )

    duration = (datetime.now() - t_start).total_seconds()
    print(f"[Compliance Audit] LLM responded in {duration:.2f}s.")

    def parse_json_safely(raw_text: str):
        cleaned = raw_text.strip()
        fence_match = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", cleaned, re.DOTALL)
        if fence_match:
            cleaned = fence_match.group(1).strip()
        
        start_idx = cleaned.find("[")
        if start_idx == -1:
            return []
        cleaned = cleaned[start_idx:]
        
        end_idx = cleaned.rfind("]")
        if end_idx != -1 and end_idx > 0:
            candidate = cleaned[:end_idx + 1]
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                pass
                
        # Backtracking recovery for truncated responses: find last valid closing object brace
        last_brace = cleaned.rfind("}")
        while last_brace != -1:
            candidate = cleaned[:last_brace + 1] + "\n]"
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                last_brace = cleaned.rfind("}", 0, last_brace)
                
        return []

    raw_results = parse_json_safely(raw_response)
    print(f"[Compliance Audit] Extracted {len(raw_results)} raw audit items from LLM response.")

    comparison_type = "email" if (is_all_emails or has_email) else ("specification" if is_spec_submittal else "comparison")

    normalized = []
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        req = item.get("requirement") or "Comparison Point"
        v1 = item.get("doc1_value") if item.get("doc1_value") is not None else item.get("specified_value", "Not stated")
        v2 = item.get("doc2_value") if item.get("doc2_value") is not None else item.get("submitted_value", "Not stated")

        raw_status = item.get("status", "Cannot verify")
        if not is_spec_submittal and raw_status == "Deviation":
            raw_status = "Discrepancy"

        sev = item.get("severity")
        if raw_status in ("Deviation", "Discrepancy", "Conflict") and not sev:
            sev = "Moderate"

        normalized.append({
            "requirement": req,
            "doc1_name": doc1_name,
            "doc1_type": doc1_type,
            "doc1_value": str(v1),
            "doc1_url": doc1.get("source_url") or doc1.get("url") or "",
            "doc2_name": doc2_name,
            "doc2_type": doc2_type,
            "doc2_value": str(v2),
            "doc2_url": doc2.get("source_url") or doc2.get("url") or "",
            "specified_value": str(v1),
            "submitted_value": str(v2),
            "status": raw_status,
            "severity": sev,
            "comparison_type": comparison_type,
        })

    print(f"[Compliance Audit] Returning {len(normalized)} normalized compliance findings.")
    return normalized


def save_compliance_results(results):
    data = {
        "results": results,
        "ran_at": datetime.now().isoformat(),
    }
    with open(COMPLIANCE_FILE, "w") as f:
        json.dump(data, f, indent=2)
    return data


def load_compliance_results():
    if not os.path.exists(COMPLIANCE_FILE):
        return {"results": [], "ran_at": None}
    with open(COMPLIANCE_FILE, "r") as f:
        return json.load(f)
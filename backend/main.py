import re
import difflib
from datetime import datetime, timezone
from fastapi.responses import FileResponse
import requests
from llm_api_provider import QWEN_API_URL, ask_vision, ask_ai
from fastapi import UploadFile, File, Form
import subprocess
import sys
import json
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from rag import ask_with_rag
from compilance import run_compliance_check
from vector_store import add_chunks
from vector_store import search
from vector_store import _collection
from vector_store import list_documents, delete_document, get_document_chunks
from vector_store import get_stats
from chunker import chunk_document
from exctractors import extract_file
from email_ingest import sync_emails, ingest_email, list_emails, get_email_status
import uuid
import os
import shutil
from compilance import save_compliance_results, load_compliance_results
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

EMAIL_POLL_INTERVAL = int(os.getenv("EMAIL_POLL_INTERVAL_MINUTES", "5")) * 60


async def _email_poll_loop():
    logger.info("Email poller started (interval=%ds)", EMAIL_POLL_INTERVAL)
    await asyncio.sleep(5)  # Let server complete startup before polling
    while True:
        try:
            result = await asyncio.to_thread(sync_emails)
            if result.get("fetched", 0) > 0:
                logger.info("Email sync: fetched %d new email(s)", result["fetched"])
            if result.get("errors"):
                logger.warning("Email sync errors: %s", result["errors"])
        except Exception:
            logger.exception("Unhandled error in email poll loop")
        await asyncio.sleep(EMAIL_POLL_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    poll_task = asyncio.create_task(_email_poll_loop())
    try:
        yield
    finally:
        poll_task.cancel()
        try:
            await poll_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="EPC Intelligence API", lifespan=lifespan)


FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = "default-src 'self'"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


@app.get("/")
def root():
    return {"status": "ok"}


class AskRequest(BaseModel):
    question: str
    document_type: str | None = None
    document_id: str | None = None
    provider: str = "qwen"


@app.post("/ask")
def ask(req: AskRequest):
    answer, sources = ask_with_rag(
        req.question,
        filter_document_type=req.document_type,
        document_id=req.document_id,
        provider=req.provider,
        return_sources=True,
    )
    return {"answer": answer, "sources": sources}


# ── Agentic document routing (natural-language switch/delete) ───────────────
# Pure code-based (regex + fuzzy match) — NO extra AI call, so it's fast and
# doesn't burn extra model credit/GPU time on every single message.

FILENAME_PATTERN = re.compile(r'[\w\-]+\.\w{2,5}')
DELETE_KEYWORDS = ("delete", "remove", "hata", "hatao", "hatado", "erase")


def extract_filename_candidates(text: str) -> list[str]:
    return FILENAME_PATTERN.findall(text)


def is_delete_intent(text: str) -> bool:
    lowered = text.lower()
    return any(kw in lowered for kw in DELETE_KEYWORDS)


def match_documents(candidates: list[str]) -> list[dict]:
    """
    Fuzzy-matches whatever filename-like text the user typed (even with
    typos) against the REAL document list — never trusts raw user input
    directly, only uses it to find the closest actual match.
    """
    all_docs = list_documents()
    all_filenames = [d["filename"] for d in all_docs]

    matched = []
    matched_ids = set()
    for cand in candidates:
        close = difflib.get_close_matches(cand, all_filenames, n=1, cutoff=0.55)
        if close:
            doc = next(d for d in all_docs if d["filename"] == close[0])
            if doc["document_id"] not in matched_ids:
                matched.append(doc)
                matched_ids.add(doc["document_id"])
    return matched


class AgentRequest(BaseModel):
    message: str
    provider: str = "qwen"


@app.post("/agent/ask")
def agent_ask(req: AgentRequest):
    candidates = extract_filename_candidates(req.message)
    matched = match_documents(candidates) if candidates else []

    if is_delete_intent(req.message) and matched:
        # Destructive — NEVER auto-execute, just report what was understood
        return {
            "type": "confirm_delete",
            "matched_documents": [
                {"document_id": d["document_id"], "filename": d["filename"]} for d in matched
            ],
        }

    # Not a delete — treat as a question. If exactly one document was
    # mentioned by name, auto-switch to it (full content, non-destructive).
    document_ids = [d["document_id"] for d in matched] if matched else None
    answer, sources = ask_with_rag(
        req.message, 
        document_ids=document_ids, 
        provider=req.provider,
        return_sources=True,
    )

    return {
        "type": "answer",
        "answer": answer,
        "sources": sources,
        "auto_selected_document": matched[0]["filename"] if document_ids else None,
    }


class DeleteConfirmedRequest(BaseModel):
    document_ids: list[str]


@app.post("/agent/delete-confirmed")
def agent_delete_confirmed(req: DeleteConfirmedRequest):
    """
    Only called AFTER the user has explicitly confirmed — reuses the exact
    same delete logic (ChromaDB + disk) as the manual Remove button.
    """
    docs = list_documents()
    deleted = []
    for doc_id in req.document_ids:
        match = next((d for d in docs if d["document_id"] == doc_id), None)
        delete_document(doc_id)
        if match and match.get("stored_filename"):
            file_path = os.path.join(UPLOAD_DIR, match["stored_filename"])
            if os.path.exists(file_path):
                os.remove(file_path)
        if match:
            deleted.append(match["filename"])
    log_action("agent_delete", {"document_ids": req.document_ids, "deleted": deleted})
    return {"status": "success", "deleted": deleted}


# ── Vision (image chat) ───────────────────────────────────────────────────

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_IMAGE_SIZE = 15 * 1024 * 1024  # 15 MB
VISION_SYSTEM_INSTRUCTION = (
    "You are looking at an image the user has attached to their question. "
    "Describe what you actually see in the image — objects, animals, people, "
    "scenes, colors, text, or anything relevant — and answer the user's "
    "question based on the image content. Do not assume the image contains "
    "extracted document text unless it clearly does (e.g. a scanned page, "
    "screenshot, or form)."
)


@app.post("/ask-image")
def ask_image(
    question: str = Form(...),
    document_type: str | None = Form(None),
    image: UploadFile = File(...),
):
    original_filename = os.path.basename(image.filename)
    file_ext = os.path.splitext(original_filename)[1].lower()

    if file_ext not in ALLOWED_IMAGE_EXTENSIONS:
        return {"status": "error", "message": f"Image type '{file_ext}' not allowed."}

    content = image.file.read()
    if len(content) > MAX_IMAGE_SIZE:
        return {"status": "error", "message": "Image too large. Max size is 15 MB"}

    temp_id = uuid.uuid4().hex
    temp_path = os.path.join(UPLOAD_DIR, f"chatimg_{temp_id}_{original_filename}")
    with open(temp_path, "wb") as f:
        f.write(content)

    sandbox_env = {
        "PATH": os.environ.get("PATH", ""),
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
        "TEMP": os.environ.get("TEMP", ""),
        "TMP": os.environ.get("TMP", ""),
    }

    try:
        result = subprocess.run(
            [sys.executable, "sandbox_check.py", temp_path],
            capture_output=True,
            text=True,
            timeout=180,
            env=sandbox_env,
            cwd=BASE_DIR,
        )
    except subprocess.TimeoutExpired:
        os.remove(temp_path)
        return {"status": "error", "message": "Image took too long to process and was rejected for safety."}

    if result.returncode != 0 or not result.stdout.strip():
        print("SANDBOX STDERR:", result.stderr)
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return {"status": "error", "message": "Image processing crashed and was rejected for safety."}

    try:
        sandbox_result = json.loads(result.stdout.strip().splitlines()[-1])
    except json.JSONDecodeError:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return {"status": "error", "message": "Unexpected sandbox output — image rejected for safety."}

    if sandbox_result["status"] != "ok":
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return {"status": "error", "message": sandbox_result.get("reason", "Image rejected by security check.")}

    try:
        answer = ask_vision(question, temp_path, system_instruction=VISION_SYSTEM_INSTRUCTION)
    except Exception as e:
        return {"status": "error", "message": f"Vision model error: {e}"}
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    return {"answer": answer}


@app.get("/documents")
def get_documents():
    return {"documents": list_documents()}

@app.get("/documents/{document_id}/content")
def get_document_content(document_id: str):
    chunks = get_document_chunks(document_id)
    if not chunks:
        return {"status": "error", "message": "Document not found"}
    return {"text": "\n\n".join(c["text"] for c in chunks)}
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

UPLOAD_DIR = os.getenv(
    "UPLOAD_DIR",
    os.path.join(BASE_DIR, "uploaded_docs")
)

os.makedirs(UPLOAD_DIR, exist_ok=True)
@app.get("/documents/{document_id}/file")
def get_document_file(document_id: str):
    docs = list_documents()
    match = next((d for d in docs if d["document_id"] == document_id), None)
    if not match or not match.get("stored_filename"):
        return {"status": "error", "message": "File not found"}
    file_path = os.path.join(UPLOAD_DIR, match["stored_filename"])
    if not os.path.exists(file_path):
        return {"status": "error", "message": "File missing on disk"}
    return FileResponse(
        file_path,
        headers={"Content-Disposition": f'inline; filename="{match["filename"]}"'},
    )

AUDIT_LOG_PATH = os.path.join(BASE_DIR, "audit_log.jsonl")

def log_action(action: str, details: dict):
    entry = {"time": datetime.now(timezone.utc).isoformat(), "action": action, "details": details}
    with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".xls", ".csv", ".txt", ".md", ".jpg", ".jpeg", ".png",".zip"}
MAX_FILE_SIZE = 50 * 1024 * 1024


@app.post("/upload")
def upload_document(file: UploadFile = File(...)):
    original_filename = os.path.basename(file.filename)
    file_ext = os.path.splitext(original_filename)[1].lower()

    if file_ext not in ALLOWED_EXTENSIONS:
        return {"status": "error", "message": f"File type '{file_ext}' not allowed."}

    content = file.file.read()
    if len(content) > MAX_FILE_SIZE:
        return {"status": "error", "message": "File too large. Max size is 50 MB"}

    document_id = uuid.uuid4().hex
    stored_filename = f"{document_id}_{original_filename}"
    save_path = os.path.join(UPLOAD_DIR, stored_filename)

    with open(save_path, "wb") as f:
        f.write(content)

    sandbox_env = {
        "PATH": os.environ.get("PATH", ""),
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
        "TEMP": os.environ.get("TEMP", ""),
        "TMP": os.environ.get("TMP", ""),
    }

    try:
        result = subprocess.run(
            [sys.executable, "sandbox_check.py", save_path],
            capture_output=True,
            text=True,
            timeout=180,
            env=sandbox_env,
            cwd=BASE_DIR,
        )
    except subprocess.TimeoutExpired:
        os.remove(save_path)
        return {"status": "error", "message": "File took too long to process and was rejected for safety."}

    if result.returncode != 0 or not result.stdout.strip():
        print("SANDBOX STDERR:", result.stderr)
        os.remove(save_path)
        return {"status": "error", "message": "File processing crashed and was rejected for safety."}

    try:
        sandbox_result = json.loads(result.stdout.strip().splitlines()[-1])
    except json.JSONDecodeError:
        os.remove(save_path)
        return {"status": "error", "message": "Unexpected sandbox output — file rejected for safety."}

    if sandbox_result["status"] != "ok":
        os.remove(save_path)
        return {"status": "error", "message": sandbox_result.get("reason", "File rejected by security check.")}

    extracted = sandbox_result["data"]
    extracted["filename"] = original_filename

    chunks = chunk_document(extracted, document_id=document_id, stored_filename=stored_filename)

    if not chunks:
        return {"status": "error", "message": "No content could be extracted from this file."}

    add_chunks(chunks)

    log_action("upload", {"document_id": document_id, "filename": original_filename, "chunks": len(chunks)})
    return {
        "filename": original_filename,
        "document_id": document_id,
        "document_type": chunks[0]["document_type"],
        "chunks_added": len(chunks),
        "status": "success",
    }


@app.delete("/documents/{document_id}")
def remove_document(document_id: str):
    docs = list_documents()
    match = next((d for d in docs if d["document_id"] == document_id), None)

    delete_document(document_id)

    if match and match.get("stored_filename"):
        file_path = os.path.join(UPLOAD_DIR, match["stored_filename"])
        if os.path.exists(file_path):
            os.remove(file_path)
    log_action("delete", {"document_id": document_id, "filename": match["filename"] if match else None})
    return {"status": "success", "message": "Document removed"}


class ComplianceRequest(BaseModel):
    document_ids: list[str]
    audit_prompt: str | None = None


@app.post("/compliance-check")
def compliance_check(req: ComplianceRequest):
    results = run_compliance_check(req.document_ids, audit_prompt=req.audit_prompt)
    data = save_compliance_results(results)
    return data


class UrlIngestRequest(BaseModel):
    url: str
    custom_title: str | None = None
    scrape_goal: str | None = None


@app.post("/api/ingest-url")
def tinyfish_smart_ingest(req: UrlIngestRequest):
    """
    Bridges external government portals / web notices into private ChromaDB vault.
    Uses TinyFish API (agent/fetch) with high-speed markdown fallback.
    """
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required.")

    extracted_text = ""
    engine_used = "Standard HTML-to-Markdown"
    page_title = req.custom_title

    # 1. Try TinyFish if API key is present or SDK is configured
    tf_api_key = os.getenv("TINYFISH_API_KEY")
    if tf_api_key:
        try:
            from tinyfish import TinyFish
            tf_client = TinyFish(api_key=tf_api_key)

            if req.scrape_goal and req.scrape_goal.strip():
                engine_used = "TinyFish Autonomous Web Agent"
                agent_res = tf_client.agent.run(
                    url=url,
                    goal=req.scrape_goal.strip()
                )
                extracted_text = json.dumps(agent_res.result, indent=2) if getattr(agent_res, "result", None) else str(agent_res)
            else:
                engine_used = "TinyFish Fetch (Markdown Engine)"
                fetch_res = tf_client.fetch.get_contents(
                    urls=[url],
                    format="markdown",
                    per_url_timeout_ms=30000
                )
                if fetch_res.results and len(fetch_res.results) > 0:
                    page = fetch_res.results[0]
                    extracted_text = getattr(page, "text", "") or str(page)
                    if not page_title:
                        page_title = getattr(page, "title", None)
        except Exception as e:
            logger.warning(f"[TinyFish Error] {e}. Falling back to basic request.")

    # 2. Resilient fallback if TinyFish key is unset or error occurred
    if not extracted_text.strip():
        try:
            import html2text
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            resp = requests.get(url, headers=headers, timeout=20)
            resp.raise_for_status()

            m_title = re.search(r'<title[^>]*>(.*?)</title>', resp.text, re.IGNORECASE | re.DOTALL)
            if m_title and not page_title:
                page_title = m_title.group(1).strip()

            h = html2text.HTML2Text()
            h.ignore_links = False
            h.ignore_images = True
            extracted_text = h.handle(resp.text)
            engine_used = "Built-in HTML-to-Markdown Parser"
        except Exception as e:
            logger.error(f"[URL Fetch Error] {e}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch content from URL: {str(e)}")

    if not extracted_text.strip():
        raise HTTPException(status_code=400, detail="Extracted webpage content is empty.")

    if not page_title:
        clean_slug = re.sub(r'https?://(www\.)?', '', url).split('/')[0]
        page_title = f"{clean_slug} Notice"

    clean_filename = f"GOVT_NOTICE: {page_title[:45]}" if ("gov" in url or "fssai" in url or "aicte" in url or "ugc" in url) else page_title[:50]
    doc_id = str(uuid.uuid4())

    # Chunk the markdown text into ~1000 character segments
    chunk_size, overlap = 1000, 150
    chunks_to_ingest = []
    for i in range(0, len(extracted_text), chunk_size - overlap):
        sub = extracted_text[i : i + chunk_size].strip()
        if len(sub) > 30:
            chunks_to_ingest.append({
                "text": sub,
                "filename": clean_filename,
                "document_type": "Government Notice" if "GOVT_NOTICE" in clean_filename else "Web Notice",
                "doc_id": doc_id,
                "document_id": doc_id,
                "source_url": url,
                "filetype": "web",
            })

    if not chunks_to_ingest:
        raise HTTPException(status_code=400, detail="Content was too short to create document chunks.")

    # Ingest into ChromaDB using N+1 Hierarchical Summary pipeline
    add_chunks(chunks_to_ingest)

    return {
        "status": "success",
        "engine_used": engine_used,
        "filename": clean_filename,
        "document_id": doc_id,
        "source_url": url,
        "chunks_added": len(chunks_to_ingest) + 1
    }


@app.get("/compliance-check")
def get_last_compliance_check():
    return load_compliance_results()


@app.get("/stats")
def stats():
    doc_data = get_stats()
    compliance_data = load_compliance_results()
    deviations = sum(1 for r in compliance_data.get("results", []) if r.get("status") in ("Deviation", "Discrepancy", "Conflict", "Mismatch"))
    return {
        "total_documents": doc_data["total_documents"],
        "total_chunks": doc_data["total_chunks"],
        "deviations_found": deviations,
    }

@app.get("/audit-log")
def get_audit_log(limit: int = 50):
    if not os.path.exists(AUDIT_LOG_PATH):
        return {"logs": []}
    with open(AUDIT_LOG_PATH, "r", encoding="utf-8") as f:
        lines = f.readlines()[-limit:]
    return {"logs": [json.loads(l) for l in lines]}

@app.get("/emails")
def get_emails():
    return {"emails": list_emails()}


@app.post("/email/sync")
def email_sync():
    result = sync_emails()
    return result


@app.post("/email/ingest/{uid}")
def email_ingest(uid: str):
    result = ingest_email(uid)
    return result


@app.get("/email/status")
def email_status():
    return get_email_status()
<div align="center">

# 🛡️ AEGIS AI
### Engineering Intelligence & Sovereign Compliance Verification Engine

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&size=20&pause=1000&color=10B981&center=true&vCenter=true&width=650&lines=Automated+Cross-Document+Verification;External+Govt+%26+Regulatory+Web+Bridge;Air-Gapped+Sovereign+RAG+on+Local+Hardware;Zero-Hallucination+Engineering+Audits)](https://git.io/typing-svg)

<p align="center">
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/React_18-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/ChromaDB-FF6600?style=for-the-badge&logo=databricks&logoColor=white" alt="ChromaDB" />
  <img src="https://img.shields.io/badge/Ollama_Qwen2.5-000000?style=for-the-badge&logo=ollama&logoColor=white" alt="Ollama" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind" />
</p>

---

</div>

## ⚡ What is AEGIS AI?

**AEGIS AI** is a sovereign document intelligence platform engineered for mission-critical compliance audits, air-gapped technical document Q&A, and real-time verification across engineering specs, government regulatory notices, supplier formulations, and corporate correspondence.

---

## ✨ Key Features

<table>
  <tr>
    <td width="50%">
      <h3>⚖️ Automated Compliance Audit</h3>
      <ul>
        <li>Cross-compares complex multi-page files (specifications vs. vendor submittals, or food formulations vs. ban notices).</li>
        <li>Highlights <b>Matches</b>, <b>Deviations</b>, and <b>Critical Discrepancies</b> with granular evidence values.</li>
        <li><b>Audit Scope Steering:</b> Direct the audit focus with custom prompts (e.g. <i>"Flag any banned additives or misleading claims"</i>).</li>
      </ul>
    </td>
    <td width="50%">
      <h3>🌐 Live Regulatory & Web Bridge</h3>
      <ul>
        <li>Ingest live government notices, FSSAI advisories, or Wikipedia pages directly into your local vector vault.</li>
        <li>Every ingested web chunk links directly to its <b>live original source URL (↗)</b> for instant 1-click provenance.</li>
        <li>Zero data starvation between large web notices and local PDFs.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>💬 Air-Gapped Grounded RAG</h3>
      <ul>
        <li><b>Hybrid Search:</b> Dense semantic embeddings combined with <code>BM25Okapi</code> keyword matching.</li>
        <li>Two-stage summary routing retrieves high-accuracy answers in seconds without context pollution.</li>
        <li>Verifiable citation chips with expandable grounded snippets.</li>
      </ul>
    </td>
    <td width="50%">
      <h3>👁️ Multimodal & Email Stream</h3>
      <ul>
        <li><b>Visual Chat:</b> Upload P&IDs, engineering schematics, receipts, or scanned PDFs for vision-guided analysis.</li>
        <li><b>Email IMAP Ingest:</b> Synchronize live Gmail/IMAP mailboxes to audit email commitments against final contract docs.</li>
      </ul>
    </td>
  </tr>
</table>

---

## 🐟 TinyFish Web Intelligence Integration

AEGIS AI uses **TinyFish** as an optional web-ingestion engine for bringing
external government notices, regulatory pages, and other web resources into
the private document knowledge base. This gives the platform a bridge to
live web content without making the rest of the RAG pipeline dependent on a
cloud service.

### How it works

1. A user pastes a URL in the frontend's **Bridge External Govt / Regulatory
   URL** flow. The frontend sends the URL to the FastAPI
   `POST /api/ingest-url` endpoint through `frontend/src/api/client.js`.
2. The backend checks for `TINYFISH_API_KEY` and initializes the TinyFish
   Python client when the key is configured.
3. TinyFish uses one of two extraction modes:
   - **Autonomous Web Agent** — selected when the request includes a
     `scrape_goal`; TinyFish navigates the page and returns the result for a
     specific goal.
   - **Fetch / Markdown** — used for normal URL ingestion; TinyFish converts
     the page into Markdown while retaining readable page content and title
     metadata.
4. The extracted content is split into overlapping chunks, tagged with the
   original `source_url`, and added to the same ChromaDB collection as
   uploaded documents.
5. The resulting web notice can therefore be retrieved by grounded RAG and
   used in compliance comparisons, with a link back to the live source.

The integration is deliberately resilient. If the TinyFish key is missing,
the SDK is unavailable, or a TinyFish request fails, the backend falls back
to its built-in HTML-to-Markdown parser using `requests` and `html2text`.
This keeps URL ingestion usable in local or air-gapped development
environments, while TinyFish provides stronger handling for pages that need
agent-style navigation or targeted extraction.

### Configuration

TinyFish is optional. To enable it, install the TinyFish Python SDK in the
backend environment and add the API key to `backend/.env`:

```env
TINYFISH_API_KEY=your_tinyfish_api_key
```

The endpoint accepts the following JSON request:

```json
{
  "url": "https://example.gov/notice",
  "custom_title": "Optional title",
  "scrape_goal": "Optional goal for targeted extraction"
}
```

The response reports the selected engine, generated document ID, source URL,
and number of chunks added. TinyFish never replaces the local indexing and
retrieval layers; it only supplies web content to the existing ingestion
pipeline.

---

## 🚀 Quick Setup Guide

### 1. Prerequisites
- **Python 3.11+**
- **Node.js 18+** & `npm`
- **[Ollama](https://ollama.com/)** running locally

```bash
# Pull the recommended local LLM model
ollama run qwen2.5:3b
```

---

### 2. Backend Setup

```bash
# Navigate to the backend directory
cd backend

# Create & activate a virtual environment
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the FastAPI engine
uvicorn main:app --reload --port 8000
```
> The API will be live at `http://localhost:8000` (interactive docs at `/docs`).

---

### 3. Frontend Setup

```bash
# In a new terminal, navigate to the frontend directory
cd frontend

# Install client packages
npm install

# Start the Vite development server
npm run dev
```
> Open `http://localhost:5173` in your browser to launch the AEGIS AI console.

---

## ⚙️ Environment Variables (Optional)

Create or edit `backend/.env` if you wish to configure live email polling or cloud fallback:

```env
# Optional: Set to Colab / Ngrok URL to offload inference
# QWEN_API_URL=https://your-ngrok-tunnel.ngrok-free.app

# Optional: Gemini API Key for hybrid cloud mode
# GEMINI_API_KEY=your_key_here

# Optional: TinyFish web-ingestion engine
# TINYFISH_API_KEY=your_tinyfish_api_key

# Optional: Gmail / IMAP stream sync
EMAIL_ADDRESS=your_email@gmail.com
EMAIL_APP_PASSWORD=your_app_password
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
EMAIL_POLL_INTERVAL_MINUTES=5
```

---

## 🎯 Verification Walkthrough

1. **Upload Documents:** Go to **Documents** and upload your specification docs (PDF, DOCX, CSV) or paste a government policy URL via **Bridge External Govt / Regulatory URL**.
2. **Run an Audit:** Open **Compliance Check**, select 2+ documents (e.g. *Recipe Dossier* vs *Prohibition Web Notice*), enter an optional audit prompt, and click **Re-run Verification Audit**.
3. **Inspect Evidence:** Click any finding row to view side-by-side extracted evidence, severity ratings, and 1-click links to the original web sources.
4. **Ask Sovereign AI:** Navigate to **Ask Documents** to query your private knowledge base with zero telemetry and 100% grounded citations.

---

<div align="center">

Built with obsession 🔥 • Sovereign AI Engineering

</div>

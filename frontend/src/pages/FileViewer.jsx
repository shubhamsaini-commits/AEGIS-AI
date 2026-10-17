import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { getDocumentFileUrl } from "../services/documentsApi";

export default function FileViewer() {
  const { documentId } = useParams();
  const [content, setContent] = useState(null);
  const [type, setType] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const fileUrl = getDocumentFileUrl(documentId);

    fetch(fileUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load document (${res.status})`);
        return res.blob();
      })
      .then(async (blob) => {
        const ext = blob.type;
        const buffer = await blob.arrayBuffer();

        if (ext.includes("pdf") || ext.includes("image")) {
          setType("native");
          setContent(URL.createObjectURL(blob));
        } else if (ext.includes("sheet") || ext.includes("csv") || ext.includes("excel")) {
          const wb = XLSX.read(buffer, { type: "array" });
          const html = XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]]);
          setType("html");
          setContent(html);
        } else if (ext.includes("word") || ext.includes("document")) {
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
          setType("html");
          setContent(result.value);
        } else if (ext.includes("text") || ext.includes("markdown") || ext.includes("plain")) {
          const decoder = new TextDecoder("utf-8");
          const text = decoder.decode(buffer);
          setType("text");
          setContent(text);
        } else {
          setType("native");
          setContent(URL.createObjectURL(blob));
        }
      })
      .catch((err) => {
        setError(err.message || "Failed to load document content.");
      })
      .finally(() => setLoading(false));
  }, [documentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-xs font-mono text-text-secondary">
        <span className="w-2 h-2 rounded-full bg-[#38BDF8] animate-ping mr-2" />
        Loading document binary stream from enclave...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <span className="text-[#F87171] text-lg mb-2">⚠</span>
        <div className="text-sm font-semibold text-text-primary">Unable to render document</div>
        <div className="text-xs text-text-secondary mt-1">{error}</div>
      </div>
    );
  }

  if (type === "native") {
    return (
      <iframe
        src={content}
        className="w-full h-full border-none bg-white"
        title={`AEGIS Document ${documentId}`}
      />
    );
  }

  if (type === "text") {
    return (
      <div className="p-6 h-full overflow-auto bg-[#111315]">
        <pre className="font-mono text-xs text-text-primary whitespace-pre-wrap leading-relaxed select-text">
          {content}
        </pre>
      </div>
    );
  }

  return (
    <div
      className="p-6 h-full overflow-auto bg-[#191C20] text-text-primary font-sans text-xs select-text prose prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
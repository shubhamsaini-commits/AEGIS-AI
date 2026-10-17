export default function MarkdownPreview({ content = "" }) {
  // Simple, robust client-side markdown formatter with zero external CDN dependency
  const renderFormattedMarkdown = (text) => {
    if (!text.trim()) {
      return (
        <div className="text-text-muted italic py-8 text-center text-xs">
          No content written yet. Switch to Editor View to add engineering notes.
        </div>
      );
    }

    const lines = text.split("\n");
    const elements = [];
    let inCodeBlock = false;
    let codeBuffer = [];
    let tableBuffer = [];

    const flushTable = (key) => {
      if (tableBuffer.length === 0) return null;
      const rows = tableBuffer.map((line) =>
        line
          .split("|")
          .map((c) => c.trim())
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
      );
      tableBuffer = [];
      const headerRow = rows[0] || [];
      const dataRows = rows.slice(1).filter((r) => !r.some((c) => c.includes("---")));

      return (
        <div key={key} className="overflow-x-auto my-3">
          <table className="w-full border-collapse border border-[#2B3036] text-xs">
            <thead className="bg-[#17191C] font-mono text-text-primary">
              <tr>
                {headerRow.map((cell, i) => (
                  <th key={i} className="border border-[#2B3036] p-2 text-left font-semibold">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((r, i) => (
                <tr key={i} className="hover:bg-[#1E2227]">
                  {r.map((c, j) => (
                    <td key={j} className="border border-[#2B3036] p-2 text-text-secondary">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    };

    lines.forEach((line, index) => {
      // Code block start/end
      if (line.trim().startsWith("```")) {
        if (inCodeBlock) {
          elements.push(
            <pre
              key={`code-${index}`}
              className="p-3 my-2.5 rounded bg-[#111315] border border-[#2B3036] font-mono text-[11px] text-[#38BDF8] overflow-x-auto leading-relaxed"
            >
              {codeBuffer.join("\n")}
            </pre>
          );
          codeBuffer = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        return;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        return;
      }

      // Table line
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        tableBuffer.push(line);
        return;
      } else if (tableBuffer.length > 0) {
        elements.push(flushTable(`table-${index}`));
      }

      // Headings
      if (line.startsWith("# ")) {
        elements.push(
          <h1 key={index} className="text-xl font-bold text-text-primary border-b border-[#2B3036] pb-1.5 mt-4 mb-2">
            {line.substring(2)}
          </h1>
        );
      } else if (line.startsWith("## ")) {
        elements.push(
          <h2 key={index} className="text-base font-semibold text-text-primary mt-3.5 mb-1.5">
            {line.substring(3)}
          </h2>
        );
      } else if (line.startsWith("### ")) {
        elements.push(
          <h3 key={index} className="text-sm font-semibold text-[#38BDF8] mt-3 mb-1">
            {line.substring(4)}
          </h3>
        );
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        elements.push(
          <li key={index} className="ml-4 list-disc text-xs text-text-primary my-0.5 leading-relaxed">
            {line.substring(2)}
          </li>
        );
      } else if (line.startsWith("> ")) {
        elements.push(
          <blockquote key={index} className="pl-3 border-l-2 border-[#38BDF8] text-xs text-text-secondary italic my-2">
            {line.substring(2)}
          </blockquote>
        );
      } else if (line.trim()) {
        elements.push(
          <p key={index} className="text-xs text-text-primary my-1.5 leading-relaxed font-sans">
            {line}
          </p>
        );
      } else {
        elements.push(<div key={index} className="h-2" />);
      }
    });

    if (tableBuffer.length > 0) {
      elements.push(flushTable(`table-end`));
    }

    return elements;
  };

  return (
    <div className="p-6 h-full overflow-y-auto bg-[#17191C] max-w-4xl mx-auto select-text font-sans">
      <div className="mb-3 pb-2 border-b border-[#2B3036] flex items-center justify-between text-[11px] font-mono text-text-muted">
        <span>DOCUMENT PREVIEW (Rendered Markdown)</span>
        <span>Local Offline Parser</span>
      </div>
      <div className="space-y-1">{renderFormattedMarkdown(content)}</div>
    </div>
  );
}

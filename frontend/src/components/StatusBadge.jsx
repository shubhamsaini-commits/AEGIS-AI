export default function StatusBadge({
  status = "neutral",
  label,
  size = "sm",
  pulse = false,
  className = "",
}) {
  const norm = String(status).toLowerCase();

  let styles = "bg-[#22262B] text-text-secondary border-[#2B3036]";
  let icon = "•";

  if (norm === "match" || norm === "success" || norm === "ready" || norm === "online" || norm === "consistent") {
    styles = "bg-[#4ADE80]/10 text-[#4ADE80] border-[#4ADE80]/20";
    icon = "✓";
  } else if (norm === "deviation" || norm === "discrepancy" || norm === "conflict" || norm === "mismatch" || norm === "critical" || norm === "fail" || norm === "error") {
    styles = "bg-[#F87171]/10 text-[#F87171] border-[#F87171]/20";
    icon = "✕";
  } else if (norm === "moderate" || norm === "warning" || norm === "cannot verify" || norm === "pending") {
    styles = "bg-[#FBBF24]/10 text-[#FBBF24] border-[#FBBF24]/20";
    icon = "!";
  } else if (norm === "active" || norm === "info" || norm === "indexed") {
    styles = "bg-[#38BDF8]/10 text-[#38BDF8] border-[#38BDF8]/20";
    icon = "ℹ";
  }

  const sizeClasses = size === "xs"
    ? "text-[10px] px-1.5 py-0.5 gap-1"
    : "text-xs px-2 py-0.5 gap-1.5";

  return (
    <span
      className={`inline-flex items-center font-mono font-medium rounded border ${sizeClasses} ${styles} ${className}`}
    >
      <span className={`text-[10px] ${pulse ? "animate-pulse" : ""}`}>{icon}</span>
      <span>{label || status}</span>
    </span>
  );
}

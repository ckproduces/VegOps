"use client";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export default function ResolutionBanner({
  outcome,
  summary,
}: {
  outcome: "resolved" | "abandoned";
  summary?: string;
}) {
  const ok = outcome === "resolved";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 180, damping: 18 }}
      className="my-4 rounded-xl border-2 p-4 flex items-start gap-3"
      style={{
        borderColor: ok ? "#16a34a" : "#dc2626",
        background: ok ? "rgba(22,163,74,0.06)" : "rgba(220,38,38,0.06)",
      }}
    >
      {ok ? (
        <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "#16a34a" }} />
      ) : (
        <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "#dc2626" }} />
      )}
      <div className="min-w-0">
        <div
          className="font-semibold text-sm"
          style={{ color: ok ? "#15803d" : "#b91c1c" }}
        >
          {ok ? "Incident resolved by agents" : "Agents could not resolve the incident"}
        </div>
        {summary && <div className="text-xs muted mt-1 leading-relaxed">{summary}</div>}
      </div>
    </motion.div>
  );
}

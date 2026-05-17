"use client";
import { motion } from "framer-motion";
import { AlertOctagon, CheckCircle2, Loader2, HelpCircle } from "lucide-react";
import type { HealthStatus } from "@/lib/api";

const COLOR: Record<HealthStatus, string> = {
  ok: "#16a34a",
  error: "#dc2626",
  down: "#71717a",
  unreachable: "#dc2626",
  unknown: "#a1a1aa",
};

const LABEL: Record<HealthStatus, string> = {
  ok: "Healthy",
  error: "Error",
  down: "Restarting",
  unreachable: "Unreachable",
  unknown: "-",
};

export default function HealthBadge({ status, message }: { status: HealthStatus; message?: string }) {
  const danger = status === "error" || status === "unreachable";
  const healthy = status === "ok";
  const Icon = status === "ok" ? CheckCircle2 : status === "down" ? Loader2 : status === "unknown" ? HelpCircle : AlertOctagon;
  return (
    <motion.div
      animate={danger ? { x: [0, -1, 1, -1, 0] } : {}}
      transition={danger ? { duration: 0.4, repeat: Infinity, repeatDelay: 2 } : {}}
      className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm"
      style={{
        background: danger ? "rgba(220,38,38,0.06)" : healthy ? "rgba(22,163,74,0.06)" : "#fff",
        border: `${danger ? 2 : 1}px solid ${danger || healthy ? COLOR[status] : "var(--border)"}`,
      }}
      title={message}
    >
      <Icon
        className={`w-3.5 h-3.5 ${status === "down" ? "animate-spin" : ""}`}
        style={{ color: COLOR[status] }}
      />
      <span className="muted">Target:</span>
      <span className="font-semibold" style={{ color: danger || healthy ? COLOR[status] : undefined }}>
        {LABEL[status]}
      </span>
      {danger && message && (
        <span className="hidden md:inline text-xs ml-1 max-w-[260px] truncate" style={{ color: COLOR[status] }}>
          - {message}
        </span>
      )}
    </motion.div>
  );
}

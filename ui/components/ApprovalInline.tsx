"use client";
import { motion } from "framer-motion";
import { Check, X, ShieldAlert, Lock } from "lucide-react";
import { TOOL_LABELS } from "@/lib/api";

interface Props {
  tool: string;
  reason: string;
  decided?: "approved" | "denied" | null;
  onDecide: (approved: boolean) => void;
}

export default function ApprovalInline({ tool, reason, decided, onDecide }: Props) {
  const neutral = "#71717a";
  const border = "#d4d4d8";
  const bg = "#fafafa";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 18 }}
      className="my-4 rounded-xl p-4 mx-auto max-w-xl"
      style={{
        border: `1px solid ${border}`,
        background: bg,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        {decided ? (
          <Lock className="w-4 h-4" style={{ color: neutral }} />
        ) : (
          <motion.span
            animate={{ scale: [1, 1.18, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          >
            <ShieldAlert className="w-4 h-4" style={{ color: neutral }} />
          </motion.span>
        )}
        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: neutral }}
        >
          {decided
            ? decided === "approved" ? "Request sent. Agents are working" : "Request denied. Agents will retry"
            : "Approval required"}
        </span>
      </div>
      <div className="text-sm mb-1">
        <span className="font-semibold">Darwin</span> wants to run{" "}
        <span
          className="font-semibold px-1.5 py-0.5 rounded"
          style={{ background: "rgba(0,0,0,0.05)" }}
        >
          {TOOL_LABELS[tool]}
        </span>
      </div>
      <div className="text-xs muted mb-3 leading-relaxed">{reason || "-"}</div>
      {!decided && (
        <div className="flex gap-2">
          <motion.button
            whileHover={{ y: -1, scale: 1.01 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onDecide(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: "#18181b" }}
          >
            <Check className="w-4 h-4" /> Approve & run
          </motion.button>
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onDecide(false)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg soft-border bg-white hover:bg-soft-hover text-sm font-semibold"
          >
            <X className="w-4 h-4" /> Deny
          </motion.button>
        </div>
      )}
    </motion.div>
  );
}

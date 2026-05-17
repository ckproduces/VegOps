"use client";
import { motion } from "framer-motion";
import { Zap, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { TOOL_LABELS, type ToolCall } from "@/lib/api";

export default function ActionStatusCard({
  tc,
  onClick,
}: {
  tc: ToolCall;
  onClick?: () => void;
}) {
  const executed = tc.status === "executed";
  const running = tc.status === "approved" || tc.status === "executing" || tc.status === "pending_approval";
  const failed = tc.status === "failed";

  const color = failed ? "#dc2626" : "#71717a";
  const border = failed ? "#dc2626" : "#d4d4d8";
  const bg = failed ? "rgba(220,38,38,0.06)" : "#fafafa";
  const executedLabel = tc.tool === "page_devops" ? "DevOps team paged" : "Action completed. Waiting for health check";

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.99 }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 w-full max-w-xl mx-auto rounded-xl p-3 flex items-center gap-3 text-left"
      style={{ border: `1px solid ${border}`, background: bg }}
    >
      <div className="flex-shrink-0">
        {executed ? (
          <CheckCircle2 className="w-5 h-5" style={{ color }} />
        ) : failed ? (
          <XCircle className="w-5 h-5" style={{ color }} />
        ) : running ? (
          <Loader2 className="w-5 h-5 animate-spin" style={{ color }} />
        ) : (
          <Zap className="w-5 h-5" style={{ color }} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>
          {executed
            ? executedLabel
            : failed
            ? "Action failed"
            : tc.status === "executing" ? "Agents are running this action" : "Action queued"}
        </div>
        <div className="text-sm font-semibold">{TOOL_LABELS[tc.tool]}</div>
        {tc.args?.reason && (
          <div className="text-xs muted truncate">{tc.args.reason}</div>
        )}
      </div>
      <div className="text-[10px] muted flex-shrink-0">details</div>
    </motion.button>
  );
}

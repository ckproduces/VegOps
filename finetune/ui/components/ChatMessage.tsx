"use client";
import { motion } from "framer-motion";
import { AlertOctagon } from "lucide-react";
import AgentAvatar, { agentLabel } from "./AgentAvatar";

interface Props {
  role: "user" | "agent" | "system";
  agent?: string | null;
  content: string;
}

export default function ChatMessage({ role, agent, content }: Props) {
  if (role === "system") {
    const isError = /fail|error|unreachable|crashed|could not resolve/i.test(content);
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className={`my-3 mx-auto max-w-xl rounded-lg px-3 py-2 text-xs flex items-start gap-2 ${
          isError ? "border-2" : "soft-border"
        }`}
        style={
          isError
            ? { borderColor: "#dc2626", background: "rgba(220,38,38,0.05)", color: "#991b1b" }
            : { background: "var(--surface)" }
        }
      >
        {isError && <AlertOctagon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
        <span className="font-semibold">{content}</span>
      </motion.div>
    );
  }

  // Hide raw Darwin JSON decision. It is rendered as a tool/approval card instead.
  if (role === "agent" && agent === "darwin" && /^\s*\{.*"tool"\s*:/s.test(content)) {
    return null;
  }

  const who = role === "user" ? "user" : agent || "darwin";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="flex items-start gap-3 py-2"
    >
      <AgentAvatar agent={who} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">{agentLabel(who)}</span>
        </div>
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{content}</div>
      </div>
    </motion.div>
  );
}

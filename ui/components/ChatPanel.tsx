"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Send, Wifi, WifiOff } from "lucide-react";
import { api, streamChat, type Message, type ToolCall } from "@/lib/api";
import ChatMessage from "./ChatMessage";
import ApprovalInline from "./ApprovalInline";
import ToolCallModal from "./ToolCallModal";
import ResolutionBanner from "./ResolutionBanner";
import ActionStatusCard from "./ActionStatusCard";
import TypingDots from "./TypingDots";
import AgentAvatar, { agentLabel } from "./AgentAvatar";

type Resolution = { outcome: "resolved" | "abandoned"; summary?: string } | null;
type Mention = { start: number; query: string } | null;

const AGENT_OPTIONS = [
  { id: "rick", name: "Rick", role: "Investigator" },
  { id: "morty", name: "Morty", role: "Investigator" },
  { id: "darwin", name: "Darwin", role: "Decision-maker" },
];

function activeMention(text: string, cursor: number): Mention {
  const before = text.slice(0, cursor);
  const match = /(^|\s)@([a-z]*)$/i.exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2].toLowerCase() };
}

function resolvedOutcome(summary?: string | null): "resolved" | "abandoned" {
  return summary?.toLowerCase().includes("could not resolve") ? "abandoned" : "resolved";
}

export default function ChatPanel({ chatId }: { chatId: number }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [streamingAgent, setStreamingAgent] = useState<string | null>(null);
  const [streamBuf, setStreamBuf] = useState("");
  const [modalTc, setModalTc] = useState<ToolCall | null>(null);
  const [input, setInput] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [chatTitle, setChatTitle] = useState("");
  const [active, setActive] = useState(false);
  const [resolution, setResolution] = useState<Resolution>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tempIdRef = useRef(-1);

  const nextTempId = () => tempIdRef.current--;

  const upsertMessage = (message: Message) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === message.id);
      if (idx === -1) return [...prev, message];
      const next = [...prev];
      next[idx] = message;
      return next;
    });
  };

  const replaceTempMessage = (tempId: number, message: Message) => {
    setMessages((prev) => [...prev.filter((m) => m.id !== tempId && m.id !== message.id), message]);
  };

  const upsertToolCall = (toolCall: ToolCall) => {
    setToolCalls((prev) => {
      const idx = prev.findIndex((tc) => tc.id === toolCall.id);
      if (idx === -1) return [...prev, toolCall];
      const next = [...prev];
      next[idx] = toolCall;
      return next;
    });
  };

  const updateToolCall = (toolCallId: number, patch: Partial<ToolCall>) => {
    setToolCalls((prev) => prev.map((tc) => (tc.id === toolCallId ? { ...tc, ...patch } : tc)));
  };

  const refetch = () =>
    api.getChat(chatId).then((d) => {
      setMessages(d.messages);
      setToolCalls(d.tool_calls);
      setChatTitle(d.chat.title);
      setActive(d.active);
      if (d.chat.resolved_at) {
        setResolution({
          outcome: resolvedOutcome(d.chat.incident_summary),
          summary: d.chat.incident_summary || "",
        });
      }
    });

  useEffect(() => {
    setResolution(null);
    setStreamingAgent(null);
    setStreamBuf("");
    setThinking(null);
    refetch();
    const off = streamChat(chatId, (ev) => {
      if (ev.type === "stream_open") {
        setConnected(true);
        refetch();
        return;
      }
      if (ev.type === "stream_error") {
        setConnected(false);
        return;
      }
      if (ev.type === "heartbeat") {
        return;
      }
      if (ev.type === "message_start") {
        setStreamingAgent(ev.agent);
        setStreamBuf("");
        setThinking(null);
        return;
      }
      if (ev.type === "message_cancel") {
        setStreamingAgent(null);
        setStreamBuf("");
        setThinking(null);
        return;
      }
      if (ev.type === "message_delta") {
        setStreamBuf((b) => b + ev.delta);
        return;
      }
      if (ev.type === "message_end") {
        if (ev.message) upsertMessage(ev.message);
        setStreamingAgent(null);
        setStreamBuf("");
        const nextAgent = ev.agent === "rick" ? "morty" : ev.agent === "morty" ? "darwin" : null;
        if (nextAgent) setThinking(nextAgent);
        return;
      }
      if (ev.type === "user_message") {
        if (ev.message) upsertMessage(ev.message);
        return;
      }
      if (ev.type === "system") {
        upsertMessage(ev.message ?? {
          id: nextTempId(),
          chat_id: chatId,
          role: "system",
          agent: null,
          content: ev.content,
          ts: Date.now() / 1000,
        });
        return;
      }
      if (ev.type === "tool_call") {
        if (ev.status === "pending_approval") setThinking(null);
        upsertToolCall(ev.tool_call ?? {
          id: ev.tool_call_id,
          chat_id: chatId,
          tool: ev.tool,
          args: { reason: ev.reason },
          status: ev.status,
          result: null,
          tier: ev.tier,
          ts: Date.now() / 1000,
        });
        return;
      }
      if (ev.type === "tool_status") {
        if (ev.tool_call) upsertToolCall(ev.tool_call);
        else updateToolCall(ev.tool_call_id, { status: ev.status });
        return;
      }
      if (ev.type === "tool_result") {
        if (ev.tool_call) upsertToolCall(ev.tool_call);
        else updateToolCall(ev.tool_call_id, { status: ev.status ?? "executed", result: ev.result });
        return;
      }
      if (ev.type === "incident_resolved") {
        setActive(false);
        setResolution({ outcome: ev.outcome || "resolved", summary: ev.summary });
      }
    });
    return off;
  }, [chatId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamBuf, toolCalls, resolution, thinking]);

  const mention = useMemo(() => activeMention(input, cursorPos), [input, cursorPos]);
  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    return AGENT_OPTIONS.filter((agent) =>
      agent.id.startsWith(mention.query) || agent.name.toLowerCase().startsWith(mention.query)
    );
  }, [mention]);

  const insertMention = (agentId: string) => {
    if (!mention) return;
    const before = input.slice(0, mention.start);
    const after = input.slice(cursorPos).replace(/^\s+/, "");
    const next = `${before}@${agentId} ${after}`;
    const nextCursor = before.length + agentId.length + 2;
    setInput(next);
    setCursorPos(nextCursor);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const onApprove = async (toolCallId: number, approved: boolean) => {
    updateToolCall(toolCallId, { status: approved ? "approved" : "denied" });
    try {
      const out = await api.approve(chatId, toolCallId, approved);
      if (out.tool_call) upsertToolCall(out.tool_call);
    } catch {
      await refetch();
      upsertMessage({
        id: nextTempId(),
        chat_id: chatId,
        role: "system",
        agent: null,
        content: "Approval request failed to send.",
        ts: Date.now() / 1000,
      });
    }
  };

  const onSend = async () => {
    if (!input.trim()) return;
    const content = input;
    const tempId = nextTempId();
    setInput("");
    setCursorPos(0);
    upsertMessage({
      id: tempId,
      chat_id: chatId,
      role: "user",
      agent: null,
      content,
      ts: Date.now() / 1000,
    });
    try {
      const out = await api.postMessage(chatId, content);
      if (out.message) replaceTempMessage(tempId, out.message);
    } catch {
      upsertMessage({
        id: nextTempId(),
        chat_id: chatId,
        role: "system",
        agent: null,
        content: "Message failed to send.",
        ts: Date.now() / 1000,
      });
    }
  };

  type TimelineItem =
    | { kind: "msg"; ts: number; msg: Message }
    | { kind: "tool"; ts: number; tc: ToolCall };
  const timeline: TimelineItem[] = [
    ...messages.map<TimelineItem>((m) => ({ kind: "msg", ts: m.ts, msg: m })),
    ...toolCalls.map<TimelineItem>((tc) => ({ kind: "tool", ts: tc.ts, tc })),
  ].sort((a, b) => a.ts - b.ts);

  const activeModalTc = modalTc ? toolCalls.find((tc) => tc.id === modalTc.id) ?? modalTc : null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 md:px-6 py-3 soft-border border-x-0 border-t-0 flex items-center justify-between bg-white">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs">
            {active ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-semibold text-white" style={{ background: "#dc2626" }}>
                <Activity className="w-3 h-3" /> LIVE INCIDENT
              </span>
            ) : resolution ? (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-semibold text-white"
                style={{ background: resolution.outcome === "resolved" ? "#16a34a" : "#dc2626" }}
              >
                {resolution.outcome === "resolved" ? "RESOLVED" : "UNRESOLVED"}
              </span>
            ) : (
              <span className="muted">Chat</span>
            )}
            <span className="inline-flex items-center gap-1 muted">
              {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {connected ? "Live sync" : "Reconnecting"}
            </span>
          </div>
          <h1 className="font-semibold text-base mt-0.5 truncate">{chatTitle}</h1>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-4 md:px-6 py-4 max-w-3xl w-full mx-auto">
        <AnimatePresence initial={false}>
          {timeline.map((it) => {
            if (it.kind === "msg") {
              const m = it.msg;
              return (
                <ChatMessage
                  key={`m-${m.id}`}
                  role={m.role}
                  agent={m.agent}
                  content={m.content}
                />
              );
            }
            const tc = it.tc;
            if (tc.status === "pending_approval") {
              return (
                <ApprovalInline
                  key={`t-${tc.id}`}
                  tool={tc.tool}
                  reason={tc.args?.reason || ""}
                  decided={null}
                  onDecide={(ok) => onApprove(tc.id, ok)}
                />
              );
            }
            if (tc.status === "denied" || (tc.status === "approved" && tc.tier > 0)) {
              return (
                <ApprovalInline
                  key={`t-${tc.id}`}
                  tool={tc.tool}
                  reason={tc.args?.reason || ""}
                  decided={tc.status === "denied" ? "denied" : "approved"}
                  onDecide={() => {}}
                />
              );
            }
            return (
              <ActionStatusCard key={`t-${tc.id}`} tc={tc} onClick={() => setModalTc(tc)} />
            );
          })}
        </AnimatePresence>

        {streamingAgent && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 py-2"
          >
            <AgentAvatar agent={streamingAgent} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-sm">{agentLabel(streamingAgent)}</span>
                <TypingDots />
              </div>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{streamBuf}</div>
            </div>
          </motion.div>
        )}
        {!streamingAgent && thinking && active && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-3 py-2"
          >
            <AgentAvatar agent={thinking} />
            <TypingDots label={`${agentLabel(thinking)} is thinking`} />
          </motion.div>
        )}

        {resolution && <ResolutionBanner outcome={resolution.outcome} summary={resolution.summary} />}
      </div>

      <div className="px-4 md:px-6 py-3 soft-border border-x-0 border-b-0 bg-white">
        <div className="max-w-3xl mx-auto flex items-end gap-2 relative">
          {mention && mentionMatches.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute left-0 bottom-full mb-2 w-72 soft-card p-1 shadow-sm z-10"
            >
              {mentionMatches.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(agent.id);
                  }}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-soft-hover"
                >
                  <AgentAvatar agent={agent.id} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{agent.name}</span>
                    <span className="block text-xs muted">{agent.role}</span>
                  </span>
                </button>
              ))}
            </motion.div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setCursorPos(e.target.selectionStart);
            }}
            onClick={(e) => setCursorPos(e.currentTarget.selectionStart)}
            onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (mention && mentionMatches.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
                e.preventDefault();
                insertMention(mentionMatches[0].id);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Message. Use @rick, @morty, or @darwin to query an agent"
            rows={1}
            className="flex-1 resize-none soft-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-300"
          />
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={onSend}
            className="p-2 rounded-xl soft-border bg-white hover:bg-soft-hover"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </motion.button>
        </div>
      </div>
      <ToolCallModal tc={activeModalTc} onClose={() => setModalTc(null)} />
    </div>
  );
}

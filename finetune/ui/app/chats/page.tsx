"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MessageSquare, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { api, incidentColor, incidentOutcome, streamGlobal, type Chat } from "@/lib/api";

export default function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  useEffect(() => {
    const load = () => api.listChats().then(setChats).catch(() => {});
    load();
    const off = streamGlobal((ev) => {
      if (ev.type === "incident_opened" || (ev.type === "data_changed" && ev.scope === "chats")) load();
    });
    return off;
  }, []);

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Chats</h1>
      <div className="soft-card divide-y" style={{ borderColor: "var(--border)" }}>
        {chats.length === 0 && <div className="p-6 text-sm muted text-center">No chats yet.</div>}
        {chats.map((c) => {
          const isIncident = c.kind === "incident";
          const outcome = incidentOutcome(c);
          const active = outcome === "active";
          const unresolved = outcome === "unresolved";
          const color = incidentColor(outcome);
          return (
            <Link key={c.id} href={`/chats/${c.id}`}>
              <motion.div
                whileHover={{ x: 2 }}
                className="flex items-center gap-3 p-4 hover:bg-soft-hover cursor-pointer border-l-4"
                style={{ borderLeftColor: color }}
              >
                {isIncident ? (
                  active ? (
                    <AlertTriangle className="w-4 h-4" style={{ color }} />
                  ) : unresolved ? (
                    <XCircle className="w-4 h-4" style={{ color }} />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" style={{ color }} />
                  )
                ) : (
                  <MessageSquare className="w-4 h-4 muted" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{c.title}</div>
                  <div className="text-xs muted">{new Date(c.created_at * 1000).toLocaleString()}</div>
                </div>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full"
                  style={{
                    background: isIncident ? color : "transparent",
                    color: isIncident ? "white" : "var(--muted)",
                    border: isIncident ? "none" : "1px solid var(--border)",
                  }}
                >
                  {isIncident ? (active ? "ACTIVE" : unresolved ? "UNRESOLVED" : "RESOLVED") : "CHAT"}
                </span>
              </motion.div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

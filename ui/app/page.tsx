"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Activity, MessageSquare, ArrowRight } from "lucide-react";
import { api, incidentColor, incidentOutcome, streamGlobal, type Chat, type HealthStatus } from "@/lib/api";
import HealthBadge from "@/components/HealthBadge";

export default function Dashboard() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [health, setHealth] = useState<{ status: HealthStatus; message: string }>({ status: "unknown", message: "" });

  useEffect(() => {
    const load = () => {
      api.listChats().then(setChats).catch(() => {});
      api.getHealth().then((h) => setHealth({ status: h.status, message: h.message })).catch(() => {});
    };
    load();
    const off = streamGlobal((ev) => {
      if (ev.type === "health") setHealth({ status: ev.status, message: ev.message });
      if (ev.type === "incident_opened" || (ev.type === "data_changed" && ev.scope === "chats")) {
        api.listChats().then(setChats).catch(() => {});
      }
    });
    return off;
  }, []);

  const incidents = chats.filter((c) => c.kind === "incident").slice(0, 5);

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Operations</h1>
        <p className="text-sm muted">Live multi-agent monitoring of your service.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <motion.div whileHover={{ y: -2 }} className="soft-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs muted">Target health</div>
            <Activity className="w-4 h-4 muted" />
          </div>
          <HealthBadge status={health.status} message={health.message} />
          <div className="text-xs muted mt-3 line-clamp-2">{health.message || "Waiting for first poll..."}</div>
        </motion.div>

        <motion.div whileHover={{ y: -2 }} className="soft-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs muted">Total chats</div>
            <MessageSquare className="w-4 h-4 muted" />
          </div>
          <div className="text-2xl font-semibold">{chats.length}</div>
          <div className="text-xs muted mt-1">{incidents.length} incident chat{incidents.length === 1 ? "" : "s"}</div>
        </motion.div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Recent incidents</h2>
        <Link href="/chats" className="text-xs muted hover:underline flex items-center gap-1">
          All chats <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="soft-card divide-y" style={{ borderColor: "var(--border)" }}>
        {incidents.length === 0 && (
          <div className="p-6 text-sm muted text-center">No incidents yet. Agents are watching.</div>
        )}
        {incidents.map((c) => {
          const outcome = incidentOutcome(c);
          const active = outcome === "active";
          const color = incidentColor(outcome);
          return (
            <Link key={c.id} href={`/chats/${c.id}`}>
              <motion.div
                whileHover={{ x: 2 }}
                className="flex items-center gap-3 p-4 hover:bg-soft-hover cursor-pointer border-l-4"
                style={{ borderLeftColor: color }}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${active ? "pulse-dot" : ""}`}
                  style={{ background: color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{c.title}</div>
                  <div className="text-xs muted">{new Date(c.created_at * 1000).toLocaleString()}</div>
                </div>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full text-white"
                  style={{ background: color }}
                >
                  {active ? "ACTIVE" : outcome === "unresolved" ? "UNRESOLVED" : "RESOLVED"}
                </span>
              </motion.div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

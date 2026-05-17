"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, streamGlobal } from "@/lib/api";

export default function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => {
    const load = () => api.listLogs().then(setLogs).catch(() => {});
    load();
    const off = streamGlobal((ev) => {
      if (ev.type === "data_changed" && ev.scope === "logs") load();
      if (ev.type === "incident_opened") load();
    });
    return off;
  }, []);

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Logs</h1>
      <div className="soft-card divide-y" style={{ borderColor: "var(--border)" }}>
        {logs.length === 0 && <div className="p-6 text-sm muted text-center">No logs yet.</div>}
        {logs.map((l) => (
          <motion.div key={l.id} whileHover={{ x: 2 }} className="flex items-start gap-3 p-3 hover:bg-soft-hover">
            <span className="text-[10px] muted w-36 flex-shrink-0 mt-0.5">{new Date(l.ts * 1000).toLocaleString()}</span>
            <span className="text-xs font-semibold w-40 flex-shrink-0">{l.kind}</span>
            <span className="text-xs flex-1">{l.summary}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

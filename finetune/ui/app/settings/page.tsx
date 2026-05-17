"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Shield } from "lucide-react";
import { api, streamGlobal, TIER_LABELS, type Settings } from "@/lib/api";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(setS);
    const off = streamGlobal((ev) => {
      if (ev.type === "settings_changed") setS(ev.settings);
    });
    return off;
  }, []);

  if (!s) return <div className="p-10 muted text-sm">Loading...</div>;

  const save = async (next: Partial<Settings>) => {
    const merged = { ...s, ...next };
    setS(merged);
    const out = await api.setSettings(next);
    setS(out);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  return (
    <div className="p-6 md:p-10 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Settings</h1>

      <section className="soft-card p-5 mb-5">
        <div className="text-xs muted mb-2">Observed service endpoint</div>
        <div className="flex gap-2">
          <input
            value={s.healthUrl}
            readOnly
            className="flex-1 soft-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-300"
            placeholder="/target/health"
          />
        </div>
        <div className="text-xs muted mt-2">Runs inside the backend process and is polled every second.</div>
      </section>

      <section className="soft-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4" />
          <h2 className="font-semibold">Agent degree of freedom</h2>
        </div>
        <p className="text-xs muted mb-4">
          Tools are ordered by impact:
          <span className="font-semibold"> page &lt; restart &lt; patch</span>.
          Agents may always propose any tool, but anything above the allowed tier requires your inline approval.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {TIER_LABELS.map((label, i) => {
            const active = s.allowedTier === i;
            return (
              <motion.button
                key={i}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => save({ allowedTier: i as 0 | 1 | 2 })}
                className={`p-3 rounded-lg soft-border text-sm text-left ${active ? "bg-soft-hover font-semibold" : "bg-white hover:bg-soft-hover"}`}
              >
                <div className="text-xs muted mb-1">Tier {i}</div>
                <div>{label}</div>
              </motion.button>
            );
          })}
        </div>
        {saved && <div className="text-xs muted mt-3">Saved.</div>}
      </section>
    </div>
  );
}

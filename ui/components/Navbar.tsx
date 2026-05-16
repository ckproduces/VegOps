"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, Settings as SettingsIcon, Menu } from "lucide-react";
import { api, streamGlobal, type HealthStatus } from "@/lib/api";
import HealthBadge from "./HealthBadge";

export default function Navbar() {
  const [status, setStatus] = useState<HealthStatus>("unknown");
  const [message, setMessage] = useState("");
  const router = useRouter();

  useEffect(() => {
    api.getHealth().then((h) => { setStatus(h.status); setMessage(h.message); }).catch(() => {});
    const off = streamGlobal((ev) => {
      if (ev.type === "health") { setStatus(ev.status); setMessage(ev.message); }
    });
    return off;
  }, [router]);

  const onNew = async () => {
    const { id } = await api.createChat("New chat");
    router.push(`/chats/${id}`);
  };

  return (
    <header className="flex items-center justify-between gap-4 px-4 md:px-6 h-14 soft-border border-x-0 border-t-0 bg-white">
      <div className="flex items-center gap-3">
        <button className="md:hidden p-2 rounded-lg hover:bg-soft-hover" aria-label="Menu">
          <Menu className="w-4 h-4" strokeWidth={1.75} />
        </button>
        <HealthBadge status={status} message={message} />
      </div>
      <div className="flex items-center gap-2">
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.97 }}
          onClick={onNew}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg soft-border text-sm hover:bg-soft-hover"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          <span>New chat</span>
        </motion.button>
        <Link href="/settings">
          <motion.div
            whileHover={{ rotate: 30 }}
            whileTap={{ scale: 0.9 }}
            className="p-2 rounded-lg hover:bg-soft-hover muted"
          >
            <SettingsIcon className="w-4 h-4" strokeWidth={1.75} />
          </motion.div>
        </Link>
      </div>
    </header>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { LayoutDashboard, MessageSquare, ScrollText, Settings, ChevronLeft, Activity, FileText } from "lucide-react";

const items = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/chats", icon: MessageSquare, label: "Chats" },
  { href: "/logs", icon: ScrollText, label: "Logs" },
  { href: "/reports", icon: FileText, label: "Reports" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <aside
      className={`hidden md:flex flex-col soft-border border-r border-y-0 border-l-0 bg-white transition-all duration-200 ${
        collapsed ? "w-[64px]" : "w-[220px]"
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-5">
        <Activity className="w-5 h-5" strokeWidth={1.75} />
        {!collapsed && <span className="font-semibold tracking-tight">VegOps</span>}
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {items.map((it) => {
          const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(it.href));
          const Icon = it.icon;
          return (
            <Link key={it.href} href={it.href}>
              <motion.div
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer ${
                  active ? "bg-soft-hover font-semibold" : "hover:bg-soft-hover muted"
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={1.75} />
                {!collapsed && <span>{it.label}</span>}
              </motion.div>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto p-2">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center justify-center w-full p-2 rounded-lg hover:bg-soft-hover muted"
          aria-label="Toggle sidebar"
        >
          <ChevronLeft className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`} strokeWidth={1.75} />
        </motion.button>
      </div>
    </aside>
  );
}

"use client";
import { motion } from "framer-motion";

export default function TypingDots({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs muted">
      {label && <span>{label}</span>}
      <span className="inline-flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="inline-block w-1 h-1 rounded-full bg-zinc-400"
            animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </span>
    </span>
  );
}

"use client";

function avatarDataUri(bg: string, fg: string, accent: string, initials: string) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="${bg}"/>
  <circle cx="32" cy="24" r="12" fill="${fg}"/>
  <path d="M14 58c3-13 12-20 18-20s15 7 18 20" fill="${fg}"/>
  <circle cx="48" cy="14" r="7" fill="${accent}"/>
  <text x="32" y="57" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#ffffff">${initials}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const AGENTS: Record<string, { name: string; src: string }> = {
  rick: { name: "Rick", src: avatarDataUri("#075985", "#e0f2fe", "#38bdf8", "RI") },
  morty: { name: "Morty", src: avatarDataUri("#854d0e", "#fef3c7", "#facc15", "MO") },
  darwin: { name: "Darwin", src: avatarDataUri("#4c1d95", "#ede9fe", "#a78bfa", "DA") },
  user: { name: "You", src: avatarDataUri("#18181b", "#f4f4f5", "#71717a", "YO") },
  system: { name: "System", src: avatarDataUri("#52525b", "#fafafa", "#a1a1aa", "SY") },
};

export default function AgentAvatar({ agent }: { agent: string }) {
  const a = AGENTS[agent] || AGENTS.system;
  return (
    <img
      src={a.src}
      alt={`${a.name} profile`}
      title={a.name}
      className="w-8 h-8 rounded-full flex-shrink-0 soft-border object-cover bg-white"
    />
  );
}

export function agentLabel(agent: string) {
  return AGENTS[agent]?.name ?? agent;
}

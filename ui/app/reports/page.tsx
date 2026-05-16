"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Download, FileText, X } from "lucide-react";
import { api, streamGlobal, type IncidentReport } from "@/lib/api";

const AUDIENCE_LABELS: Record<IncidentReport["audience"], string> = {
  customer_success: "Customer Success Team",
  developer: "Developer Team",
  devops_sre: "DevOps and SRE Teams",
};

const AUDIENCE_ORDER: IncidentReport["audience"][] = [
  "customer_success",
  "developer",
  "devops_sre",
];

function safePdfText(value: string): string {
  return value
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(line: string, width = 92): string[] {
  if (!line.trim()) return [""];
  const words = line.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      out.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) out.push(current);
  return out;
}

function makePdf(title: string, content: string): string {
  const bodyLines = content.split("\n").flatMap((line) => wrapLine(line));
  const linesPerPage = 46;
  const pages: string[][] = [];
  for (let i = 0; i < bodyLines.length; i += linesPerPage) {
    pages.push(bodyLines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) pages.push([]);

  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];

  pages.forEach((pageLines, index) => {
    const pageTitle = index === 0 ? title : `${title} (continued)`;
    const ops = [
      "BT",
      "/F1 16 Tf",
      "50 750 Td",
      `(${safePdfText(pageTitle)}) Tj`,
      "/F1 10 Tf",
      "0 -28 Td",
      "14 TL",
      ...pageLines.flatMap((line) => [`(${safePdfText(line)}) Tj`, "T*"]),
      "ET",
    ];
    const stream = ops.join("\n");
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  });

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets[index + 1] = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return pdf;
}

function downloadReport(report: IncidentReport) {
  const label = AUDIENCE_LABELS[report.audience].replace(/\s+/g, "-").toLowerCase();
  const fileName = `incident-${report.incident_id}-${label}.pdf`;
  const blob = new Blob([makePdf(report.title, report.content)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [reports, setReports] = useState<IncidentReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<IncidentReport | null>(null);

  useEffect(() => {
    const load = () => api.listReports().then(setReports).catch(() => {});
    load();
    const off = streamGlobal((ev) => {
      if (ev.type === "data_changed" && ev.scope === "reports") load();
    });
    return off;
  }, []);

  const groups = useMemo(() => {
    const byIncident = new Map<number, IncidentReport[]>();
    for (const report of reports) {
      byIncident.set(report.incident_id, [...(byIncident.get(report.incident_id) ?? []), report]);
    }
    return [...byIncident.entries()].map(([incidentId, items]) => ({
      incidentId,
      reports: items.sort((a, b) => AUDIENCE_ORDER.indexOf(a.audience) - AUDIENCE_ORDER.indexOf(b.audience)),
    }));
  }, [reports]);

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <FileText className="w-5 h-5" strokeWidth={1.75} />
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      </div>

      {groups.length === 0 && (
        <div className="soft-card p-8 text-sm muted text-center">
          No reports yet. Reports are created when an incident closes.
        </div>
      )}

      <div className="space-y-5">
        {groups.map(({ incidentId, reports: incidentReports }) => {
          const first = incidentReports[0];
          const resolved = Boolean(first?.incident_summary && !first.incident_summary.toLowerCase().includes("could not resolve"));
          const color = resolved ? "#16a34a" : "#dc2626";
          return (
            <motion.section
              key={incidentId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="soft-card overflow-hidden"
            >
              <div className="p-4 border-b flex items-start justify-between gap-4" style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0">
                  <div className="text-xs muted">Incident report log</div>
                  <h2 className="font-semibold truncate">
                    {first?.chat_title || `Incident #${incidentId}`}
                  </h2>
                  <div className="text-xs muted mt-1">
                    {first ? new Date(first.resolved_at ? first.resolved_at * 1000 : first.ts * 1000).toLocaleString() : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {first?.chat_id && (
                    <Link href={`/chats/${first.chat_id}`} className="text-xs muted hover:underline">
                      Open chat
                    </Link>
                  )}
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full text-white"
                    style={{ background: color }}
                  >
                    {resolved ? "Resolved" : "Unresolved"}
                  </span>
                </div>
              </div>

              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {incidentReports.map((report) => (
                  <div key={report.id} className="p-4 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedReport(report)}
                      className="min-w-0 flex items-center gap-3 text-left"
                    >
                      <span className="w-9 h-9 rounded-lg soft-border flex items-center justify-center flex-shrink-0 bg-white">
                        <FileText className="w-4 h-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold truncate">{AUDIENCE_LABELS[report.audience]}</span>
                        <span className="block text-xs muted">{new Date(report.ts * 1000).toLocaleString()}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadReport(report)}
                      className="p-2 rounded-lg soft-border hover:bg-soft-hover"
                      aria-label={`Download ${AUDIENCE_LABELS[report.audience]} report`}
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.section>
          );
        })}
      </div>

      {selectedReport && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
          onMouseDown={() => setSelectedReport(null)}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="p-4 border-b flex items-start justify-between gap-4" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0">
                <div className="text-xs muted">Incident #{selectedReport.incident_id}</div>
                <h2 className="font-semibold truncate">{AUDIENCE_LABELS[selectedReport.audience]}</h2>
                <div className="text-xs muted mt-1">{selectedReport.title}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => downloadReport(selectedReport)}
                  className="p-2 rounded-lg soft-border hover:bg-soft-hover"
                  aria-label="Download report as PDF"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedReport(null)}
                  className="p-2 rounded-lg soft-border hover:bg-soft-hover"
                  aria-label="Close report"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-5 overflow-y-auto max-h-[65vh]">
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{selectedReport.content}</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}

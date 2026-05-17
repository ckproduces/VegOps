"use client";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { TOOL_LABELS, type ToolCall } from "@/lib/api";

const MOCK_PATCH_DIFF = `diff --git a/services/health.py b/services/health.py
index 31ab2c0..9d88f41 100644
--- a/services/health.py
+++ b/services/health.py
@@ -18,12 +18,19 @@ def check_orders_dependency():
-    response = orders_client.get("/orders/health", timeout=1)
-    if response.status_code >= 500:
-        raise HealthCheckError("orders dependency failed")
-    return response.json()
+    try:
+        response = orders_client.get("/orders/health", timeout=3)
+        response.raise_for_status()
+        return response.json()
+    except TimeoutError:
+        metrics.increment("health.orders.timeout")
+        return {"status": "degraded", "source": "orders"}
+    except Exception as exc:
+        raise HealthCheckError(f"orders dependency failed: {exc}") from exc
 
 def health():
-    check_orders_dependency()
-    return {"status": "ok"}
+    dependency = check_orders_dependency()
+    return {"status": "ok", "dependency": dependency}`;

function diffLineClass(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) return "bg-green-50 text-green-800";
  if (line.startsWith("-") && !line.startsWith("---")) return "bg-red-50 text-red-800";
  if (line.startsWith("@@")) return "bg-zinc-100 text-zinc-700";
  return "text-zinc-800";
}

export default function ToolCallModal({ tc, onClose }: { tc: ToolCall | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {tc && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="soft-card w-full max-w-3xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-xs muted">Tool call</div>
                <div className="text-lg font-semibold">{TOOL_LABELS[tc.tool]}</div>
              </div>
              <button onClick={onClose} className="p-1 rounded hover:bg-soft-hover">
                <X className="w-4 h-4" />
              </button>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-sm mb-4">
              <dt className="muted">Status</dt>
              <dd className="col-span-2 font-semibold capitalize">{tc.status.replace("_", " ")}</dd>
              <dt className="muted">Tier</dt>
              <dd className="col-span-2">{tc.tier}</dd>
              <dt className="muted">When</dt>
              <dd className="col-span-2">{new Date(tc.ts * 1000).toLocaleString()}</dd>
            </dl>
            <div className="mb-3">
              <div className="text-xs muted mb-1">Reason</div>
              <div className="soft-border rounded p-2 text-sm bg-soft-surface">{tc.args?.reason || "-"}</div>
            </div>
            {tc.result && (
              <div className="mb-3">
                <div className="text-xs muted mb-1">Result</div>
                <pre className="soft-border rounded p-2 text-xs bg-soft-surface overflow-auto">{JSON.stringify(tc.result, null, 2)}</pre>
              </div>
            )}
            {tc.tool === "patch_code" && (
              <div>
                <div className="text-xs muted mb-1">Mock code diff</div>
                <pre className="soft-border rounded text-xs overflow-auto bg-white max-h-[360px]">
                  {MOCK_PATCH_DIFF.split("\n").map((line, idx) => (
                    <span key={idx} className={`block px-3 py-0.5 font-mono ${diffLineClass(line)}`}>
                      {line || " "}
                    </span>
                  ))}
                </pre>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

"use client";

/**
 * Registers Skulora's tools with the browser's WebMCP surface.
 * Renders a small status chip so a judge can see at a glance whether their browser exposes
 * `document.modelContext` (ChatGPT desktop browser, Chrome 149+ with the WebMCP flag).
 */
import { useEffect, useState } from "react";
import { getModelContext } from "@/lib/webmcp/types";
import { tools } from "@/lib/webmcp/tools";

type Status = "checking" | "registered" | "unsupported" | "error";

export default function WebMCPTools() {
  const [status, setStatus] = useState<Status>("checking");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const mc = getModelContext();
      if (!mc) {
        setStatus("unsupported");
        setDetail("No document.modelContext — use the built-in agent, or open in ChatGPT's browser / Chrome with chrome://flags/#enable-webmcp-testing");
        return;
      }
      try {
        for (const tool of tools) {
          // Literal call kept on purpose: the challenge rules ask for it verbatim.
          await document.modelContext!.registerTool(
            {
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: tool.annotations,
              execute: tool.execute,
            },
            { signal: ac.signal },
          );
        }
        setStatus("registered");
        setDetail(`${tools.length} tools registered on ${document.modelContext ? "document" : "navigator"}.modelContext`);
      } catch (e) {
        setStatus("error");
        setDetail(String(e));
      }
    })();
    return () => ac.abort();
  }, []);

  const color =
    status === "registered" ? "bg-emerald-600" : status === "unsupported" ? "bg-zinc-500" : status === "error" ? "bg-red-600" : "bg-amber-500";

  return (
    <div className="flex items-center gap-2 text-sm" title={detail}>
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      <span>
        WebMCP: <strong>{status}</strong>
      </span>
      <span className="text-zinc-500">{detail}</span>
    </div>
  );
}

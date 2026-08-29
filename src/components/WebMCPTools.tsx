"use client";

/**
 * Registers Skulora's tools with the browser's WebMCP surface, progressively: Stage A always,
 * Stage B once a mission exists, Stage C once every required slot is filled. Each stage change
 * re-registers, which fires the spec's `toolchange` event for listening agents.
 */
import { useEffect, useState } from "react";
import { getModelContext } from "@/lib/webmcp/types";
import { stageFor, tools, type Stage } from "@/lib/webmcp/tools";
import { boot, useMission } from "@/lib/mission/store";

type Status = "checking" | "registered" | "unsupported" | "error";
const ORDER: Stage[] = ["A", "B", "C"];

export default function WebMCPTools() {
  const mission = useMission();
  const stage = stageFor(mission);
  const [status, setStatus] = useState<Status>("checking");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    boot();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const mc = getModelContext();
      if (!mc) {
        setStatus("unsupported");
        setDetail("No document.modelContext — use the built-in agent, or open in ChatGPT's browser / Chrome with chrome://flags/#enable-webmcp-testing");
        return;
      }
      const active = tools.filter((t) => ORDER.indexOf(t.stage) <= ORDER.indexOf(stage));
      try {
        for (const tool of active) {
          // Literal call kept on purpose: the challenge rules ask for it verbatim.
          await document.modelContext!.registerTool(
            { name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations, execute: tool.execute },
            { signal: ac.signal },
          );
        }
        setStatus("registered");
        setDetail(`${active.length} tools registered on ${document.modelContext ? "document" : "navigator"}.modelContext (stage ${stage})`);
      } catch (e) {
        setStatus("error");
        setDetail(String(e));
      }
    })();
    return () => ac.abort();
  }, [stage]);

  const color =
    status === "registered" ? "bg-pine-600" : status === "unsupported" ? "bg-ink-faint" : status === "error" ? "bg-danger" : "bg-ochre-500";

  return (
    <div className="card flex items-center gap-2 px-3 py-1.5 text-sm" title={detail}>
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      <span>
        WebMCP: <strong>{status}</strong>
      </span>
      <span className="hidden max-w-[28rem] truncate text-xs text-ink-muted md:inline">{detail}</span>
    </div>
  );
}

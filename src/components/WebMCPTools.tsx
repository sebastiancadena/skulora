"use client";

/**
 * Registers Skulora's tools with the browser's WebMCP surface, progressively: Stage A always,
 * Stage B once a mission exists, Stage C once every required slot is filled. Each stage advance
 * registers the tools new to it, which fires the spec's `toolchange` event for listening agents.
 */
import { useEffect, useRef, useState } from "react";
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

  // One AbortController per registered tool, kept across stage changes: a stage advance only
  // registers the tools that are new to it (Chrome fires `toolchange` for the additions), so a
  // call in flight — create_mission is the one that advances the stage — keeps its registration
  // and its result. Re-registering everything on each change aborted the executing tool and
  // Chrome rejected the call as "failed for an unknown transient reason" although the tool had
  // run. Only a stage going backwards (New mission) unregisters, and no call is in flight then.
  const registered = useRef(new Map<string, AbortController>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mc = getModelContext();
      if (!mc) {
        setStatus("unsupported");
        setDetail("No document.modelContext — use the built-in agent, or open in ChatGPT's browser / Chrome with chrome://flags/#enable-webmcp-testing");
        return;
      }
      const active = tools.filter((t) => ORDER.indexOf(t.stage) <= ORDER.indexOf(stage));
      const wanted = new Set(active.map((t) => t.name));
      try {
        for (const [name, ac] of registered.current) {
          if (!wanted.has(name)) {
            ac.abort();
            registered.current.delete(name);
          }
        }
        for (const tool of active) {
          if (registered.current.has(tool.name)) continue;
          const ac = new AbortController();
          registered.current.set(tool.name, ac);
          // Literal call kept on purpose: the challenge rules ask for it verbatim.
          await document.modelContext!.registerTool(
            { name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations, execute: tool.execute },
            { signal: ac.signal },
          );
        }
        if (cancelled) return;
        setStatus("registered");
        setDetail(`${active.length} tools registered on ${document.modelContext ? "document" : "navigator"}.modelContext (stage ${stage})`);
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setDetail(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage]);

  // Unregister everything only when the component itself goes away.
  useEffect(() => {
    const reg = registered.current;
    return () => {
      for (const ac of reg.values()) ac.abort();
      reg.clear();
    };
  }, []);

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

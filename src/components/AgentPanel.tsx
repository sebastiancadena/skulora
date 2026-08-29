"use client";

/**
 * Built-in agent: a fallback for browsers without WebMCP and the narrator for the demo video.
 * It drives the exact same tool table the page registers with document.modelContext — the tool
 * calls are executed here in the page, so the board reacts identically to ChatGPT or Gemini.
 */
import { useEffect, useRef, useState } from "react";
import { tools } from "@/lib/webmcp/tools";
import { currentMission } from "@/lib/mission/store";
import { describeEvent, type MissionEvent } from "@/lib/mission/types";

type Line = { who: "you" | "agent" | "tool" | "delta"; text: string };

export default function AgentPanel() {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const prevId = useRef<string | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  const push = (l: Line) => setLines((ls) => [...ls, l]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setInput("");
    push({ who: "you", text });
    let input: unknown[] = [{ role: "user", content: text }];
    try {
      for (let step = 0; step < 24; step++) {
        const active = tools; // the built-in agent sees every stage; the server enforces the guards
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input, previous_response_id: prevId.current, tools: active.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })) }),
        });
        const data = (await res.json()) as { response_id?: string; text?: string; calls?: { call_id: string; name: string; arguments: string }[]; error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        prevId.current = data.response_id;
        if (data.text) push({ who: "agent", text: data.text });
        if (!data.calls?.length) break;
        // Execute every requested tool call concurrently (the server serializes writes with compare-and-set).
        for (const call of data.calls) push({ who: "tool", text: `▶ ${call.name}(${call.arguments.slice(0, 80)}${call.arguments.length > 80 ? "…" : ""})` });
        input = await Promise.all(
          data.calls.map(async (call) => {
            const tool = tools.find((t) => t.name === call.name);
            const t0 = performance.now();
            let output: unknown;
            try {
              const args = call.arguments ? JSON.parse(call.arguments) : {};
              output = tool ? await tool.execute(args) : { error: `unknown tool ${call.name}` };
            } catch (e) {
              output = { error: String((e as Error).message) };
            }
            const err = (output as { error?: string })?.error;
            push({ who: "tool", text: `${err ? "✗" : "✓"} ${call.name} ${((performance.now() - t0) / 1000).toFixed(1)}s${err ? ` — ${err.slice(0, 80)}` : ""}` });
            const delta = (output as { mission_delta?: Pick<MissionEvent, "type" | "detail">[] })?.mission_delta;
            if (delta?.length) push({ who: "delta", text: `↩ mission_delta → agent: ${delta.map((e) => describeEvent(e, currentMission())).join("; ")}` });
            return { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output).slice(0, 6000) };
          }),
        );
      }
    } catch (e) {
      push({ who: "agent", text: `Error: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="card flex h-[70vh] min-w-0 flex-col overflow-hidden text-ink">
      <div className="border-b border-line bg-paper-2 px-3 py-2 text-sm font-semibold">
        Built-in agent <span className="font-normal text-ink-muted">— same tools as ChatGPT sees; your board edits reach it as <code>mission_delta</code></span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        {lines.length === 0 && <p className="text-ink-muted">Try: “Outfit me for a 3-day desert backpacking trip, budget $600, I already own a stove. I run hot at night.”</p>}
        {lines.map((l, i) => (
          <div key={i} className={l.who === "you" ? "text-right" : ""}>
            <span className={`inline-block max-w-[95%] rounded-lg px-2 py-1 ${l.who === "you" ? "bg-ink text-white" : l.who === "tool" ? "font-mono text-xs text-ink-muted" : l.who === "delta" ? "border border-ochre-300 bg-ochre-50 text-xs text-ochre-900" : "bg-pine-50 text-ink"}`}>{l.text}</span>
          </div>
        ))}
        {busy && <div className="text-xs text-ink-muted">working…</div>}
        <div ref={bottom} />
      </div>
      <form
        className="flex gap-2 border-t border-line bg-paper-2 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input className="flex-1 rounded-[var(--radius-chip)] border border-line-strong px-2 py-1 text-sm" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Tell the agent what you need…" disabled={busy} />
        <button className="btn btn-primary px-3 py-1 text-sm disabled:opacity-50" disabled={busy}>Send</button>
      </form>
    </aside>
  );
}

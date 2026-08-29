"use client";

/**
 * Built-in agent: a fallback for browsers without WebMCP and the narrator for the demo video.
 * It drives the exact same tool table the page registers with document.modelContext — the tool
 * calls are executed here in the page, so the board reacts identically to ChatGPT or Gemini.
 */
import { useEffect, useRef, useState } from "react";
import { tools } from "@/lib/webmcp/tools";

type Line = { who: "you" | "agent" | "tool"; text: string };

export default function AgentPanel() {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const prevId = useRef<string | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ block: "nearest" }), [lines]);

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
        input = [];
        for (const call of data.calls) {
          const tool = tools.find((t) => t.name === call.name);
          let output: unknown;
          try {
            const args = call.arguments ? JSON.parse(call.arguments) : {};
            output = tool ? await tool.execute(args) : { error: `unknown tool ${call.name}` };
          } catch (e) {
            output = { error: String((e as Error).message) };
          }
          push({ who: "tool", text: `${call.name}(${call.arguments.slice(0, 80)}${call.arguments.length > 80 ? "…" : ""})` });
          input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output).slice(0, 6000) });
        }
      }
    } catch (e) {
      push({ who: "agent", text: `Error: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex h-[70vh] flex-col rounded-xl border border-zinc-200">
      <div className="border-b px-3 py-2 text-sm font-semibold">
        Built-in agent <span className="font-normal text-zinc-500">— same tools, no WebMCP browser needed</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        {lines.length === 0 && <p className="text-zinc-500">Try: “Outfit me for a 3-day desert backpacking trip, budget $600, I already own a stove. I run hot at night.”</p>}
        {lines.map((l, i) => (
          <div key={i} className={l.who === "you" ? "text-right" : ""}>
            <span className={`inline-block max-w-[95%] rounded-lg px-2 py-1 ${l.who === "you" ? "bg-zinc-900 text-white" : l.who === "tool" ? "font-mono text-xs text-zinc-500" : "bg-zinc-100"}`}>{l.text}</span>
          </div>
        ))}
        {busy && <div className="text-xs text-zinc-400">working…</div>}
        <div ref={bottom} />
      </div>
      <form
        className="flex gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input className="flex-1 rounded border px-2 py-1 text-sm" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Tell the agent what you need…" disabled={busy} />
        <button className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50" disabled={busy}>Send</button>
      </form>
    </aside>
  );
}

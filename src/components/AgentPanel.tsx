"use client";

/**
 * Built-in agent: a fallback for browsers without WebMCP and the narrator for the demo video.
 * It drives the exact same tool table the page registers with document.modelContext — each call
 * goes through the browser's executeTool when the page has registered the tool there (so Chrome's
 * DevTools logs it), else runs here in the page; the board reacts identically to ChatGPT or Gemini.
 */
import { useEffect, useRef, useState } from "react";
import { tools } from "@/lib/webmcp/tools";
import { getModelContext } from "@/lib/webmcp/types";
import { currentMission, useMission } from "@/lib/mission/store";
import { describeEvent, type MissionEvent } from "@/lib/mission/types";

/**
 * Run a tool the way an external agent would: through the browser's model context when this
 * page has registered it there (Chrome then logs the call in DevTools → Application → WebMCP,
 * with input and output), and directly otherwise (no WebMCP surface, or a tool of a later stage
 * the page has not disclosed yet — the built-in agent sees every stage; the server enforces the guards).
 */
async function invoke(tool: (typeof tools)[number], args: Record<string, unknown>): Promise<unknown> {
  const mc = getModelContext();
  if (mc?.executeTool && mc.getTools) {
    const registered = (await mc.getTools()).find((t) => t.name === tool.name);
    if (registered) {
      const out = await mc.executeTool(registered, JSON.stringify(args));
      if (typeof out === "string") {
        try { return JSON.parse(out); } catch { return out; }
      }
      return out;
    }
  }
  return tool.execute(args);
}
type Line = { who: "you" | "agent" | "tool" | "delta"; text: string };

// Model steps per send(). A serial run over nine slots is about 23 steps (plan, nine searches, nine
// choices, explain, checkout), so the old cap of 24 ended a run with a single retry, and did so in
// silence. Reaching this one prints a line; "continue" resumes the same thread.
const MAX_STEPS = 40;
const newRunId = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, "").slice(0, 8);

export default function AgentPanel() {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // The OpenAI conversation thread, tagged with the mission it is about.
  const prevId = useRef<{ for: string | null; id?: string }>({ for: null });
  const bottom = useRef<HTMLDivElement>(null);
  // The conversation belongs to one mission. "New mission" (board → null) or opening another
  // ?m=<id> while idle starts a fresh transcript; send() then drops the thread too, so the agent
  // does not carry the old board in its memory. A mission id that changes while busy is this
  // agent's own create_mission (first mission, or a replace the person asked for) — the same
  // conversation, so send() adopts the id and the transcript stays. (State adjusted during
  // render, the React-sanctioned form; an effect would flash the old lines first.)
  const missionId = useMission()?.id ?? null;
  const [convoFor, setConvoFor] = useState<string | null>(missionId);
  if (convoFor !== missionId && (missionId === null || !busy)) {
    setConvoFor(missionId);
    if (convoFor !== null || missionId === null) setLines([]);
  }

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
    let convo = convoFor;
    if (prevId.current.for !== convo) prevId.current = { for: convo };
    // The run id labels this send() in the server log line and in the OpenAI dashboard entry of
    // every step, so a transcript and the traces behind it can be matched up afterwards.
    const runId = newRunId();
    const t0 = performance.now();
    let steps = 0;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        steps = step + 1;
        // The server builds the model's tool list from the same specs this page registers; it does
        // not take one from here, so /api/agent cannot be driven with tools of someone's choosing.
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input, previous_response_id: prevId.current.id, run_id: runId, step }),
        });
        const data = (await res.json()) as {
          response_id?: string;
          status?: string;
          incomplete_reason?: string;
          text?: string;
          calls?: { call_id: string; name: string; arguments: string }[];
          error?: string;
        };
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        const nowId = currentMission()?.id ?? null;
        if (nowId !== null && nowId !== convo) {
          convo = nowId;
          setConvoFor(nowId);
        }
        prevId.current = { for: convo, id: data.response_id };
        if (data.text) push({ who: "agent", text: data.text });
        // A cut-off or failed step used to look exactly like "done". Say what happened instead.
        if (data.status && data.status !== "completed") push({ who: "tool", text: `⚠ model step ${data.status}${data.incomplete_reason ? ` (${data.incomplete_reason})` : ""}` });
        if (!data.calls?.length) {
          if (!data.text) push({ who: "agent", text: "Stopped: the model returned no reply and no tool call. Say “continue” to resume." });
          break;
        }
        if (step === MAX_STEPS - 1) push({ who: "agent", text: `Stopped after ${MAX_STEPS} model steps. Say “continue” to resume.` });
        // Execute every requested tool call concurrently (the server serializes writes with compare-and-set).
        for (const call of data.calls) push({ who: "tool", text: `▶ ${call.name}(${call.arguments.slice(0, 80)}${call.arguments.length > 80 ? "…" : ""})` });
        input = await Promise.all(
          data.calls.map(async (call) => {
            const tool = tools.find((t) => t.name === call.name);
            const t0 = performance.now();
            let output: unknown;
            try {
              const args = call.arguments ? JSON.parse(call.arguments) : {};
              output = tool ? await invoke(tool, args) : { error: `unknown tool ${call.name}` };
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
      push({ who: "tool", text: `run ${runId} · ${steps} step${steps === 1 ? "" : "s"} · ${((performance.now() - t0) / 1000).toFixed(0)}s` });
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

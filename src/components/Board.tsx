"use client";

import { useState } from "react";
import { act, clearMission, missionTotals, useMission } from "@/lib/mission/store";
import { describeEvent, type Candidate, type Mission, type Slot } from "@/lib/mission/types";
import { pendingHumanEdits } from "@/lib/webmcp/tools";
import { Mark } from "@/lib/brand/Mark";

function money(cents?: number | null, currency = "USD") {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function BudgetEditor({ cents, currency }: { cents?: number; currency: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String((cents ?? 0) / 100));
  if (!editing)
    return (
      <>
        {money(cents, currency)}{" "}
        <button className="btn ml-2" onClick={() => { setValue(String((cents ?? 0) / 100)); setEditing(true); }}>
          edit
        </button>
      </>
    );
  return (
    <form
      className="inline-flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const c = Math.round(Number(value) * 100);
        if (Number.isFinite(c) && c >= 0) void act("human", "set_budget", { budget_total_cents: c });
        setEditing(false);
      }}
    >
      <input className="w-24 rounded-[var(--radius-chip)] border border-line-strong px-1.5 font-mono text-sm" type="number" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="Budget in dollars" />
      <button className="btn btn-primary" type="submit">save</button>
      <button className="btn" type="button" onClick={() => setEditing(false)}>cancel</button>
    </form>
  );
}

function CandidateCard({ slot, c }: { slot: Slot; c: Candidate }) {
  const selected = slot.selected === c.id;
  const rejection = slot.rejected.find((r) => r.candidate_id === c.id);
  const rejected = !!rejection;
  return (
    <li className={`flex min-w-0 gap-3 rounded-[10px] border p-2 text-sm ${selected ? "border-pine-300 bg-pine-50" : rejected ? "border-line bg-paper-2 opacity-60" : "border-line bg-white"}`}>
      {c.image ? <img src={c.image} alt="" className="h-16 w-16 flex-none rounded-md object-cover" /> : <div className="h-16 w-16 flex-none rounded-md bg-paper-2" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <a href={c.url} target="_blank" rel="noreferrer" className="truncate font-medium text-ink hover:text-pine-700 hover:underline">{c.title}</a>
          <span className="flex-none font-mono font-semibold tabular-nums">{money(c.price_cents, c.currency)}</span>
        </div>
        <div className="text-xs text-ink-muted">{c.merchant_name ?? c.merchant_domain}</div>
        {c.why_it_fits.length > 0 && <div className="mt-1 text-xs text-pine-600">{c.why_it_fits.join(" · ")}</div>}
        {c.caveats.length > 0 && <div className="text-xs text-ochre-700">{c.caveats.join(" · ")}</div>}
        {selected && (
          <div className="mt-1 text-xs text-ink-soft">
            {slot.selected_by === "human" ? (
              <span className="chip bg-ink text-white">You chose this</span>
            ) : (
              <>
                <span className="chip bg-pine-600 text-white">Agent picked this</span>
                {slot.selected_reason && <span className="ml-1">{slot.selected_reason}</span>}
              </>
            )}
          </div>
        )}
        {rejected && <div className="mt-1 text-xs text-danger">You rejected this{rejection.reason ? ` — ${rejection.reason}` : ""}. The agent will not pick it again.</div>}
        <div className="mt-1 flex gap-1">
          {!selected && !rejected && (
            <button className="btn btn-primary" onClick={() => void act("human", "choose", { slot_id: slot.id, candidate_id: c.id })}>choose</button>
          )}
          {!rejected && (
            <button className="btn" onClick={() => void act("human", "reject", { slot_id: slot.id, candidate_id: c.id, reason: prompt("Why? (optional)") ?? undefined })}>reject</button>
          )}
        </div>
      </div>
    </li>
  );
}

function SlotCard({ slot }: { slot: Slot }) {
  const [open, setOpen] = useState(false);
  const sel = slot.candidates.find((c) => c.id === slot.selected);
  return (
    <section className={`card waypoint min-w-0 p-3 pl-8 ${slot.locked ? "border-ochre-300 shadow-[var(--shadow-raised)]" : ""}`}>
      <span className="waypoint-dot" data-state={slot.locked ? "locked" : sel ? "chosen" : "empty"} aria-hidden />
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {slot.need} {!slot.required && <span className="chip bg-paper-2 font-normal text-ink-muted">optional</span>}
          </h3>
          <p className="text-xs text-ink-muted">{slot.why}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {slot.budget_hint_cents != null && <span className="font-mono text-ink-muted">≈ {money(slot.budget_hint_cents)}</span>}
          {sel && (
            <button
              className={`btn ${slot.locked ? "btn-locked" : ""}`}
              title={slot.locked ? "Locked: the agent cannot change this pick. Click to unlock." : "Lock this pick so the agent plans around it"}
              onClick={() => void act("human", "lock", { slot_id: slot.id, locked: !slot.locked })}
            >
              {slot.locked ? "🔒 locked" : "lock"}
            </button>
          )}
          <button className="btn" onClick={() => setOpen((o) => !o)}>
            {slot.candidates.length} candidates
          </button>
        </div>
      </header>
      {slot.locked && <p className="mt-1 text-xs text-ochre-900">Locked — the agent keeps this and plans the rest around it.</p>}
      {sel ? (
        <>
          <ul className="mt-2"><CandidateCard slot={slot} c={sel} /></ul>
          {slot.tradeoffs && (
            <div className="mt-2 rounded-[10px] border border-line bg-paper-2 p-2 text-xs text-ink-soft">
              <p><span className="font-semibold text-ink">Why this:</span> {slot.tradeoffs.chosen_because}</p>
              {slot.tradeoffs.vs_alternatives.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-ink-soft">
                  {slot.tradeoffs.vs_alternatives.map((a) => {
                    const c = slot.candidates.find((x) => x.id === a.candidate_id);
                    return <li key={a.candidate_id}><span className="text-ink-muted">vs {c ? c.title.slice(0, 40) : a.candidate_id}:</span> {a.tradeoff}</li>;
                  })}
                </ul>
              )}
              <p className="mt-1 text-ink-muted">{slot.tradeoffs.budget_note}</p>
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">{slot.candidates.length ? (slot.rejected.length ? "Nothing picked — the agent will choose again on its next pass." : "No selection yet.") : "Waiting for the agent to search…"}</p>
      )}
      {open && (
        <ul className="mt-2 space-y-2">
          {slot.candidates.filter((c) => c.id !== slot.selected).map((c) => <CandidateCard key={c.id} slot={slot} c={c} />)}
        </ul>
      )}
    </section>
  );
}

/** What the person changed since the agent last looked — the same list the next tool result carries as mission_delta. */
function DeltaStrip({ m }: { m: Mission }) {
  const pending = pendingHumanEdits();
  if (pending.length === 0) {
    const lastHuman = [...m.events].reverse().find((e) => e.actor === "human");
    if (!lastHuman) return null;
    return <p className="mt-3 text-xs text-pine-600">✓ The agent has seen your latest edit ({describeEvent(lastHuman, m)}).</p>;
  }
  return (
    <div className="mt-3 rounded-[10px] border border-ochre-300 bg-ochre-50 p-2 text-xs text-ochre-900">
      <p className="font-semibold">
        {pending.length} edit{pending.length === 1 ? "" : "s"} the agent hasn’t seen yet — sent as <code>mission_delta</code> with its next tool call:
      </p>
      <ul className="mt-1 list-disc pl-4">{pending.map((e) => <li key={e.seq}>{describeEvent(e, m)}</li>)}</ul>
    </div>
  );
}

export default function Board() {
  const m = useMission();

  if (!m) {
    return (
      <section className="self-start rounded-[var(--radius-card)] border border-dashed border-line-strong bg-white/60 p-8 text-center text-ink-muted">
        <div className="mx-auto mb-4 w-fit"><Mark px={56} /></div>
        <p className="text-lg font-medium text-ink-soft">No mission yet.</p>
        <p className="mt-2 text-sm">
          Ask your agent: <em>“Outfit me for a 3-day desert backpacking trip, budget $600, I already own a stove.”</em>
        </p>
      </section>
    );
  }
  const t = missionTotals(m);
  const pct = m.budget_total_cents ? Math.min(100, Math.round((t.selected_cents / m.budget_total_cents) * 100)) : 0;
  const carts = Object.values(m.carts);

  return (
    <section className="min-w-0 space-y-4 text-ink">
      <header className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold [overflow-wrap:anywhere]">{m.goal}</h2>
          <button className="btn flex-none" onClick={() => clearMission()} title="Start a fresh board; this mission stays reachable at ?m=id">
            New mission
          </button>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-ink-muted">Budget</dt>
          <dd><BudgetEditor cents={m.budget_total_cents} currency={m.currency} /></dd>
          <dt className="text-ink-muted">Owned</dt>
          <dd>{m.owned_items.join(", ") || "—"}</dd>
          <dt className="text-ink-muted">Constraints</dt>
          <dd className="sm:col-span-3">{m.constraints.join(" · ") || "—"}</dd>
        </dl>
        {m.budget_total_cents != null && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-ink-soft">
              <span>{money(t.selected_cents, m.currency)} selected across {t.merchants} merchant{t.merchants === 1 ? "" : "s"}</span>
              <span className={`font-mono tabular-nums ${t.over_budget ? "font-semibold text-danger" : "text-pine-700"}`}>{t.over_budget ? `${money(-t.remaining_cents!, m.currency)} over` : `${money(t.remaining_cents, m.currency)} left`}</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-paper-2"><div className={`h-2 rounded-full transition-[width] duration-300 ${t.over_budget ? "bg-danger" : pct > 90 ? "bg-ochre-500" : "bg-pine-600"}`} style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        <DeltaStrip m={m} />
      </header>

      {m.slots.length === 0 ? (
        <p className="text-sm text-ink-muted">Slots appear once the agent plans the kit. Then lock what you like, reject what you don’t — the agent re-plans around your edits.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">{m.slots.map((s) => <SlotCard key={s.id} slot={s} />)}</div>
      )}

      {carts.length > 0 && (
        <section className="card border-pine-100 bg-pine-50/40 p-4">
          <h3 className="font-semibold text-pine-900">Checkout — one cart per merchant</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {carts.map((c) => (
              <li key={c.merchant_domain} className="rounded-[10px] border border-line bg-white p-3 text-sm shadow-[var(--shadow-card)]">
                <div className="font-medium">{c.merchant_domain}</div>
                <div className="text-xs text-ink-muted">{c.lines.map((l) => l.title).join(", ")}</div>
                <div className="mt-1 font-mono font-semibold tabular-nums">{money(c.total_cents, c.currency)}</div>
                {c.checkout_url ? (
                  <a className="btn btn-primary mt-2 px-3 py-1 text-sm" href={c.checkout_url} target="_blank" rel="noreferrer">Open checkout</a>
                ) : (
                  <div className="mt-2 text-xs text-danger">{c.error ?? "no checkout URL"}</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="text-xs text-ink-muted">
        <summary>Event log ({m.events.length}) · v{m.version}</summary>
        <ul className="mt-1 font-mono">{m.events.map((e) => <li key={e.seq}>#{e.seq} {e.actor === "human" ? "you" : "agent"} · {describeEvent(e, m)}</li>)}</ul>
      </details>
    </section>
  );
}

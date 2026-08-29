"use client";

import { useState } from "react";
import { act, clearMission, missionTotals, useMission } from "@/lib/mission/store";
import type { Candidate, Slot } from "@/lib/mission/types";

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
        <button className="ml-2 rounded border px-1.5 text-xs" onClick={() => { setValue(String((cents ?? 0) / 100)); setEditing(true); }}>
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
      <input className="w-24 rounded border px-1 text-sm" type="number" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="Budget in dollars" />
      <button className="rounded border px-1.5 text-xs" type="submit">save</button>
      <button className="rounded border px-1.5 text-xs" type="button" onClick={() => setEditing(false)}>cancel</button>
    </form>
  );
}

function CandidateCard({ slot, c }: { slot: Slot; c: Candidate }) {
  const selected = slot.selected === c.id;
  const rejected = slot.rejected.some((r) => r.candidate_id === c.id);
  return (
    <li className={`flex gap-3 rounded-lg border p-2 text-sm ${selected ? "border-emerald-500 bg-emerald-50" : rejected ? "border-zinc-200 bg-white opacity-50" : "border-zinc-200 bg-white"}`}>
      {c.image ? <img src={c.image} alt="" className="h-16 w-16 flex-none rounded object-cover" /> : <div className="h-16 w-16 flex-none rounded bg-zinc-100" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <a href={c.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">{c.title}</a>
          <span className="flex-none font-semibold">{money(c.price_cents, c.currency)}</span>
        </div>
        <div className="text-xs text-zinc-500">{c.merchant_name ?? c.merchant_domain}</div>
        {c.why_it_fits.length > 0 && <div className="mt-1 text-xs text-emerald-700">{c.why_it_fits.join(" · ")}</div>}
        {c.caveats.length > 0 && <div className="text-xs text-amber-700">{c.caveats.join(" · ")}</div>}
        <div className="mt-1 flex gap-1">
          {!selected && !rejected && (
            <button className="rounded border px-1.5 text-xs" onClick={() => void act("human", "choose", { slot_id: slot.id, candidate_id: c.id })}>choose</button>
          )}
          {!rejected && (
            <button className="rounded border px-1.5 text-xs" onClick={() => void act("human", "reject", { slot_id: slot.id, candidate_id: c.id, reason: prompt("Why? (optional)") ?? undefined })}>reject</button>
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
    <section className={`rounded-xl border bg-white p-3 ${slot.locked ? "border-indigo-400" : "border-zinc-200"}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {slot.need} {!slot.required && <span className="text-xs font-normal text-zinc-500">optional</span>}
          </h3>
          <p className="text-xs text-zinc-500">{slot.why}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {slot.budget_hint_cents != null && <span className="text-zinc-500">≈ {money(slot.budget_hint_cents)}</span>}
          {sel && (
            <button className={`rounded border px-1.5 ${slot.locked ? "bg-indigo-600 text-white" : ""}`} onClick={() => void act("human", "lock", { slot_id: slot.id, locked: !slot.locked })}>
              {slot.locked ? "locked" : "lock"}
            </button>
          )}
          <button className="rounded border px-1.5" onClick={() => setOpen((o) => !o)}>
            {slot.candidates.length} candidates
          </button>
        </div>
      </header>
      {sel ? (
        <ul className="mt-2"><CandidateCard slot={slot} c={sel} /></ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">{slot.candidates.length ? "No selection yet." : "Waiting for search_products…"}</p>
      )}
      {open && (
        <ul className="mt-2 space-y-2">
          {slot.candidates.filter((c) => c.id !== slot.selected).map((c) => <CandidateCard key={c.id} slot={slot} c={c} />)}
        </ul>
      )}
    </section>
  );
}

export default function Board() {
  const m = useMission();

  if (!m) {
    return (
      <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-zinc-500">
        <p className="text-lg">No mission yet.</p>
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
    <section className="space-y-4 text-zinc-900">
      <header className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold">{m.goal}</h2>
          <button className="flex-none rounded border px-2 py-0.5 text-xs text-zinc-600" onClick={() => clearMission()} title="Start a fresh board; this mission stays reachable at ?m=id">
            New mission
          </button>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-zinc-500">Budget</dt>
          <dd><BudgetEditor cents={m.budget_total_cents} currency={m.currency} /></dd>
          <dt className="text-zinc-500">Owned</dt>
          <dd>{m.owned_items.join(", ") || "—"}</dd>
          <dt className="text-zinc-500">Constraints</dt>
          <dd className="col-span-3">{m.constraints.join(" · ") || "—"}</dd>
        </dl>
        {m.budget_total_cents != null && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-zinc-600">
              <span>{money(t.selected_cents, m.currency)} selected across {t.merchants} merchant{t.merchants === 1 ? "" : "s"}</span>
              <span className={t.over_budget ? "font-semibold text-red-600" : ""}>{t.over_budget ? `${money(-t.remaining_cents!, m.currency)} over` : `${money(t.remaining_cents, m.currency)} left`}</span>
            </div>
            <div className="mt-1 h-2 w-full rounded bg-zinc-100"><div className={`h-2 rounded ${t.over_budget ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} /></div>
          </div>
        )}
      </header>

      {m.slots.length === 0 ? (
        <p className="text-sm text-zinc-500">Slots appear once the agent calls plan_kit.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">{m.slots.map((s) => <SlotCard key={s.id} slot={s} />)}</div>
      )}

      {carts.length > 0 && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <h3 className="font-semibold">Checkout — one cart per merchant</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {carts.map((c) => (
              <li key={c.merchant_domain} className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
                <div className="font-medium">{c.merchant_domain}</div>
                <div className="text-xs text-zinc-500">{c.lines.map((l) => l.title).join(", ")}</div>
                <div className="mt-1 font-semibold">{money(c.total_cents, c.currency)}</div>
                {c.checkout_url ? (
                  <a className="mt-2 inline-block rounded bg-zinc-900 px-3 py-1 text-white" href={c.checkout_url} target="_blank" rel="noreferrer">Open checkout</a>
                ) : (
                  <div className="mt-2 text-xs text-red-600">{c.error ?? "no checkout URL"}</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="text-xs text-zinc-500">
        <summary>Event log ({m.events.length}) · v{m.version}</summary>
        <ul className="mt-1 font-mono">{m.events.map((e) => <li key={e.seq}>#{e.seq} {e.actor} {e.type} {e.detail ? JSON.stringify(e.detail).slice(0, 120) : ""}</li>)}</ul>
      </details>
    </section>
  );
}

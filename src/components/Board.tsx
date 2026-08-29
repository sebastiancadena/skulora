"use client";

import { useEffect, useState } from "react";
import { hydrate, useMission, update } from "@/lib/mission/store";

function money(cents?: number, currency = "USD") {
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
        if (Number.isFinite(c) && c >= 0) update("human", "budget_changed", (x) => (x ? { ...x, budget_total_cents: c } : x), { budget_total_cents: c });
        setEditing(false);
      }}
    >
      <input className="w-24 rounded border px-1 text-sm" type="number" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="Budget in dollars" />
      <button className="rounded border px-1.5 text-xs" type="submit">save</button>
      <button className="rounded border px-1.5 text-xs" type="button" onClick={() => setEditing(false)}>cancel</button>
    </form>
  );
}

export default function Board() {
  const m = useMission();
  useEffect(() => { hydrate(); }, []);

  if (!m) {
    return (
      <section className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500">
        <p className="text-lg">No mission yet.</p>
        <p className="mt-2 text-sm">
          Ask your agent: <em>“Outfit me for a 3-day desert backpacking trip, budget $600, I already own a stove.”</em>
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="rounded-xl border border-zinc-200 p-4">
        <h2 className="text-xl font-semibold">{m.goal}</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-zinc-500">Budget</dt>
          <dd>
            <BudgetEditor cents={m.budget_total_cents} currency={m.currency} />
          </dd>
          <dt className="text-zinc-500">Owned</dt>
          <dd>{m.owned_items.join(", ") || "—"}</dd>
          <dt className="text-zinc-500">Constraints</dt>
          <dd className="col-span-3">{m.constraints.join(" · ") || "—"}</dd>
        </dl>
      </header>
      <div className="text-sm text-zinc-500">
        {m.slots.length === 0 ? "Slots appear once the agent calls plan_kit." : `${m.slots.length} slots`}
      </div>
      <details className="text-xs text-zinc-500">
        <summary>Event log ({m.events.length})</summary>
        <ul className="mt-1 font-mono">
          {m.events.map((e) => (
            <li key={e.seq}>
              #{e.seq} {e.actor} {e.type}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

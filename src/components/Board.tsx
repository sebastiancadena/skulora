"use client";

import { useMission, update } from "@/lib/mission/store";

function money(cents?: number, currency = "USD") {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export default function Board() {
  const m = useMission();

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
            {money(m.budget_total_cents, m.currency)}{" "}
            <button
              className="ml-2 rounded border px-1.5 text-xs"
              onClick={() => {
                const v = prompt("New budget (USD)", String((m.budget_total_cents ?? 0) / 100));
                if (v) update("human", "budget_changed", (x) => (x ? { ...x, budget_total_cents: Math.round(Number(v) * 100) } : x), { budget_total_cents: Math.round(Number(v) * 100) });
              }}
            >
              edit
            </button>
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

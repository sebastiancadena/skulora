import AgentPanel from "@/components/AgentPanel";
import Board from "@/components/Board";
import WebMCPTools from "@/components/WebMCPTools";
import { Lockup } from "@/lib/brand/Mark";
import { TAGLINE } from "@/lib/brand/tokens";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 text-ink sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="m-0">
            <Lockup height={40} />
          </h1>
          <p className="hidden text-sm text-ink-muted sm:block">
            {TAGLINE} — a shared board where you and your agent plan together.
          </p>
        </div>
        <WebMCPTools />
      </header>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Board />
        <AgentPanel />
      </div>
    </main>
  );
}

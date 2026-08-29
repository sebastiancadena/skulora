import Board from "@/components/Board";
import WebMCPTools from "@/components/WebMCPTools";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Skulora <span className="font-normal text-zinc-500">Outfitter</span>
          </h1>
          <p className="text-sm text-zinc-600">Outfit any mission across every store — a shared board where you and your agent plan together.</p>
        </div>
        <WebMCPTools />
      </header>
      <Board />
    </main>
  );
}

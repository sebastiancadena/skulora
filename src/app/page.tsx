import Board from "@/components/Board";
import WebMCPTools from "@/components/WebMCPTools";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Outfitter</h1>
          <p className="text-sm text-zinc-500">A shared board where you and your agent plan a shopping mission across every Shopify merchant.</p>
        </div>
        <WebMCPTools />
      </header>
      <Board />
    </main>
  );
}

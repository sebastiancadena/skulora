# Outfitter

A shared planning board where a person and their agent plan a shopping **mission** together — *"outfit me for a 3-day desert backpacking trip, under $600, I already own a stove"* — across every Shopify merchant, ending in one real checkout link per merchant.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/). Every capability the agent uses is a tool this page registers with `document.modelContext.registerTool(...)`.

## Try it (judges)

1. Open the live URL in **ChatGPT's desktop browser** (GPT-5.6 Sol/Terra) or in **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled. The status chip top-right turns green when tools are registered.
2. Ask the agent: *"Outfit me for a 3-day desert backpacking trip. Budget $600. I already own a stove and a headlamp. I run hot at night."*
3. Watch the board fill; **lock** or **reject** items; ask the agent to re-plan — it sees your edits in `mission_delta`.
4. Chrome: DevTools → Application → **WebMCP** shows the tools and the invocation log.

No login. Carts are created on real merchants but nothing is purchased.

## Develop

```bash
pnpm install
cp .env.example .env.local   # add an LLM key
pnpm dev
pnpm probe --carts           # re-runs the merchant/Global Catalog checks → evidence.json
```

## How WebMCP is used

See `src/lib/webmcp/tools.ts` (tool table, one source of truth for the browser surface and the built-in agent) and `src/components/WebMCPTools.tsx` (registration with `AbortController` cleanup).

## License

MIT — see `LICENSE`. Third-party material: `THIRD_PARTY.md`.

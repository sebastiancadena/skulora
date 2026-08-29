# Skulora Outfitter

**Outfit any mission across every store.** A shared planning board where a person and their agent plan a shopping **mission** together — *"outfit me for a 3-day desert backpacking trip, under $600, I already own a stove"* — across every Shopify merchant, ending in one real checkout link per merchant.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/). Every capability the agent uses is a tool this page registers with `document.modelContext.registerTool(...)`.

## Try it (judges)

1. Open **<https://outfitter.skulora.com**> in **ChatGPT's desktop browser** (GPT-5.6 Sol/Terra) or in **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled. The status chip top-right turns green when tools are registered.
2. Ask the agent: *"Outfit me for a 3-day desert backpacking trip. Budget $600. I already own a stove and a headlamp. I run hot at night."*
3. Watch the board fill: the agent plans slots, searches real Shopify merchants for each, chooses with a reason, and prepares one real checkout per merchant.
4. **Lock** an item you want to keep, **reject** one you don't, then tell the agent *"I changed some things — re-plan within budget."* Every tool result carries `mission_delta`, so it sees your edits.
5. Chrome: DevTools → Application → **WebMCP** shows the tools (they appear in stages as the mission advances) and the invocation log.

No login. Carts are created on real merchants but nothing is purchased; you complete checkout yourself. Any browser without WebMCP can use the built-in agent panel — same tools.

## Develop

```bash
pnpm install
cp .env.example .env.local   # add an LLM key
pnpm dev
pnpm probe --carts           # re-runs the merchant/Global Catalog checks → evidence.json
```

## How WebMCP is used

- `src/lib/webmcp/tools.ts` — the tool table (one source of truth for the browser surface and the built-in agent): Stage A `get_mission`, `create_mission`, `set_budget`; Stage B `plan_kit`, `search_products`, `choose_candidate`; Stage C `prepare_checkout`, `get_checkout_status`. Read-only tools carry `readOnlyHint`; merchant-content tools carry `untrustedContentHint`. Every result ends with `mission_delta` (the person's edits since that agent's last call) and `next_suggested_tools`.
- `src/components/WebMCPTools.tsx` — `document.modelContext.registerTool(...)` with `AbortController` cleanup, re-registered per stage so agents see new tools via `toolchange`.
- `src/app/api/missions/**` — server-side missions (Upstash Redis, compare-and-set writes because agents call tools in parallel); `src/lib/mission/{planner,search,checkout}.ts` — planning, cross-merchant search over Shopify's Global Catalog MCP + Storefront MCP with LLM re-ranking, and real carts.
- `src/app/api/agent/route.ts` + `src/components/AgentPanel.tsx` — the built-in agent, driving the identical tools for browsers without WebMCP.

## License

MIT — see `LICENSE`. Third-party material: `THIRD_PARTY.md`.

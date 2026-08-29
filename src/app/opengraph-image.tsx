import { ImageResponse } from "next/og";
import { Mark } from "@/lib/brand/Mark";
import { brand, PRODUCT_NAME, TAGLINE } from "@/lib/brand/tokens";
import harness from "../../harness.json";
import evidence from "../../evidence.json";

export const alt = `${PRODUCT_NAME} — ${TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Every number on the card comes from the checked-in harness/probe output, never typed.
const run = harness[0];
const merchantsOk = evidence.merchants.filter((m) => m.ok).length;
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function OpenGraphImage() {
  const stats = [
    [`${run.slots.length}`, "slots planned"],
    [`${run.totals.merchants}`, "merchants, one board"],
    [`${money(run.totals.selected_cents)} / ${money(run.totals.budget_total_cents)}`, "under budget"],
    [`${merchantsOk}/${evidence.merchants.length}`, "real checkouts probed"],
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: brand.paper, color: brand.ink, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <Mark px={112} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2, lineHeight: 1 }}>Skulora</div>
            <div style={{ fontSize: 26, letterSpacing: 6, color: brand.inkMuted, marginTop: 10 }}>OUTFITTER</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 40, lineHeight: 1.25 }}>
          <div style={{ fontWeight: 600 }}>{`${TAGLINE}.`}</div>
          <div style={{ color: brand.inkMuted }}>A shared board where you and your agent plan together.</div>
          <div style={{ color: brand.pine, fontWeight: 700, fontSize: 30, marginTop: 8, letterSpacing: 1 }}>BUILT ON WEBMCP</div>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {stats.map(([n, label]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", flex: 1, padding: "18px 22px", borderRadius: 16, background: "#fff", border: `2px solid ${brand.pine}22` }}>
              <div style={{ fontSize: 34, fontWeight: 700, color: brand.pine }}>{n}</div>
              <div style={{ fontSize: 20, color: brand.inkMuted }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}

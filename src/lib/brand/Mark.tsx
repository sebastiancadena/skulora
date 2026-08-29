import { brand } from "./tokens";

/**
 * The Skulora mark: a pine badge with a dashed route through three waypoints ending in an
 * ochre pin. Geometry lives here and nowhere else; favicons, the OG card and the header all
 * render this component. `size="small"` drops the contour lines and the first waypoint so the
 * mark stays legible at 16–32 px.
 */
export function Mark({ size = "large", px = 64, title = "Skulora" }: { size?: "small" | "large"; px?: number; title?: string }) {
  const small = size === "small";
  return (
    <svg width={px} height={px} viewBox="0 0 64 64" role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="14" fill={brand.pine} />
      {!small && (
        <g fill="none" stroke={brand.paper} strokeOpacity="0.16" strokeWidth="1.5">
          <path d="M-2 26 C 14 16, 26 30, 40 22 S 60 12, 68 18" />
          <path d="M-2 56 C 12 46, 30 62, 46 50 S 60 44, 68 50" />
        </g>
      )}
      {/* the route: one cubic from the first waypoint to the pin's tip; waypoints sit on the curve */}
      <path
        d="M13 50 C 20 34, 30 48, 45 38"
        fill="none"
        stroke={brand.paper}
        strokeWidth={small ? 2.6 : 2}
        strokeDasharray={small ? "4 3.5" : "3.5 3"}
        strokeOpacity="0.9"
      />
      <g fill={brand.paper}>
        <circle cx="13" cy="50" r={small ? 4.5 : 3.6} />
        {!small && <circle cx="21.5" cy="41.8" r="3.2" />}
        {!small && <circle cx="32.8" cy="41.3" r="3.2" />}
      </g>
      <g fill={brand.pine}>
        <circle cx="13" cy="50" r={small ? 1.8 : 1.4} />
        {!small && <circle cx="21.5" cy="41.8" r="1.2" />}
        {!small && <circle cx="32.8" cy="41.3" r="1.2" />}
      </g>
      <path d="M45 8c-6.6 0-12 5.2-12 11.6C33 27.6 45 38 45 38s12-10.4 12-18.4C57 13.2 51.6 8 45 8z" fill={brand.ochre} />
      <circle cx="45" cy="19.6" r={small ? 4.2 : 3.8} fill={brand.pine} />
    </svg>
  );
}

/** Mark + wordmark, for the site header, README and the video. */
export function Lockup({ height = 32 }: { height?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5" style={{ height }}>
      <Mark px={height} />
      <span className="flex flex-col leading-none">
        <span className="font-semibold tracking-tight text-ink" style={{ fontSize: height * 0.62 }}>
          Skulora
        </span>
        <span className="font-mono uppercase tracking-[0.18em] text-ink-muted" style={{ fontSize: height * 0.3 }}>
          Outfitter
        </span>
      </span>
    </span>
  );
}

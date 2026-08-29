import type { NextConfig } from "next";

// Canonical host is outfitter.skulora.com; the apex and www redirect there.
const CANONICAL = "outfitter.skulora.com";

const nextConfig: NextConfig = {
  async redirects() {
    return ["skulora.com", "www.skulora.com"].map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `https://${CANONICAL}/:path*`,
      permanent: false, // 307 for now; flip to true once the domain is final
    }));
  },
};

export default nextConfig;

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PRODUCT_NAME, TAGLINE } from "@/lib/brand/tokens";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "A shared board where you and your agent plan a shopping mission across every Shopify merchant, ending in one real checkout per merchant. Built on WebMCP.";

export const metadata: Metadata = {
  metadataBase: new URL("https://outfitter.skulora.com"),
  title: { default: `${PRODUCT_NAME} — ${TAGLINE}`, template: `%s · ${PRODUCT_NAME}` },
  description,
  applicationName: PRODUCT_NAME,
  openGraph: { type: "website", siteName: PRODUCT_NAME, title: `${PRODUCT_NAME} — ${TAGLINE}`, description, url: "https://outfitter.skulora.com" },
  twitter: { card: "summary_large_image", title: `${PRODUCT_NAME} — ${TAGLINE}`, description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

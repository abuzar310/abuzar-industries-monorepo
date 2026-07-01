import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import "@/globals.css";
import AppProvider from "@/store/AppProvider";
import { TABS, FEATURES } from "../app-config";

const serif = Fraunces({ subsets: ["latin"], axes: ["opsz", "SOFT"], variable: "--font-serif" });
const ui = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-ui" });
const mono = Spline_Sans_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Timber Books — Quotations & Daybook",
  description: "Timber quotations, customers and daily cash book — offline-first, cloud-synced.",
  manifest: "/manifest.webmanifest",
  // No Abuzar branding on the unofficial (Vanya Timber) app — use the browser default icon.
};

export const viewport: Viewport = { themeColor: "#5A3D24" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${serif.variable} ${ui.variable} ${mono.variable}`}>
      <body>
        <AppProvider tabs={TABS} features={FEATURES}>{children}</AppProvider>
      </body>
    </html>
  );
}

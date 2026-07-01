import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import "@/globals.css";
import AppProvider from "@/store/AppProvider";
import { TABS, FEATURES } from "../app-config";

const serif = Fraunces({ subsets: ["latin"], axes: ["opsz", "SOFT"], variable: "--font-serif" });
const ui = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-ui" });
const mono = Spline_Sans_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Abuzar Industries — Quotation & Invoice",
  description: "Timber quotations, invoices, customers and stock — offline-first, cloud-synced.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export const viewport: Viewport = { themeColor: "#5A3D24" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${serif.variable} ${ui.variable} ${mono.variable}`}>
      <body>
        <AppProvider tabs={TABS} features={FEATURES} defaultBrand="real">{children}</AppProvider>
      </body>
    </html>
  );
}

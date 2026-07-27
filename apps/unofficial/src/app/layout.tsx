import type { Metadata, Viewport } from "next";
import { Poppins, Open_Sans, Space_Mono } from "next/font/google";
import "@/globals.css";
import AppProvider from "@/store/AppProvider";
import { TABS, FEATURES } from "../app-config";

const heading = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-heading",
});

const body = Open_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-body",
});

const mono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Cut Size Wood — Quotations & Daybook",
  description: "Cut-size wood quotations, customers and daily cash book — offline-first, cloud-synced.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#1E293B" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${heading.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <AppProvider tabs={TABS} features={FEATURES}>{children}</AppProvider>
      </body>
    </html>
  );
}
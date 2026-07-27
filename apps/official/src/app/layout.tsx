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
  title: "Abuzar Industries — Quotation & Invoice",
  description: "Timber quotations, invoices, customers and stock — offline-first, cloud-synced.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export const viewport: Viewport = { themeColor: "#1E293B" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${heading.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <AppProvider tabs={TABS} features={FEATURES} defaultBrand="real">{children}</AppProvider>
      </body>
    </html>
  );
}

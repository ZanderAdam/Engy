import { Suspense } from "react";
import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { TabShell } from "@/components/tabs/tab-shell";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Engy",
  description: "Engineering workspace manager",
};

// RootLayout intentionally ignores `children` from Next.js routing —
// TabShell owns rendering for every tab via virtualPath dispatch (see tab-content.tsx).
// The page.tsx components are never mounted, so their hooks/queries don't run.
export default function RootLayout() {
  return (
    <html lang="en" className={jetbrainsMono.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          <div className="flex h-screen flex-col overflow-hidden">
            <Suspense>
              <TabShell />
            </Suspense>
          </div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}

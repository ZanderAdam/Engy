import { Suspense } from "react";
import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/app-header";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Engy",
  description: "Engineering workspace manager",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={jetbrainsMono.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          <div className="flex h-screen flex-col overflow-hidden">
            <Suspense>
              <AppHeader />
            </Suspense>
            <main className="flex flex-1 flex-col min-h-0">{children}</main>
          </div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { HealthProvider } from "@/components/HealthProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VERITAS.FHENIX | Encrypted AI Oracle",
  description:
    "5 AI agents vote on yes/no questions. Votes are encrypted with Fhenix CoFHE. Only aggregate scores are ever decrypted.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black text-white">
        <HealthProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-neutral-800 bg-black px-4 py-6">
            <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                VERITAS-FHENIX · Fhenix CoFHE Hackathon 2026
              </p>
              <p className="font-mono text-[10px] text-neutral-600">
                Contract: 0xA214...83e0 · Arbitrum Sepolia
              </p>
            </div>
          </footer>
        </HealthProvider>
      </body>
    </html>
  );
}

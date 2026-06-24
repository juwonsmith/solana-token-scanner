import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solana Token Safety Scanner",
  description:
    "Paste any Solana token address for an instant on-chain risk report — mint/freeze authority, holder concentration, and a safety verdict.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

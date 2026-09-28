import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Catch — Borrow USDC against PreStocks",
  description:
    "Over-collateralized lending for tokenized pre-IPO stocks on Solana. A Stability Pool catches liquidations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

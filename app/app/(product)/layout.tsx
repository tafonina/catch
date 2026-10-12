import type { Metadata } from "next";
import { Providers } from "../providers";

export const metadata: Metadata = {
  title: "Catch — Markets",
  description: "Isolated PreStocks markets. Credit is capped by the bid book in that pool.",
};

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}

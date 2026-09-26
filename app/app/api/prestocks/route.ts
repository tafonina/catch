import { NextResponse } from "next/server";
import type { PreStock } from "@/lib/prestocks";

const FALLBACK: PreStock[] = [
  {
    name: "SpaceX PreStocks",
    symbol: "SPACEX",
    description: "SpaceX PreStocks",
    image: "https://www.prestocks.com/logos/spacex.png",
    external_url: "https://www.prestocks.com/spacex",
    contract_address: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
    markPrice: 154.07,
    tokenPrice: 121.09,
    impliedValuation: 1_587_619_326_925,
    markValuation: 2_020_057_453_517,
    supply: 43712,
  },
];

export async function GET() {
  try {
    const res = await fetch("https://prestocks.com/api/prestocks", {
      next: { revalidate: 30 },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as PreStock[];
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(FALLBACK);
  }
}

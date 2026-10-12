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

function num(value: unknown, fallback = 0) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : fallback;
}

function normalize(row: Partial<PreStock>): PreStock {
  const markPrice = num(row.markPrice);
  return {
    name: row.name ?? row.symbol ?? "PreStock",
    symbol: row.symbol ?? "UNKNOWN",
    description: row.description ?? "",
    image: row.image ?? "",
    external_url: row.external_url ?? "",
    contract_address: row.contract_address ?? "",
    markPrice,
    // PreStocks currently ships tokenPrice/impliedValuation as null.
    tokenPrice: num(row.tokenPrice, markPrice),
    impliedValuation: num(row.impliedValuation),
    markValuation: num(row.markValuation),
    supply: num(row.supply),
  };
}

export async function GET() {
  try {
    const res = await fetch("https://prestocks.com/api/prestocks", {
      next: { revalidate: 30 },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as Partial<PreStock>[];
    return NextResponse.json(data.map(normalize));
  } catch {
    return NextResponse.json(FALLBACK);
  }
}

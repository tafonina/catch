import { NextRequest, NextResponse } from "next/server";
import { PYTH_APPLE } from "@/lib/prestocks";

type HermesPrice = {
  id: string;
  price?: { price: string; expo: number; conf?: string };
};

function toNumber(update: HermesPrice | undefined) {
  if (!update?.price) return null;
  const price = Number(update.price.price);
  const expo = Number(update.price.expo);
  if (!Number.isFinite(price) || !Number.isFinite(expo)) return null;
  return price * 10 ** expo;
}

function hermesHeaders(): HeadersInit {
  const apiKey = process.env.PYTH_API_KEY;
  const headers: HeadersInit = { accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

const HERMES_BASE =
  process.env.PYTH_HERMES_URL ?? "https://pyth.dourolabs.app/hermes";

export async function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams.getAll("id");
  const query = req.nextUrl.searchParams.get("query");

  try {
    if (query) {
      const res = await fetch(
        `${HERMES_BASE}/v2/price_feeds?query=${encodeURIComponent(query)}`,
        { headers: hermesHeaders(), next: { revalidate: 300 } },
      );
      if (!res.ok) throw new Error(`Hermes ${res.status}`);
      return NextResponse.json(await res.json());
    }

    const feedIds =
      ids.length > 0
        ? ids
        : [PYTH_APPLE.equity.id, PYTH_APPLE.xstock.id, PYTH_APPLE.ondo.id];
    const qs = feedIds.map((id) => `ids[]=${id}`).join("&");
    const res = await fetch(`${HERMES_BASE}/v2/updates/price/latest?${qs}`, {
      headers: hermesHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Hermes ${res.status}`);
    const body = await res.json();
    const parsed = (body.parsed as HermesPrice[] | undefined)?.map((p) => ({
      id: p.id,
      price: toNumber(p),
    }));
    return NextResponse.json({
      source: "pyth",
      parsed,
    });
  } catch (error) {
    return NextResponse.json({
      source: "unavailable",
      error: "Pyth Hermes unavailable. Set PYTH_API_KEY in app/.env.local",
      fallback: [
        { symbol: PYTH_APPLE.equity.symbol, id: PYTH_APPLE.equity.id, price: null },
        { symbol: PYTH_APPLE.xstock.symbol, id: PYTH_APPLE.xstock.id, price: null },
        { symbol: PYTH_APPLE.ondo.symbol, id: PYTH_APPLE.ondo.id, price: null },
      ],
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
}

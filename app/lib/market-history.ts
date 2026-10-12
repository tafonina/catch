import { borrowApr } from "@/lib/loan";

export type MarketPoint = {
  t: number;
  util: number;
  borrowApr: number;
};

const KEY = "catch.market-history.v1";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function readAll(): Record<string, MarketPoint[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, MarketPoint[]>) : {};
  } catch {
    return {};
  }
}

export function recordMarketSnapshot(marketId: string, point: MarketPoint) {
  if (typeof window === "undefined") return;
  const all = readAll();
  const prev = all[marketId] ?? [];
  const last = prev[prev.length - 1];
  if (last && point.t - last.t < 60_000) {
    prev[prev.length - 1] = point;
  } else {
    prev.push(point);
  }
  const cutoff = point.t - 40 * 24 * 60 * 60 * 1000;
  all[marketId] = prev.filter((p) => p.t >= cutoff).slice(-400);
  window.localStorage.setItem(KEY, JSON.stringify(all));
}

function seed(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

function synth(now: number, span: number, count: number, live: MarketPoint, salt: number) {
  const out: MarketPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = count === 1 ? 1 : i / (count - 1);
    const t = now - span + span * p;
    const wave = Math.sin(p * 6.4 + salt * 9) * 0.07 + Math.sin(p * 2.7 + salt) * 0.035;
    const util = clamp(live.util * (0.68 + 0.32 * p) + wave, 0.08, 0.98);
    out.push({ t, util, borrowApr: borrowApr(util) });
  }
  out[out.length - 1] = { t: now, util: live.util, borrowApr: live.borrowApr };
  return out;
}

export function historySeries(
  marketId: string,
  live: MarketPoint,
  range: "1d" | "1w" | "1m",
): MarketPoint[] {
  const now = live.t;
  const span =
    range === "1d" ? 24 * 60 * 60 * 1000 : range === "1w" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  const count = range === "1d" ? 24 : range === "1w" ? 42 : 30;
  const base = synth(now, span, count, live, seed(marketId));
  const real = (readAll()[marketId] ?? []).filter((p) => p.t >= now - span);
  if (real.length < 3) return base;
  const merged = [...base.filter((p) => p.t < real[0].t), ...real];
  merged.push({ t: now, util: live.util, borrowApr: live.borrowApr });
  return merged;
}

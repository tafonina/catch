export type MarketTab = "lend" | "borrow" | "stability" | "details";

export type IsolatedMarket = {
  id: string;
  quote: string;
  base: string;
  live: boolean;
};

export const ISOLATED_MARKETS: IsolatedMarket[] = [
  { id: "anthropic", quote: "USDC", base: "ANTHROPIC", live: true },
  { id: "openai", quote: "USDC", base: "OPENAI", live: false },
  { id: "spacex", quote: "USDC", base: "SPACEX", live: false },
];

export function marketLabel(market: IsolatedMarket) {
  return `${market.quote} / ${market.base}`;
}

export function liveMarket() {
  return ISOLATED_MARKETS.find((m) => m.live) ?? ISOLATED_MARKETS[0];
}

export type PreStock = {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url: string;
  contract_address: string;
  markPrice: number;
  tokenPrice: number;
  impliedValuation: number;
  markValuation: number;
  supply: number;
};

export const PYTH_COMPS: Record<
  string,
  { label: string; equity: string; xstock?: string; ondo?: string }
> = {
  SPACEX: { label: "TSLA", equity: "Equity.US.TSLA/USD" },
  OPENAI: { label: "NVDA", equity: "Equity.US.NVDA/USD" },
  ANTHROPIC: { label: "MSFT", equity: "Equity.US.MSFT/USD" },
  ANDURIL: { label: "LMT", equity: "Equity.US.LMT/USD" },
  NEURALINK: { label: "TSLA", equity: "Equity.US.TSLA/USD" },
  FIGUREAI: { label: "TSLA", equity: "Equity.US.TSLA/USD" },
  KALSHI: { label: "SPY", equity: "Equity.US.SPY/USD" },
  POLYMARKET: { label: "SPY", equity: "Equity.US.SPY/USD" },
};

/** Day-0 restricted oracle (Pyth Index exists, key tier cannot read it). */
export const RESTRICTED_ORACLE = {
  marketClass: "Restricted",
  anthropicFeed: "5da511a7c68b17a3bc94380cab4756bc83ab87f86307af10ea58467a64b6689d",
  anthropicSymbol: "Equity.Index.ANTHROPIC/USD",
  dexPool: "EZyszDEx1LZDt7TsSFV8xdPi49sDKC3mdfv2MVMEQLtU",
  postedDepthUsd: 171_258,
  stalenessSec: 300,
};

export const PYTH_APPLE = {
  equity: {
    symbol: "Equity.US.AAPL/USD",
    id: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  },
  xstock: {
    symbol: "Crypto.AAPLX/USD",
    id: "978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675",
  },
  ondo: {
    symbol: "Crypto.AAPLON/USD",
    id: "e6734de88a83d9d2fb33072adab319004700aefd069653aba30ba9e3cac056f2",
  },
};

export async function fetchPreStocks(): Promise<PreStock[]> {
  const res = await fetch("/api/prestocks", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load PreStocks");
  return res.json();
}

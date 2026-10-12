export type LoanStateId =
  | "chad"
  | "anxious"
  | "mcpepe"
  | "liquidatable"
  | "rekt";

export type LoanState = {
  id: LoanStateId;
  name: string;
  status: string;
  risk: string;
  liquidation: string;
  image: string;
  emoji: string;
  glow: string;
  minLtv: number;
  maxLtv: number;
};

/** Restricted-mode risk params (Day-0: no readable Pyth Index). */
export const MAX_BORROW_LTV = 0.3;
export const LIQUIDATION_LTV = 0.4;
/** Slider can preview LTV up to liquidation so the cNFT morphs. Borrow stays capped at 30%. */
export const PREVIEW_MAX_LTV = LIQUIDATION_LTV;
export const LIQUIDATION_BONUS = 0.1;
/** Display fallback; live rate is the kinked curve (10% → 15% @ 80% → 30%). */
export const BORROW_APR = 0.15;
export const RATE_BASE = 0.1;
export const RATE_KINK = 0.15;
export const RATE_MAX = 0.3;
export const RATE_KINK_UTIL = 0.8;
export const RESERVE_FACTOR = 0.1;
export const SENIOR_FLOOR = 0.05;

export function borrowApr(utilization: number) {
  const u = Math.min(1, Math.max(0, utilization));
  if (u <= RATE_KINK_UTIL) {
    return RATE_BASE + (u / RATE_KINK_UTIL) * (RATE_KINK - RATE_BASE);
  }
  return RATE_KINK + ((u - RATE_KINK_UTIL) / (1 - RATE_KINK_UTIL)) * (RATE_MAX - RATE_KINK);
}

/** Matches on-chain `borrow_rate_bps` + `split_interest` (reserve 10%, senior floor 5%). */
export function marketYields(params: { borrowed: number; senior: number; book: number }) {
  const senior = Math.max(0, params.senior);
  const borrowed = Math.max(0, params.borrowed);
  const book = Math.max(0, params.book);
  const util = senior > 0 ? Math.min(1, borrowed / senior) : 0;
  const borrow = borrowApr(util);
  const gross = borrow * borrowed;
  const reserve = gross * RESERVE_FACTOR;
  const net = Math.max(0, gross - reserve);
  if (borrowed <= 0 || net <= 0) {
    return {
      util,
      borrowApr: borrow,
      depositApr: 0,
      bidApr: 0,
      reserveApr: borrow * RESERVE_FACTOR,
      gross: 0,
      reserve: 0,
      net: 0,
      seniorCut: 0,
      juniorCut: 0,
    };
  }
  const uSenior = borrowed / Math.max(senior, 1e-9);
  const uJunior = borrowed / Math.max(book, 1e-9);
  const den = uSenior + uJunior;
  const scarcitySenior = den > 0 ? (net * uSenior) / den : net;
  const seniorCut = Math.min(net, Math.max(scarcitySenior, net * SENIOR_FLOOR));
  const juniorCut = book > 0 ? net - seniorCut : 0;
  return {
    util,
    borrowApr: borrow,
    depositApr: senior > 0 ? seniorCut / senior : 0,
    bidApr: book > 0 ? juniorCut / book : 0,
    reserveApr: borrow * RESERVE_FACTOR,
    gross,
    reserve,
    net,
    seniorCut,
    juniorCut,
  };
}

export function formatAprPct(rate: number, digits = 1) {
  return `${(rate * 100).toFixed(digits)}%`;
}

export type BidRow = {
  owner: string;
  usdc: number;
  discountBps: number;
};

/** Price–time prefix that still covers outstanding debt cannot leave the book. */
export function engageBids(rows: BidRow[], borrowed: number) {
  let covered = 0;
  return rows.map((row) => {
    const engaged = covered >= borrowed ? 0 : Math.min(row.usdc, borrowed - covered);
    covered += row.usdc;
    return { ...row, engaged, free: Math.max(0, row.usdc - engaged) };
  });
}

/** @deprecated use MAX_BORROW_LTV */
export const MAX_LTV = MAX_BORROW_LTV;
export const LEND_APY = BORROW_APR;

/**
 * Restricted-mode NFT bands. Borrowing stops at 30% (top of Chad). Anxious / McPepe
 * are only reachable after a price drop. LTV ≥ 40% while the loan is still open is
 * liquidatable — not yet liquidated. Rekt is only after on-chain liquidation.
 *
 *   Chad          < 30%
 *   Anxious       30–35%
 *   McPepe        35–40%
 *   Liquidatable  ≥ 40% and position still Active
 *   Rekt          position status Liquidated
 */
export const LOAN_STATES: LoanState[] = [
  {
    id: "chad",
    name: "Chad VC",
    status: "Chad Investor",
    risk: "Extremely Low",
    liquidation: "None",
    image: "/nft/chad-vc.png",
    emoji: "🟢",
    glow: "rgba(34,197,94,0.45)",
    minLtv: 0,
    maxLtv: 0.3,
  },
  {
    id: "anxious",
    name: "Anxious Trader",
    status: "Leveraged Degenerate",
    risk: "Medium",
    liquidation: "Moderate",
    image: "/nft/anxious-trader.png",
    emoji: "🟡",
    glow: "rgba(234,179,8,0.45)",
    minLtv: 0.3,
    maxLtv: 0.35,
  },
  {
    id: "mcpepe",
    name: "McPepe",
    status: "Margin Call Imminent",
    risk: "High",
    liquidation: "Immediate",
    image: "/nft/mcpepe.png",
    emoji: "🔴",
    glow: "rgba(239,68,68,0.5)",
    minLtv: 0.35,
    maxLtv: 0.4,
  },
  {
    id: "liquidatable",
    name: "Liquidatable",
    status: "Can be liquidated",
    risk: "Critical",
    liquidation: "Available",
    image: "/nft/liquidatable.png",
    emoji: "🚨",
    glow: "rgba(249,115,22,0.55)",
    minLtv: 0.4,
    maxLtv: Number.POSITIVE_INFINITY,
  },
  {
    id: "rekt",
    name: "Rekt",
    status: "Liquidation Complete",
    risk: "Terminal",
    liquidation: "Executed",
    image: "/nft/rekt.png",
    emoji: "💀",
    glow: "rgba(148,163,184,0.35)",
    minLtv: 0.4,
    maxLtv: Number.POSITIVE_INFINITY,
  },
];

export function stateFromLtv(ltv: number): LoanState {
  if (ltv < 0.3) return LOAN_STATES[0];
  if (ltv < 0.35) return LOAN_STATES[1];
  if (ltv < 0.4) return LOAN_STATES[2];
  return LOAN_STATES[3];
}

/** Rekt only after the position is liquidated on-chain. */
export function stateForPosition(ltv: number, liquidated: boolean): LoanState {
  if (liquidated) return LOAN_STATES[4];
  return stateFromLtv(ltv);
}

export function ltvFromParts(
  borrowedUsdc: number,
  collateralAmount: number,
  price: number,
) {
  const value = collateralAmount * price;
  if (value <= 0) return 0;
  return borrowedUsdc / value;
}

export function healthFactor(ltv: number) {
  if (ltv <= 0) return Number.POSITIVE_INFINITY;
  return LIQUIDATION_LTV / ltv;
}

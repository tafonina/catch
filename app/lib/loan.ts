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
export const BORROW_APR = 0.12;

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

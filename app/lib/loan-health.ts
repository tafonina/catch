import { Connection, PublicKey } from "@solana/web3.js";
import { rpcUrl } from "@/lib/cluster";
import { LOAN_STATES, stateForPosition, type LoanState } from "@/lib/loan";
import {
  ANTHROPIC_MAINNET,
  MOCK_ANTHROPIC,
  decodeConfig,
  decodeOracle,
  decodePosition,
  globalConfigPda,
  oraclePda,
} from "@/lib/prelend";

const E18 = 1_000_000_000_000_000_000n;

export type LoanCard = {
  position: string;
  borrower: string;
  collateralMint: string;
  symbol: string;
  collateralUi: number;
  borrowedUi: number;
  price: number;
  ltv: number;
  open: boolean;
  liquidated: boolean;
  state: LoanState;
};

function symbolForMint(mint: string) {
  if (mint === MOCK_ANTHROPIC || mint === ANTHROPIC_MAINNET) return "ANTHROPIC";
  return mint.slice(0, 6);
}

function actualDebt(scaledDebt: number, borrowIndexE18: bigint) {
  if (scaledDebt <= 0) return 0n;
  return (BigInt(Math.round(scaledDebt)) * borrowIndexE18) / E18;
}

export async function readLoanCard(
  position: PublicKey,
  connection = new Connection(rpcUrl(), "confirmed"),
): Promise<LoanCard | null> {
  const posInfo = await connection.getAccountInfo(position);
  if (!posInfo) return null;
  const pos = decodePosition(posInfo.data);
  const mint = new PublicKey(pos.collateralMint);
  const [configInfo, oracleInfo, mintInfo] = await Promise.all([
    connection.getAccountInfo(globalConfigPda(mint)),
    connection.getAccountInfo(oraclePda(mint)),
    connection.getAccountInfo(mint),
  ]);
  if (!configInfo) return null;
  const config = decodeConfig(configInfo.data);
  const oracle = oracleInfo ? decodeOracle(oracleInfo.data) : null;
  const decimals = mintInfo?.data[44] ?? 9;
  const priceE6 =
    config.testModePriceE6 > 0
      ? config.testModePriceE6
      : oracle
        ? Math.min(oracle.markPriceE6, oracle.twapPriceE6)
        : 0;
  const scale = 10 ** decimals;
  const debtAtoms = actualDebt(pos.scaledDebt, config.borrowIndexE18);
  const debtUi = Number(debtAtoms) / 1e6;
  const collateralUi = pos.collateralAmount / scale;
  const valueUi = collateralUi * (priceE6 / 1e6);
  const liquidated = pos.status === 1;
  const ltv = liquidated ? 1 : valueUi > 0 ? debtUi / valueUi : 0;
  return {
    position: position.toBase58(),
    borrower: pos.borrower,
    collateralMint: pos.collateralMint,
    symbol: symbolForMint(pos.collateralMint),
    collateralUi,
    borrowedUi: debtUi,
    price: priceE6 / 1e6,
    ltv,
    open: pos.status === 0,
    liquidated,
    state: stateForPosition(ltv, liquidated),
  };
}

export function archivedCard(position: string): LoanCard {
  const state = LOAN_STATES[0];
  return {
    position,
    borrower: "",
    collateralMint: "",
    symbol: "ANTHROPIC",
    collateralUi: 0,
    borrowedUi: 0,
    price: 0,
    ltv: 1,
    open: false,
    liquidated: false,
    state,
  };
}

export function metadataJson(card: LoanCard, origin: string) {
  const { state, symbol, position } = card;
  const label = card.open ? state.status : card.liquidated ? "Liquidation Complete" : "Repaid";
  return {
    name: `Catch ${symbol} #${position.slice(0, 6)}`,
    symbol: `C-${symbol.slice(0, 4)}`,
    description: `Catch ${symbol} loan. LTV ${(card.ltv * 100).toFixed(1)}% — ${label}.`,
    image: `${origin}${state.image}`,
    external_url: `${origin}/p/${position}`,
    attributes: [
      { trait_type: "Status", value: label },
      { trait_type: "Phase", value: state.name },
      { trait_type: "Risk Level", value: state.risk },
      { trait_type: "Liquidation Risk", value: state.liquidation },
      { trait_type: "Collateral", value: symbol },
      { trait_type: "LTV", value: `${(card.ltv * 100).toFixed(2)}%` },
      { trait_type: "Collateral Amount", value: String(card.collateralUi) },
      { trait_type: "Borrowed USDC", value: card.borrowedUi.toFixed(2) },
      { trait_type: "Mark Price", value: String(card.price) },
      { trait_type: "Position", value: position },
    ],
    properties: {
      category: "image",
      files: [{ uri: `${origin}${state.image}`, type: "image/png" }],
    },
  };
}

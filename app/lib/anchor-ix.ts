import { createHash } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PRELEND_PROGRAM_ID } from "@/lib/cluster";
import { globalConfigPda, usdcVaultPda } from "@/lib/prelend";

export function anchorDisc(name: string) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function u8(n: number) {
  return Buffer.from([n & 0xff]);
}

function u16le(n: number) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

function u64le(n: bigint) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function i64le(n: bigint) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(n);
  return buf;
}

function optionU64(value: bigint | null) {
  if (value === null) return u8(0);
  return Buffer.concat([u8(1), u64le(value)]);
}

export function lenderPda(lender: PublicKey, programId = new PublicKey(PRELEND_PROGRAM_ID)) {
  return PublicKey.findProgramAddressSync([Buffer.from("lender"), lender.toBuffer()], programId)[0];
}

export function oraclePda(mint: PublicKey, programId = new PublicKey(PRELEND_PROGRAM_ID)) {
  return PublicKey.findProgramAddressSync([Buffer.from("oracle"), mint.toBuffer()], programId)[0];
}

export function stabilityPoolPda(mint: PublicKey, programId = new PublicKey(PRELEND_PROGRAM_ID)) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stability-pool"), mint.toBuffer()],
    programId,
  )[0];
}

export function spUsdcVaultPda(mint: PublicKey, programId = new PublicKey(PRELEND_PROGRAM_ID)) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sp-usdc-vault"), mint.toBuffer()],
    programId,
  )[0];
}

export function initializePoolIx(params: {
  admin: PublicKey;
  usdcMint: PublicKey;
  feeRecipient: PublicKey;
  protocolFeeBps?: number;
  maxBorrowLtvBps?: number;
  liquidationLtvBps?: number;
  liquidationBonusBps?: number;
  interestRateBps?: number;
  adminDebtCap?: bigint;
  priceStalenessSecs?: number;
  marketClass?: number;
}) {
  const programId = new PublicKey(PRELEND_PROGRAM_ID);
  const data = Buffer.concat([
    anchorDisc("initialize_pool"),
    u16le(params.protocolFeeBps ?? 50),
    u16le(params.maxBorrowLtvBps ?? 3_000),
    u16le(params.liquidationLtvBps ?? 4_000),
    u16le(params.liquidationBonusBps ?? 1_000),
    u16le(params.interestRateBps ?? 1_200),
    u64le(params.adminDebtCap ?? BigInt(25_000) * BigInt(1_000_000)),
    i64le(BigInt(params.priceStalenessSecs ?? 300)),
    u8(params.marketClass ?? 0),
  ]);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: params.feeRecipient, isSigner: false, isWritable: false },
      { pubkey: globalConfigPda(programId), isSigner: false, isWritable: true },
      { pubkey: usdcVaultPda(programId), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function resetPoolIx(params: {
  admin: PublicKey;
  usdcMint: PublicKey;
  adminUsdc: PublicKey;
  leftover?: PublicKey[];
}) {
  const programId = new PublicKey(PRELEND_PROGRAM_ID);
  const leftover = (params.leftover ?? []).map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: true,
  }));
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: globalConfigPda(programId), isSigner: false, isWritable: true },
      { pubkey: usdcVaultPda(programId), isSigner: false, isWritable: true },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: params.adminUsdc, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...leftover,
    ],
    data: anchorDisc("reset_pool"),
  });
}

export function depositLiquidityIx(params: {
  lender: PublicKey;
  usdcMint: PublicKey;
  lenderUsdc: PublicKey;
  amount: bigint;
}) {
  const programId = new PublicKey(PRELEND_PROGRAM_ID);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.lender, isSigner: true, isWritable: true },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: globalConfigPda(programId), isSigner: false, isWritable: true },
      { pubkey: params.lenderUsdc, isSigner: false, isWritable: true },
      { pubkey: usdcVaultPda(programId), isSigner: false, isWritable: true },
      { pubkey: lenderPda(params.lender, programId), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([anchorDisc("deposit_liquidity"), u64le(params.amount)]),
  });
}

export function updateOracleIx(params: {
  admin: PublicKey;
  mint: PublicKey;
  markPriceE6?: bigint;
  twapPriceE6?: bigint;
}) {
  const programId = new PublicKey(PRELEND_PROGRAM_ID);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: globalConfigPda(programId), isSigner: false, isWritable: false },
      { pubkey: oraclePda(params.mint, programId), isSigner: false, isWritable: true },
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDisc("update_oracle"),
      optionU64(params.markPriceE6 ?? null),
      optionU64(params.twapPriceE6 ?? null),
    ]),
  });
}

export function updateDepthIx(params: { admin: PublicKey; postedDepth: bigint }) {
  const programId = new PublicKey(PRELEND_PROGRAM_ID);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: false },
      { pubkey: globalConfigPda(programId), isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([anchorDisc("update_depth"), u64le(params.postedDepth)]),
  });
}

export function initStabilityPoolIx(params: {
  admin: PublicKey;
  collateralMint: PublicKey;
  usdcMint: PublicKey;
}) {
  const programId = new PublicKey(PRELEND_PROGRAM_ID);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: params.collateralMint, isSigner: false, isWritable: false },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: globalConfigPda(programId), isSigner: false, isWritable: false },
      { pubkey: stabilityPoolPda(params.collateralMint, programId), isSigner: false, isWritable: true },
      { pubkey: spUsdcVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: anchorDisc("init_stability_pool"),
  });
}

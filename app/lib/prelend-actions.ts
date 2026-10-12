import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { PRELEND_PROGRAM_ID } from "@/lib/cluster";
import {
  collateralVaultPda,
  globalConfigPda,
  lenderPda,
  oraclePda,
  positionPda,
  spUsdcVaultPda,
  stabilityDepositPda,
  stabilityPoolPda,
  usdcVaultPda,
  decodeStabilityPool,
  SP_DEPOSIT_V1_LEN,
  SP_POOL_V1_LEN,
} from "@/lib/prelend";

const PROGRAM = () => new PublicKey(PRELEND_PROGRAM_ID);
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const DISC = {
  withdraw: Buffer.from([149, 158, 33, 185, 47, 243, 253, 31]),
  borrow: Buffer.from([31, 120, 217, 32, 182, 137, 251, 34]),
  repay: Buffer.from([74, 62, 35, 51, 80, 166, 230, 225]),
  depositSp: Buffer.from([218, 14, 14, 168, 24, 224, 243, 241]),
  withdrawSp: Buffer.from([174, 6, 7, 145, 238, 95, 102, 21]),
  claimSp: Buffer.from([164, 73, 168, 95, 126, 249, 137, 20]),
  migrateSpPool: Buffer.from([154, 105, 99, 160, 186, 150, 174, 213]),
  migrateSpDeposit: Buffer.from([24, 203, 4, 228, 186, 149, 128, 199]),
  liquidate: Buffer.from([223, 179, 226, 125, 48, 46, 39, 74]),
  claimSurplus: Buffer.from([95, 73, 158, 127, 131, 104, 189, 65]),
  setTestPrice: Buffer.from([132, 240, 240, 176, 155, 122, 8, 176]),
  warpAccrual: Buffer.from([187, 92, 101, 47, 51, 125, 83, 151]),
};

function u64le(n: bigint) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, n, true);
  return buf;
}

function u16le(n: number) {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, n, true);
  return buf;
}

function i64le(n: bigint) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, n, true);
  return buf;
}

function data(disc: Buffer, ...rest: Uint8Array[]) {
  const len = disc.length + rest.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(len);
  out.set(disc, 0);
  let o = disc.length;
  for (const part of rest) {
    out.set(part, o);
    o += part.length;
  }
  return Buffer.from(out);
}

const mintMetaCache = new Map<string, { tokenProgram: PublicKey; decimals: number }>();

async function mintMeta(connection: Connection, mint: PublicKey) {
  const key = mint.toBase58();
  const hit = mintMetaCache.get(key);
  if (hit) return hit;
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error("Mint not found");
  const meta = { tokenProgram: info.owner, decimals: info.data[44] };
  mintMetaCache.set(key, meta);
  return meta;
}

function ata(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey) {
  return getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
}

export async function buildWithdrawTx(params: {
  connection: Connection;
  lender: PublicKey;
  usdcMint: PublicKey;
  collateralMint: PublicKey;
  uiAmount: number;
  /** Pool USDC: skip mint + ATA RPC when lender already has a position (typical withdraw). */
  fast?: { tokenProgram: PublicKey; decimals: number; lenderHasUsdcAta: boolean };
}) {
  const { tokenProgram, decimals } = params.fast
    ? { tokenProgram: params.fast.tokenProgram, decimals: params.fast.decimals }
    : await mintMeta(params.connection, params.usdcMint);
  const amount = BigInt(Math.floor(params.uiAmount * 10 ** decimals + 1e-9));
  const lenderUsdc = ata(params.usdcMint, params.lender, tokenProgram);
  const tx = new Transaction();
  let needsAta = false;
  if (params.fast?.lenderHasUsdcAta) {
    needsAta = false;
  } else if (!(await params.connection.getAccountInfo(lenderUsdc))) {
    needsAta = true;
  }
  if (needsAta) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        params.lender,
        lenderUsdc,
        params.lender,
        params.usdcMint,
        tokenProgram,
      ),
    );
  }
  const programId = PROGRAM();
  tx.add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: params.lender, isSigner: true, isWritable: true },
        { pubkey: params.usdcMint, isSigner: false, isWritable: false },
        { pubkey: params.collateralMint, isSigner: false, isWritable: false },
        { pubkey: globalConfigPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: lenderUsdc, isSigner: false, isWritable: true },
        { pubkey: usdcVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: lenderPda(params.lender, params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data: data(DISC.withdraw, u64le(amount)),
    }),
  );
  tx.feePayer = params.lender;
  return tx;
}

export async function buildBorrowTx(params: {
  connection: Connection;
  borrower: PublicKey;
  usdcMint: PublicKey;
  collateralMint: PublicKey;
  feeRecipient: PublicKey;
  collateralUi: number;
  borrowUi: number;
}) {
  const usdc = await mintMeta(params.connection, params.usdcMint);
  const coll = await mintMeta(params.connection, params.collateralMint);
  const collateralAmount = BigInt(Math.round(params.collateralUi * 10 ** coll.decimals));
  const borrowAmount = BigInt(Math.round(params.borrowUi * 10 ** usdc.decimals));
  const borrowerCollateral = ata(params.collateralMint, params.borrower, coll.tokenProgram);
  let have = 0;
  try {
    const collateralAccount = await getAccount(
      params.connection,
      borrowerCollateral,
      "confirmed",
      coll.tokenProgram,
    );
    have = Number(collateralAccount.amount) / 10 ** coll.decimals;
  } catch {
    have = 0;
  }
  if (have + 1e-12 < params.collateralUi) {
    throw new Error(
      `Need ${params.collateralUi} ANTHROPIC, ${params.borrower.toBase58().slice(0, 4)}… has ${have}`,
    );
  }
  const programId = PROGRAM();
  const borrowerUsdc = ata(params.usdcMint, params.borrower, usdc.tokenProgram);
  const feeUsdc = ata(params.usdcMint, params.feeRecipient, usdc.tokenProgram);
  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: params.borrower, isSigner: true, isWritable: true },
        { pubkey: params.collateralMint, isSigner: false, isWritable: false },
        { pubkey: params.usdcMint, isSigner: false, isWritable: false },
        { pubkey: globalConfigPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: oraclePda(params.collateralMint, programId), isSigner: false, isWritable: false },
        { pubkey: stabilityPoolPda(params.collateralMint, programId), isSigner: false, isWritable: false },
        { pubkey: borrowerCollateral, isSigner: false, isWritable: true },
        { pubkey: borrowerUsdc, isSigner: false, isWritable: true },
        { pubkey: collateralVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: usdcVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: params.feeRecipient, isSigner: false, isWritable: false },
        { pubkey: feeUsdc, isSigner: false, isWritable: true },
        { pubkey: positionPda(params.borrower, params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: usdc.tokenProgram, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: data(DISC.borrow, u64le(collateralAmount), u64le(borrowAmount)),
    }),
  );
  tx.feePayer = params.borrower;
  return tx;
}

export async function buildRepayTx(params: {
  connection: Connection;
  borrower: PublicKey;
  usdcMint: PublicKey;
  collateralMint: PublicKey;
}) {
  const usdc = await mintMeta(params.connection, params.usdcMint);
  const coll = await mintMeta(params.connection, params.collateralMint);
  const programId = PROGRAM();
  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: params.borrower, isSigner: true, isWritable: true },
        { pubkey: params.collateralMint, isSigner: false, isWritable: false },
        { pubkey: params.usdcMint, isSigner: false, isWritable: false },
        { pubkey: globalConfigPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: positionPda(params.borrower, params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: ata(params.usdcMint, params.borrower, usdc.tokenProgram), isSigner: false, isWritable: true },
        { pubkey: ata(params.collateralMint, params.borrower, coll.tokenProgram), isSigner: false, isWritable: true },
        { pubkey: usdcVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: collateralVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: stabilityPoolPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: spUsdcVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: usdc.tokenProgram, isSigner: false, isWritable: false },
      ],
      data: DISC.repay,
    }),
  );
  tx.feePayer = params.borrower;
  return tx;
}

const KNOWN_SP_DEPOSITORS = [
  "42LgkxxGpLqQikAS9z9MJTB7yVikwikVWCHmuB9ihBjK",
  "FZWtz3onpdCDEyKrR8GRYLNNi2PnU83Xk3EoEu9wAsZo",
];

function migrateDepositIx(
  programId: PublicKey,
  payer: PublicKey,
  depositor: PublicKey,
  collateralMint: PublicKey,
  pool: PublicKey,
) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: depositor, isSigner: false, isWritable: false },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: stabilityDepositPda(depositor, pool, programId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: DISC.migrateSpDeposit,
  });
}

async function prependSpMigrate(
  tx: Transaction,
  connection: Connection,
  payer: PublicKey,
  collateralMint: PublicKey,
  depositor?: PublicKey,
  extras = false,
) {
  const programId = PROGRAM();
  const pool = stabilityPoolPda(collateralMint, programId);
  const extraKeys = extras
    ? KNOWN_SP_DEPOSITORS.map((d) => new PublicKey(d)).filter((d) => !depositor || !d.equals(depositor))
    : [];
  const watch = [
    pool,
    ...(depositor ? [stabilityDepositPda(depositor, pool, programId)] : []),
    ...extraKeys.map((d) => stabilityDepositPda(d, pool, programId)),
  ];
  const infos = await connection.getMultipleAccountsInfo(watch);
  const poolInfo = infos[0];
  if (poolInfo && poolInfo.data.length < SP_POOL_V1_LEN) {
    tx.add(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: payer, isSigner: true, isWritable: true },
          { pubkey: collateralMint, isSigner: false, isWritable: false },
          { pubkey: pool, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: DISC.migrateSpPool,
      }),
    );
  }
  let i = 1;
  if (depositor) {
    const depInfo = infos[i];
    i += 1;
    if (depInfo && depInfo.data.length > 0 && depInfo.data.length < SP_DEPOSIT_V1_LEN) {
      tx.add(migrateDepositIx(programId, payer, depositor, collateralMint, pool));
    }
  }
  extraKeys.forEach((owner, idx) => {
    const info = infos[i + idx];
    if (info && info.data.length > 0 && info.data.length < SP_DEPOSIT_V1_LEN) {
      tx.add(migrateDepositIx(programId, payer, owner, collateralMint, pool));
    }
  });
}

export function buildMigrateSpTx(params: {
  payer: PublicKey;
  collateralMint: PublicKey;
  depositor?: PublicKey;
}) {
  const programId = PROGRAM();
  const pool = stabilityPoolPda(params.collateralMint, programId);
  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: params.payer, isSigner: true, isWritable: true },
        { pubkey: params.collateralMint, isSigner: false, isWritable: false },
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: DISC.migrateSpPool,
    }),
  );
  const owners = new Set(KNOWN_SP_DEPOSITORS);
  for (const owner of owners) {
    tx.add(migrateDepositIx(programId, params.payer, new PublicKey(owner), params.collateralMint, pool));
  }
  tx.feePayer = params.payer;
  return tx;
}

export async function buildStabilityDepositTx(params: {
  connection: Connection;
  depositor: PublicKey;
  usdcMint: PublicKey;
  collateralMint: PublicKey;
  uiAmount: number;
  discountBps?: number;
}) {
  const usdc = await mintMeta(params.connection, params.usdcMint);
  const amount = BigInt(Math.round(params.uiAmount * 10 ** usdc.decimals));
  const depositorUsdc = ata(params.usdcMint, params.depositor, usdc.tokenProgram);
  const account = await getAccount(params.connection, depositorUsdc, "confirmed", usdc.tokenProgram);
  if (account.amount < amount) throw new Error("Not enough USDC");
  const programId = PROGRAM();
  const pool = stabilityPoolPda(params.collateralMint, programId);
  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: params.depositor, isSigner: true, isWritable: true },
        { pubkey: params.collateralMint, isSigner: false, isWritable: false },
        { pubkey: params.usdcMint, isSigner: false, isWritable: false },
        { pubkey: globalConfigPda(params.collateralMint, programId), isSigner: false, isWritable: false },
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: depositorUsdc, isSigner: false, isWritable: true },
        { pubkey: spUsdcVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: stabilityDepositPda(params.depositor, pool, programId), isSigner: false, isWritable: true },
        { pubkey: usdc.tokenProgram, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: data(DISC.depositSp, u64le(amount), u16le(params.discountBps ?? 1_000)),
    }),
  );
  tx.feePayer = params.depositor;
  return tx;
}

export async function buildWithdrawStabilityTx(params: {
  connection: Connection;
  depositor: PublicKey;
  usdcMint: PublicKey;
  collateralMint: PublicKey;
  uiAmount: number;
}) {
  const usdc = await mintMeta(params.connection, params.usdcMint);
  const amount = BigInt(Math.round(params.uiAmount * 10 ** usdc.decimals));
  const programId = PROGRAM();
  const pool = stabilityPoolPda(params.collateralMint, programId);
  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: params.depositor, isSigner: true, isWritable: true },
        { pubkey: params.collateralMint, isSigner: false, isWritable: false },
        { pubkey: params.usdcMint, isSigner: false, isWritable: false },
        { pubkey: globalConfigPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: stabilityDepositPda(params.depositor, pool, programId), isSigner: false, isWritable: true },
        { pubkey: spUsdcVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: ata(params.usdcMint, params.depositor, usdc.tokenProgram), isSigner: false, isWritable: true },
        { pubkey: usdc.tokenProgram, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: data(DISC.withdrawSp, u64le(amount)),
    }),
  );
  tx.feePayer = params.depositor;
  return tx;
}

export async function buildClaimStabilityTx(params: {
  connection: Connection;
  depositor: PublicKey;
  usdcMint: PublicKey;
  collateralMint: PublicKey;
}) {
  const usdc = await mintMeta(params.connection, params.usdcMint);
  const programId = PROGRAM();
  const pool = stabilityPoolPda(params.collateralMint, programId);
  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: params.depositor, isSigner: true, isWritable: true },
        { pubkey: params.collateralMint, isSigner: false, isWritable: false },
        { pubkey: params.usdcMint, isSigner: false, isWritable: false },
        { pubkey: globalConfigPda(params.collateralMint, programId), isSigner: false, isWritable: false },
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: stabilityDepositPda(params.depositor, pool, programId), isSigner: false, isWritable: true },
        { pubkey: collateralVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: ata(params.collateralMint, params.depositor, TOKEN), isSigner: false, isWritable: true },
        { pubkey: spUsdcVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: ata(params.usdcMint, params.depositor, usdc.tokenProgram), isSigner: false, isWritable: true },
        { pubkey: usdc.tokenProgram, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: DISC.claimSp,
    }),
  );
  tx.feePayer = params.depositor;
  return tx;
}

export function buildSetTestPriceTx(params: {
  caller: PublicKey;
  collateralMint: PublicKey;
  priceE6: bigint;
}) {
  const programId = PROGRAM();
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: params.caller, isSigner: true, isWritable: false },
        { pubkey: params.collateralMint, isSigner: false, isWritable: false },
        { pubkey: globalConfigPda(params.collateralMint, programId), isSigner: false, isWritable: true },
      ],
      data: data(DISC.setTestPrice, u64le(params.priceE6)),
    }),
  );
  tx.feePayer = params.caller;
  return tx;
}

/** Demo: apply `extraSecs` of interest to the borrow index (test-mode). */
export function buildWarpAccrualTx(params: {
  caller: PublicKey;
  collateralMint: PublicKey;
  extraSecs: bigint;
}) {
  const programId = PROGRAM();
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: params.caller, isSigner: true, isWritable: false },
        { pubkey: params.collateralMint, isSigner: false, isWritable: false },
        { pubkey: globalConfigPda(params.collateralMint, programId), isSigner: false, isWritable: true },
      ],
      data: data(DISC.warpAccrual, i64le(params.extraSecs)),
    }),
  );
  tx.feePayer = params.caller;
  return tx;
}

export async function buildLiquidateTx(params: {
  connection: Connection;
  caller: PublicKey;
  borrower: PublicKey;
  usdcMint: PublicKey;
  collateralMint: PublicKey;
}) {
  const programId = PROGRAM();
  const pool = stabilityPoolPda(params.collateralMint, programId);
  const bookInfo = await params.connection.getAccountInfo(pool);
  const book = bookInfo ? decodeStabilityPool(new Uint8Array(bookInfo.data)) : null;
  const bidKeys = (book?.owners ?? []).map((owner) => ({
    pubkey: stabilityDepositPda(new PublicKey(owner), pool, programId),
    isSigner: false,
    isWritable: true,
  }));
  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: params.caller, isSigner: true, isWritable: true },
        { pubkey: params.borrower, isSigner: false, isWritable: false },
        { pubkey: params.collateralMint, isSigner: false, isWritable: false },
        { pubkey: params.usdcMint, isSigner: false, isWritable: false },
        { pubkey: globalConfigPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: oraclePda(params.collateralMint, programId), isSigner: false, isWritable: false },
        { pubkey: positionPda(params.borrower, params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: spUsdcVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: usdcVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: collateralVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: ata(params.usdcMint, params.caller, TOKEN), isSigner: false, isWritable: true },
        { pubkey: TOKEN, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ...bidKeys,
      ],
      data: DISC.liquidate,
    }),
  );
  tx.feePayer = params.caller;
  return tx;
}

export async function buildClaimSurplusTx(params: {
  connection: Connection;
  borrower: PublicKey;
  collateralMint: PublicKey;
}) {
  const coll = await mintMeta(params.connection, params.collateralMint);
  const programId = PROGRAM();
  const dest = ata(params.collateralMint, params.borrower, coll.tokenProgram);
  const tx = new Transaction();
  if (!(await params.connection.getAccountInfo(dest))) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        params.borrower,
        dest,
        params.borrower,
        params.collateralMint,
        coll.tokenProgram,
      ),
    );
  }
  tx.add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: params.borrower, isSigner: true, isWritable: true },
        { pubkey: params.collateralMint, isSigner: false, isWritable: false },
        { pubkey: globalConfigPda(params.collateralMint, programId), isSigner: false, isWritable: false },
        { pubkey: positionPda(params.borrower, params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: collateralVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
        { pubkey: dest, isSigner: false, isWritable: true },
        { pubkey: coll.tokenProgram, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: DISC.claimSurplus,
    }),
  );
  tx.feePayer = params.borrower;
  return tx;
}

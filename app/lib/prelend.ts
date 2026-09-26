import { getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { PRELEND_PROGRAM_ID, rpcUrl } from "@/lib/cluster";

export const CONFIG_SEED = "global-config";
export const USDC_VAULT_SEED = "usdc-vault";
export const LENDER_SEED = "lender";
export const ORACLE_SEED = "oracle";
export const STABILITY_POOL_SEED = "stability-pool";
export const STABILITY_DEPOSIT_SEED = "stability-deposit";
export const SP_USDC_VAULT_SEED = "sp-usdc-vault";
export const COLLATERAL_VAULT_SEED = "collateral-vault";
export const POSITION_SEED = "position";

export const MOCK_ANTHROPIC = "5Gb8wNEZ5S84AgrFi9LXtxxRvU1bf1dzcMXCkMF5X1BH";
export const ANTHROPIC_MAINNET = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";

export function prelendProgramId() {
  return new PublicKey(PRELEND_PROGRAM_ID);
}

export function globalConfigPda(programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], programId)[0];
}

export function usdcVaultPda(programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from(USDC_VAULT_SEED)], programId)[0];
}

export function lenderPda(owner: PublicKey, programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(LENDER_SEED), owner.toBuffer()],
    programId,
  )[0];
}

export function oraclePda(mint: PublicKey, programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ORACLE_SEED), mint.toBuffer()],
    programId,
  )[0];
}

export function stabilityPoolPda(mint: PublicKey, programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(STABILITY_POOL_SEED), mint.toBuffer()],
    programId,
  )[0];
}

export function spUsdcVaultPda(mint: PublicKey, programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SP_USDC_VAULT_SEED), mint.toBuffer()],
    programId,
  )[0];
}

export function stabilityDepositPda(
  owner: PublicKey,
  pool: PublicKey,
  programId = prelendProgramId(),
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(STABILITY_DEPOSIT_SEED), owner.toBuffer(), pool.toBuffer()],
    programId,
  )[0];
}

export function collateralVaultPda(mint: PublicKey, programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(COLLATERAL_VAULT_SEED), mint.toBuffer()],
    programId,
  )[0];
}

export function positionPda(
  borrower: PublicKey,
  mint: PublicKey,
  programId = prelendProgramId(),
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POSITION_SEED), borrower.toBuffer(), mint.toBuffer()],
    programId,
  )[0];
}

function view(data: Uint8Array) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function u64(d: DataView, o: number) {
  return d.getBigUint64(o, true);
}

function i64(d: DataView, o: number) {
  return d.getBigInt64(o, true);
}

function pubkey(data: Uint8Array, o: number) {
  return new PublicKey(data.subarray(o, o + 32));
}

export function decodeConfig(data: Uint8Array) {
  const d = view(data);
  return {
    admin: pubkey(data, 8).toBase58(),
    usdcMint: pubkey(data, 40).toBase58(),
    feeRecipient: pubkey(data, 72).toBase58(),
    protocolFeeBps: d.getUint16(104, true),
    totalShares: Number(u64(d, 106)),
    totalBorrowed: Number(u64(d, 114)),
    maxBorrowLtvBps: d.getUint16(122, true),
    liquidationLtvBps: d.getUint16(124, true),
    interestRateBps: d.getUint16(128, true),
    adminDebtCap: Number(u64(d, 130)),
    borrowIndexE18: u128(data, 147),
    lastAccrualTs: Number(i64(d, 163)),
    postedDepth: Number(u64(d, 171)),
    testModePriceE6: Number(u64(d, 179)),
    paused: data[187] !== 0,
  };
}

function u128(data: Uint8Array, o: number) {
  const d = view(data);
  return d.getBigUint64(o, true) + (d.getBigUint64(o + 8, true) << 64n);
}

export function decodeLender(data: Uint8Array) {
  const d = view(data);
  return { owner: pubkey(data, 8).toBase58(), shares: Number(u64(d, 40)) };
}

export function decodeOracle(data: Uint8Array) {
  const d = view(data);
  return {
    mint: pubkey(data, 8).toBase58(),
    markPriceE6: Number(u64(d, 40)),
    twapPriceE6: Number(u64(d, 48)),
    markUpdatedAt: Number(i64(d, 56)),
    twapUpdatedAt: Number(i64(d, 64)),
  };
}

const E18 = 1_000_000_000_000_000_000n;
export const SP_POOL_V1_LEN = 146;
export const SP_DEPOSIT_V1_LEN = 129;

function mulDiv(a: bigint, b: bigint, c: bigint) {
  if (c === 0n) return 0n;
  return (a * b) / c;
}

export function decodeStabilityPool(data: Uint8Array) {
  const d = view(data);
  if (data.length >= SP_POOL_V1_LEN && data[8] === 1) {
    return {
      version: 1,
      totalUsdc: Number(u64(d, 9)),
      collateralMint: pubkey(data, 17).toBase58(),
      collateralHeld: Number(u64(d, 49)),
      pE18: u128(data, 57),
      sE18: u128(data, 73),
      epoch: Number(u64(d, 89)),
      prevSE18: u128(data, 97),
      prevEpoch: Number(u64(d, 113)),
      legacyUsdc: Number(u64(d, 121)),
      legacyColl: Number(u64(d, 129)),
      legacyShares: Number(u64(d, 137)),
      needsMigrate: false,
    };
  }
  return {
    version: 0,
    totalUsdc: Number(u64(d, 8)),
    collateralMint: pubkey(data, 24).toBase58(),
    collateralHeld: Number(u64(d, 56)),
    pE18: E18,
    sE18: 0n,
    epoch: 0,
    prevSE18: 0n,
    prevEpoch: 0,
    legacyUsdc: Number(u64(d, 8)),
    legacyColl: Number(u64(d, 56)),
    legacyShares: Number(u64(d, 16)),
    needsMigrate: true,
  };
}

export function decodeStabilityDeposit(data: Uint8Array) {
  if (data.length < 80) {
    return {
      legacy: true,
      initialUsdc: 0,
      snapshotPE18: E18,
      snapshotSE18: 0n,
      snapshotEpoch: 0,
      pendingCollateral: 0,
      shares: 0,
    };
  }
  const d = view(data);
  if (data.length >= SP_DEPOSIT_V1_LEN) {
    return {
      legacy: false,
      initialUsdc: Number(u64(d, 72)),
      snapshotPE18: u128(data, 80),
      snapshotSE18: u128(data, 96),
      snapshotEpoch: Number(u64(d, 112)),
      pendingCollateral: Number(u64(d, 120)),
    };
  }
  return {
    legacy: true,
    initialUsdc: 0,
    snapshotPE18: E18,
    snapshotSE18: 0n,
    snapshotEpoch: 0,
    pendingCollateral: 0,
    shares: Number(u64(d, 72)),
  };
}

export function liveSpPosition(
  pool: ReturnType<typeof decodeStabilityPool>,
  deposit: ReturnType<typeof decodeStabilityDeposit> | null,
) {
  if (!deposit) {
    return {
      usdcUi: 0,
      claimableUi: 0,
      needsMigrate: pool.needsMigrate,
      blocked: pool.needsMigrate || pool.legacyShares > 0,
    };
  }
  if (deposit.legacy) {
    return {
      usdcUi: 0,
      claimableUi: 0,
      needsMigrate: true,
      blocked: true,
    };
  }
  const initial = BigInt(deposit.initialUsdc);
  const snapP = deposit.snapshotPE18 === 0n ? E18 : deposit.snapshotPE18;
  const compounded =
    deposit.snapshotEpoch === pool.epoch ? mulDiv(initial, pool.pE18, snapP) : 0n;
  let s = 0n;
  if (deposit.snapshotEpoch === pool.epoch) s = pool.sE18;
  else if (deposit.snapshotEpoch === pool.prevEpoch) s = pool.prevSE18;
  const extra =
    s > deposit.snapshotSE18 ? mulDiv(initial, s - deposit.snapshotSE18, snapP) : 0n;
  const gain = BigInt(deposit.pendingCollateral) + extra;
  return {
    usdcUi: Number(compounded) / 1e6,
    claimableUi: Number(gain) / 1e9,
    needsMigrate: pool.needsMigrate,
    blocked: pool.legacyShares > 0,
  };
}

export function decodePosition(data: Uint8Array) {
  const d = view(data);
  return {
    borrower: pubkey(data, 8).toBase58(),
    collateralMint: pubkey(data, 40).toBase58(),
    collateralAmount: Number(u64(d, 72)),
    usdcAmount: Number(u64(d, 80)),
    scaledDebt: Number(u64(d, 88)),
    claimableCollateral: Number(u64(d, 96)),
    status: data[112],
  };
}

export async function resolveCollateralMint(connection: Connection, programId = prelendProgramId()) {
  const mock = new PublicKey(MOCK_ANTHROPIC);
  const main = new PublicKey(ANTHROPIC_MAINNET);
  const infos = await connection.getMultipleAccountsInfo([
    stabilityPoolPda(mock, programId),
    stabilityPoolPda(main, programId),
  ]);
  if (infos[0]) return mock;
  if (infos[1]) return main;
  return mock;
}

export async function readUsdcVault(connection = new Connection(rpcUrl(), "confirmed")) {
  const programId = prelendProgramId();
  const programInfo = await connection.getAccountInfo(programId);
  const vault = usdcVaultPda(programId);
  const config = globalConfigPda(programId);
  if (!programInfo?.executable) {
    return {
      deployed: false as const,
      programId: programId.toBase58(),
      vault: vault.toBase58(),
      config: config.toBase58(),
    };
  }
  try {
    const account = await getAccount(connection, vault, "confirmed");
    const configInfo = await connection.getAccountInfo(config);
    const parsed = configInfo ? decodeConfig(configInfo.data) : null;
    const vaultUi = Number(account.amount) / 1e6;
    const borrowedUi = (parsed?.totalBorrowed ?? 0) / 1e6;
    const shares = parsed?.totalShares ?? 0;
    const poolValueUi = vaultUi + borrowedUi;
    const sharePrice = shares > 0 ? (poolValueUi * 1e6) / shares : 1;
    return {
      deployed: true as const,
      initialized: true as const,
      programId: programId.toBase58(),
      vault: vault.toBase58(),
      config: config.toBase58(),
      mint: account.mint.toBase58(),
      amountAtoms: account.amount.toString(),
      uiAmount: vaultUi,
      totalBorrowedUi: borrowedUi,
      poolValueUi,
      totalShares: shares,
      sharePrice,
      admin: parsed?.admin ?? null,
      feeRecipient: parsed?.feeRecipient ?? null,
      interestRateBps: parsed?.interestRateBps ?? 1200,
      adminDebtCapUi: (parsed?.adminDebtCap ?? 0) / 1e6,
      postedDepthUi: (parsed?.postedDepth ?? 0) / 1e6,
      testModePriceE6: parsed?.testModePriceE6 ?? 0,
    };
  } catch {
    return {
      deployed: true as const,
      initialized: false as const,
      programId: programId.toBase58(),
      vault: vault.toBase58(),
      config: config.toBase58(),
    };
  }
}

function tokenAmount(data: Uint8Array, decimals: number) {
  return Number(u64(view(data), 64)) / 10 ** decimals;
}

export async function readUserMarket(
  owner: PublicKey,
  connection = new Connection(rpcUrl(), "confirmed"),
) {
  const programId = prelendProgramId();
  const vaultPda = usdcVaultPda(programId);
  const configPda = globalConfigPda(programId);
  const mock = new PublicKey(MOCK_ANTHROPIC);
  const main = new PublicKey(ANTHROPIC_MAINNET);
  const first = await connection.getMultipleAccountsInfo([
    programId,
    vaultPda,
    configPda,
    stabilityPoolPda(mock, programId),
    stabilityPoolPda(main, programId),
  ]);
  const vaultBase = {
    deployed: Boolean(first[0]?.executable),
    programId: programId.toBase58(),
    vault: vaultPda.toBase58(),
    config: configPda.toBase58(),
  };
  if (!first[0]?.executable || !first[1] || !first[2]) {
    return { ...vaultBase, initialized: false as const, collateralMint: MOCK_ANTHROPIC, wallet: owner.toBase58() };
  }
  const vaultData = new Uint8Array(first[1].data);
  const parsed = decodeConfig(new Uint8Array(first[2].data));
  const vaultUi = tokenAmount(vaultData, 6);
  const borrowedUi = parsed.totalBorrowed / 1e6;
  const sharesTotal = parsed.totalShares;
  const poolValueUi = vaultUi + borrowedUi;
  const usdcMint = pubkey(vaultData, 0);
  const collateralMint = first[3] ? mock : first[4] ? main : mock;
  const pool = stabilityPoolPda(collateralMint, programId);
  const collAta = getAssociatedTokenAddressSync(collateralMint, owner, false, TOKEN_PROGRAM_ID);
  const usdcAta = getAssociatedTokenAddressSync(usdcMint, owner, false, first[1].owner);
  const second = await connection.getMultipleAccountsInfo([
    oraclePda(collateralMint, programId),
    lenderPda(owner, programId),
    positionPda(owner, collateralMint, programId),
    pool,
    stabilityDepositPda(owner, pool, programId),
    collAta,
    usdcAta,
  ]);
  const lenderInfo = second[1];
  const shares = lenderInfo ? decodeLender(new Uint8Array(lenderInfo.data)).shares : 0;
  const shareValueUi = sharesTotal > 0 ? (shares / sharesTotal) * poolValueUi : 0;
  const pos = second[2] ? decodePosition(new Uint8Array(second[2].data)) : null;
  const e18 = 1_000_000_000_000_000_000n;
  const debtUi = pos
    ? Number((BigInt(Math.round(pos.scaledDebt)) * parsed.borrowIndexE18) / e18) / 1e6
    : 0;
  return {
    ...vaultBase,
    initialized: true as const,
    mint: usdcMint.toBase58(),
    amountAtoms: String(u64(view(vaultData), 64)),
    uiAmount: vaultUi,
    totalBorrowedUi: borrowedUi,
    poolValueUi,
    totalShares: sharesTotal,
    sharePrice: sharesTotal > 0 ? (poolValueUi * 1e6) / sharesTotal : 1,
    admin: parsed.admin,
    feeRecipient: parsed.feeRecipient,
    interestRateBps: parsed.interestRateBps,
    adminDebtCapUi: parsed.adminDebtCap / 1e6,
    postedDepthUi: parsed.postedDepth / 1e6,
    testModePriceE6: parsed.testModePriceE6,
    lastAccrualTs: parsed.lastAccrualTs,
    collateralMint: collateralMint.toBase58(),
    oracle: second[0] ? decodeOracle(new Uint8Array(second[0].data)) : null,
    lenderShares: shares,
    lenderValueUi: shareValueUi,
    usdcWalletUi: second[6] ? tokenAmount(new Uint8Array(second[6].data), 6) : 0,
    collateralWalletUi: second[5] ? tokenAmount(new Uint8Array(second[5].data), 9) : 0,
    wallet: owner.toBase58(),
    position: pos,
    loanDebtUi: debtUi,
    loanPrincipalUi: pos ? pos.usdcAmount / 1e6 : 0,
    loanCollateralUi: pos ? pos.collateralAmount / 1e9 : 0,
    loanClaimableUi: pos ? pos.claimableCollateral / 1e9 : 0,
    positionAddress: positionPda(owner, collateralMint, programId).toBase58(),
    stability: second[3] ? decodeStabilityPool(new Uint8Array(second[3].data)) : null,
    stabilityDeposit: second[4] ? decodeStabilityDeposit(new Uint8Array(second[4].data)) : null,
    spPosition:
      second[3] && second[4]
        ? liveSpPosition(
            decodeStabilityPool(new Uint8Array(second[3].data)),
            decodeStabilityDeposit(new Uint8Array(second[4].data)),
          )
        : second[3]
          ? liveSpPosition(decodeStabilityPool(new Uint8Array(second[3].data)), null)
          : { usdcUi: 0, claimableUi: 0, needsMigrate: false, blocked: false },
  };
}

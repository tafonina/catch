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

export function globalConfigPda(mint: PublicKey, programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CONFIG_SEED), mint.toBuffer()],
    programId,
  )[0];
}

export function usdcVaultPda(mint: PublicKey, programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(USDC_VAULT_SEED), mint.toBuffer()],
    programId,
  )[0];
}

export function lenderPda(owner: PublicKey, mint: PublicKey, programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(LENDER_SEED), owner.toBuffer(), mint.toBuffer()],
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
    targetLtvBps: d.getUint16(126, true),
    baseRateBps: d.getUint16(128, true),
    kinkUtilBps: d.getUint16(130, true),
    kinkRateBps: d.getUint16(132, true),
    maxRateBps: d.getUint16(134, true),
    interestRateBps: d.getUint16(132, true),
    borrowIndexE18: u128(data, 173),
    lastAccrualTs: Number(i64(d, 189)),
    postedDepth: Number(u64(d, 197)),
    testModePriceE6: Number(u64(d, 205)),
    paused: data[213] !== 0,
    seniorAssets: Number(u64(d, 216)),
    reserveUsdc: Number(u64(d, 224)),
    collateralMint: data.length >= 264 ? pubkey(data, 232).toBase58() : "",
  };
}

export function legacyGlobalConfigPda(programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], programId)[0];
}

export function legacyUsdcVaultPda(programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from(USDC_VAULT_SEED)], programId)[0];
}

export function legacyLenderPda(owner: PublicKey, programId = prelendProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(LENDER_SEED), owner.toBuffer()],
    programId,
  )[0];
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

export const SP_POOL_V1_LEN = 146;
export const SP_DEPOSIT_V1_LEN = 107;
const MAX_BIDS = 8;

export function decodeStabilityPool(data: Uint8Array) {
  const d = view(data);
  const version = data[8] ?? 0;
  if (version !== 2) {
    return {
      version,
      totalUsdc: 0,
      collateralMint: pubkey(data, Math.min(17, data.length - 32)).toBase58(),
      collateralHeld: 0,
      bidCount: 0,
      owners: [] as string[],
      bidUsdc: [] as number[],
      discountBps: [] as number[],
      needsMigrate: true,
      legacyUsdc: 0,
      legacyColl: 0,
      legacyShares: 0,
    };
  }
  const bidCount = data[57] ?? 0;
  const owners: string[] = [];
  const bidUsdc: number[] = [];
  const discountBps: number[] = [];
  for (let i = 0; i < Math.min(bidCount, MAX_BIDS); i += 1) {
    owners.push(pubkey(data, 58 + i * 32).toBase58());
    bidUsdc.push(Number(u64(d, 314 + i * 8)));
    discountBps.push(d.getUint16(378 + i * 2, true));
  }
  return {
    version,
    totalUsdc: Number(u64(d, 9)),
    collateralMint: pubkey(data, 17).toBase58(),
    collateralHeld: Number(u64(d, 49)),
    bidCount,
    owners,
    bidUsdc,
    discountBps,
    needsMigrate: false,
    legacyUsdc: 0,
    legacyColl: 0,
    legacyShares: 0,
  };
}

export function decodeStabilityDeposit(data: Uint8Array) {
  const d = view(data);
  return {
    legacy: false,
    depositor: pubkey(data, 8).toBase58(),
    discountBps: d.getUint16(72, true),
    initialUsdc: Number(u64(d, 74)),
    pendingCollateral: Number(u64(d, 82)),
    yieldUsdc: Number(u64(d, 90)),
  };
}

export function liveSpPosition(
  pool: ReturnType<typeof decodeStabilityPool>,
  deposit: ReturnType<typeof decodeStabilityDeposit> | null,
  owner?: string,
) {
  if (pool.needsMigrate) {
    return { usdcUi: 0, claimableUi: 0, needsMigrate: true, blocked: true, discountBps: 0 };
  }
  const idx = owner ? pool.owners.indexOf(owner) : -1;
  const usdc = idx >= 0 ? pool.bidUsdc[idx] : deposit?.initialUsdc ?? 0;
  return {
    usdcUi: usdc / 1e6,
    claimableUi: (deposit?.pendingCollateral ?? 0) / 1e9,
    needsMigrate: false,
    blocked: false,
    discountBps: idx >= 0 ? pool.discountBps[idx] : deposit?.discountBps ?? 0,
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

const E18 = 1_000_000_000_000_000_000n;
const POSITION_LEN = 114;

function debtAtoms(scaled: number, indexE18: bigint) {
  return (BigInt(Math.round(scaled)) * indexE18) / E18;
}

/** Config.total_borrowed can be 0 after a pool reset while position PDAs remain. */
async function openDebtUi(
  connection: Connection,
  programId: PublicKey,
  indexE18: bigint,
  mint?: string,
) {
  const accs = await connection.getProgramAccounts(programId, {
    filters: [{ dataSize: POSITION_LEN }],
  });
  let atoms = 0n;
  for (const { account } of accs) {
    const data = new Uint8Array(account.data);
    const pos = decodePosition(data);
    if (pos.status !== 0 || pos.scaledDebt <= 0) continue;
    if (mint && pos.collateralMint !== mint) continue;
    atoms += debtAtoms(pos.scaledDebt, indexE18);
  }
  return Number(atoms) / 1e6;
}

export async function resolveCollateralMint(connection: Connection, programId = prelendProgramId()) {
  const mock = new PublicKey(MOCK_ANTHROPIC);
  const main = new PublicKey(ANTHROPIC_MAINNET);
  const infos = await connection.getMultipleAccountsInfo([
    globalConfigPda(mock, programId),
    globalConfigPda(main, programId),
    stabilityPoolPda(mock, programId),
    stabilityPoolPda(main, programId),
  ]);
  if (infos[0] || infos[2]) return mock;
  if (infos[1] || infos[3]) return main;
  return mock;
}

export async function readUsdcVault(connection = new Connection(rpcUrl(), "confirmed")) {
  const programId = prelendProgramId();
  const programInfo = await connection.getAccountInfo(programId);
  const market = await resolveCollateralMint(connection, programId);
  const vault = usdcVaultPda(market, programId);
  const config = globalConfigPda(market, programId);
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
    const spInfo = await connection.getAccountInfo(stabilityPoolPda(market, programId));
    const stability = spInfo ? decodeStabilityPool(new Uint8Array(spInfo.data)) : null;
    const vaultUi = Number(account.amount) / 1e6;
    const fromConfig = (parsed?.totalBorrowed ?? 0) / 1e6;
    const fromBooks = parsed
      ? await openDebtUi(connection, programId, parsed.borrowIndexE18, parsed.collateralMint || undefined)
      : 0;
    const borrowedUi = Math.max(fromConfig, fromBooks);
    const shares = parsed?.totalShares ?? 0;
    const seniorUi = (parsed?.seniorAssets ?? 0) / 1e6;
    const poolValueUi = seniorUi > 0 ? seniorUi : vaultUi + fromConfig;
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
      adminDebtCapUi: 0,
      postedDepthUi: (parsed?.postedDepth ?? 0) / 1e6,
      testModePriceE6: parsed?.testModePriceE6 ?? 0,
      stability,
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
  const mock = new PublicKey(MOCK_ANTHROPIC);
  const main = new PublicKey(ANTHROPIC_MAINNET);
  const market = await resolveCollateralMint(connection, programId);
  const vaultPda = usdcVaultPda(market, programId);
  const configPda = globalConfigPda(market, programId);
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
  const fromConfig = parsed.totalBorrowed / 1e6;
  const fromBooks = await openDebtUi(
    connection,
    programId,
    parsed.borrowIndexE18,
    parsed.collateralMint || undefined,
  );
  const borrowedUi = Math.max(fromConfig, fromBooks);
  const sharesTotal = parsed.totalShares;
  const seniorUi = (parsed.seniorAssets ?? 0) / 1e6;
  const poolValueUi = seniorUi > 0 ? seniorUi : vaultUi + fromConfig;
  const usdcMint = pubkey(vaultData, 0);
  const mintFromConfig = parsed.collateralMint;
  const collateralMint =
    mintFromConfig && mintFromConfig !== PublicKey.default.toBase58()
      ? new PublicKey(mintFromConfig)
      : first[3]
        ? mock
        : first[4]
          ? main
          : mock;
  const pool = stabilityPoolPda(collateralMint, programId);
  const collAta = getAssociatedTokenAddressSync(collateralMint, owner, false, TOKEN_PROGRAM_ID);
  const usdcAta = getAssociatedTokenAddressSync(usdcMint, owner, false, first[1].owner);
  const second = await connection.getMultipleAccountsInfo([
    oraclePda(collateralMint, programId),
    lenderPda(owner, collateralMint, programId),
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
  const debtUi = pos ? Number(debtAtoms(pos.scaledDebt, parsed.borrowIndexE18)) / 1e6 : 0;
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
    adminDebtCapUi: 0,
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
            owner.toBase58(),
          )
        : second[3]
          ? liveSpPosition(decodeStabilityPool(new Uint8Array(second[3].data)), null, owner.toBase58())
          : { usdcUi: 0, claimableUi: 0, needsMigrate: false, blocked: false },
  };
}

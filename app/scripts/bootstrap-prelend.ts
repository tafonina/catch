/**
 * Initialize an isolated Catch market (config + senior vault + bid book)
 * for one pre-IPO mint. Closes leftover v1 global PDAs if they still exist.
 *
 *   cd prelend && NO_DNA=1 CARGO_TARGET_DIR=$PWD/target anchor build
 *   cd app && npx tsx scripts/bootstrap-prelend.ts
 */
import {
  createAssociatedTokenAccountIdempotent,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAccount,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rpcUrl } from "../lib/cluster";
import {
  closeLegacyGlobalIx,
  depositLiquidityIx,
  initStabilityPoolIx,
  initializePoolIx,
  lenderPda,
  resetPoolIx,
  updateDepthIx,
  updateOracleIx,
} from "../lib/anchor-ix";
import {
  MOCK_ANTHROPIC,
  globalConfigPda,
  legacyGlobalConfigPda,
  legacyLenderPda,
  legacyUsdcVaultPda,
  prelendProgramId,
  readUsdcVault,
  stabilityPoolPda,
  usdcVaultPda,
} from "../lib/prelend";

const DEPOSIT_ATOMS = BigInt(250_000) * BigInt(1_000_000);
const ANTHROPIC_MAINNET = new PublicKey("Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw");
const ANTHROPIC_MOCK = new PublicKey(MOCK_ANTHROPIC);

function loadKeypair() {
  const p =
    process.env.SOLANA_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");
  const secret = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function send(connection: Connection, tx: Transaction, signers: Keypair[]) {
  let last: unknown;
  for (let i = 0; i < 5; i += 1) {
    try {
      const fresh = new Transaction().add(...tx.instructions);
      fresh.feePayer = signers[0].publicKey;
      fresh.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      return await sendAndConfirmTransaction(connection, fresh, signers);
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

/** Position PDAs (114) and lender PDAs (49). Reset used to leave these and UI debt stayed live. */
const POSITION_LEN = 114;
const LENDER_LEN = 49;

async function leftoverMarketAccounts(
  connection: Connection,
  programId: PublicKey,
  admin: PublicKey,
  collateralMint: PublicKey,
) {
  const leftover: PublicKey[] = [];
  const seen = new Set<string>();
  const add = (key: PublicKey) => {
    const id = key.toBase58();
    if (seen.has(id)) return;
    seen.add(id);
    leftover.push(key);
  };

  const lender = lenderPda(admin, collateralMint, programId);
  if (await connection.getAccountInfo(lender)) add(lender);

  const [positions, lenders] = await Promise.all([
    connection.getProgramAccounts(programId, { filters: [{ dataSize: POSITION_LEN }] }),
    connection.getProgramAccounts(programId, { filters: [{ dataSize: LENDER_LEN }] }),
  ]);
  for (const { pubkey } of positions) add(pubkey);
  for (const { pubkey } of lenders) add(pubkey);
  return leftover;
}

async function createMint(connection: Connection, admin: Keypair, decimals: number) {
  const mint = Keypair.generate();
  const lamports = await getMinimumBalanceForRentExemptMint(connection);
  await send(
    connection,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: mint.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint.publicKey, decimals, admin.publicKey, null),
    ),
    [admin, mint],
  );
  return mint.publicKey;
}

async function main() {
  const connection = new Connection(rpcUrl(), "confirmed");
  const admin = loadKeypair();
  const programId = prelendProgramId();
  if (!(await connection.getAccountInfo(programId))) {
    throw new Error(`Program ${programId.toBase58()} is not on ${rpcUrl()}`);
  }

  let collateralMint = ANTHROPIC_MAINNET;
  if (!(await connection.getAccountInfo(collateralMint))) {
    collateralMint = (await connection.getAccountInfo(ANTHROPIC_MOCK))
      ? ANTHROPIC_MOCK
      : await createMint(connection, admin, 9);
    console.log("collateral mint", collateralMint.toBase58());
  }

  const legacyConfig = legacyGlobalConfigPda(programId);
  const legacyVault = legacyUsdcVaultPda(programId);
  const [legacyConfigInfo, legacyVaultInfo] = await connection.getMultipleAccountsInfo([
    legacyConfig,
    legacyVault,
  ]);
  let recoveredUsdc: PublicKey | null = null;
  if (legacyConfigInfo && legacyVaultInfo) {
    const recovered = new PublicKey(legacyVaultInfo.data.subarray(0, 32));
    const ata = await createAssociatedTokenAccountIdempotent(
      connection,
      admin,
      recovered,
      admin.publicKey,
    );
    const leftover: PublicKey[] = [];
    const oldLender = legacyLenderPda(admin.publicKey, programId);
    if (await connection.getAccountInfo(oldLender)) leftover.push(oldLender);
    const sig = await send(
      connection,
      new Transaction().add(
        closeLegacyGlobalIx({
          admin: admin.publicKey,
          usdcMint: recovered,
          adminUsdc: ata,
          leftover,
        }),
      ),
      [admin],
    );
    recoveredUsdc = recovered;
    console.log("close_legacy_global", sig, recovered.toBase58());
  }

  const marketConfig = globalConfigPda(collateralMint, programId);
  const marketVault = usdcVaultPda(collateralMint, programId);
  const [marketConfigInfo, marketVaultInfo] = await connection.getMultipleAccountsInfo([
    marketConfig,
    marketVault,
  ]);
  if (marketConfigInfo && marketVaultInfo) {
    const oldMint = new PublicKey(marketVaultInfo.data.subarray(0, 32));
    const ata = await createAssociatedTokenAccountIdempotent(
      connection,
      admin,
      oldMint,
      admin.publicKey,
    );
    const leftover = await leftoverMarketAccounts(connection, programId, admin.publicKey, collateralMint);
    const sig = await send(
      connection,
      new Transaction().add(
        resetPoolIx({
          admin: admin.publicKey,
          usdcMint: oldMint,
          collateralMint,
          adminUsdc: ata,
          leftover,
        }),
      ),
      [admin],
    );
    recoveredUsdc = oldMint;
    console.log("reset_pool", sig, "closed leftover", leftover.length);
  }

  const mintPk = recoveredUsdc ?? (await createMint(connection, admin, 6));
  if (!recoveredUsdc) console.log("usdc mint", mintPk.toBase58());
  else console.log("reuse usdc mint", mintPk.toBase58());

  const initSig = await send(
    connection,
    new Transaction().add(
      initializePoolIx({
        admin: admin.publicKey,
        usdcMint: mintPk,
        collateralMint,
        feeRecipient: admin.publicKey,
      }),
    ),
    [admin],
  );
  console.log("initialize_pool", initSig, "market", collateralMint.toBase58());

  const ata = await createAssociatedTokenAccountIdempotent(
    connection,
    admin,
    mintPk,
    admin.publicKey,
  );
  const have = await getAccount(connection, ata);
  if (have.amount < DEPOSIT_ATOMS) {
    await send(
      connection,
      new Transaction().add(
        createMintToInstruction(mintPk, ata, admin.publicKey, DEPOSIT_ATOMS - have.amount),
      ),
      [admin],
    );
  }
  const depSig = await send(
    connection,
    new Transaction().add(
      depositLiquidityIx({
        lender: admin.publicKey,
        usdcMint: mintPk,
        collateralMint,
        lenderUsdc: ata,
        amount: DEPOSIT_ATOMS,
      }),
    ),
    [admin],
  );
  console.log("deposit_liquidity", depSig);

  const oracleSig = await send(
    connection,
    new Transaction().add(
      updateOracleIx({
        admin: admin.publicKey,
        mint: collateralMint,
        markPriceE6: 1_050_000_000n,
        twapPriceE6: 1_032_000_000n,
      }),
    ),
    [admin],
  );
  console.log("update_oracle", oracleSig);

  const depthSig = await send(
    connection,
    new Transaction().add(
      updateDepthIx({
        admin: admin.publicKey,
        collateralMint,
        postedDepth: 171_258_000_000n,
      }),
    ),
    [admin],
  );
  console.log("update_depth", depthSig);

  const book = stabilityPoolPda(collateralMint, programId);
  if (await connection.getAccountInfo(book)) {
    console.log("bid book already exists", book.toBase58());
  } else {
    const spSig = await send(
      connection,
      new Transaction().add(
        initStabilityPoolIx({
          admin: admin.publicKey,
          collateralMint,
          usdcMint: mintPk,
        }),
      ),
      [admin],
    );
    console.log("init_stability_pool", spSig);
  }

  console.log(JSON.stringify(await readUsdcVault(connection), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

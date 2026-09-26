/**
 * Reset leftover pool PDAs if needed, then initialize the new PreLend layout
 * (30/40 LTV, 12% APR, 25k debt cap), seed 250k mock USDC, post oracle + depth,
 * and init the ANTHROPIC stability pool.
 *
 *   cd prelend && NO_DNA=1 anchor build && NO_DNA=1 anchor deploy
 *   cd app && npx tsx scripts/bootstrap-prelend.ts
 */
import {
  createAssociatedTokenAccountIdempotent,
  createInitializeMint2Instruction,
  createMintToInstruction,
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
  depositLiquidityIx,
  initStabilityPoolIx,
  initializePoolIx,
  lenderPda,
  resetPoolIx,
  updateDepthIx,
  updateOracleIx,
} from "../lib/anchor-ix";
import { prelendProgramId, readUsdcVault } from "../lib/prelend";

const DEPOSIT_ATOMS = BigInt(250_000) * BigInt(1_000_000);
const ANTHROPIC_MAINNET = new PublicKey("Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw");

function loadKeypair() {
  const p =
    process.env.SOLANA_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");
  const secret = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function send(connection: Connection, tx: Transaction, signers: Keypair[]) {
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  return sendAndConfirmTransaction(connection, tx, signers);
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
  let vault = await readUsdcVault(connection);
  if (!vault.deployed) {
    throw new Error(`Program ${programId.toBase58()} is not on ${rpcUrl()}`);
  }

  if (vault.initialized && vault.mint) {
    const oldMint = new PublicKey(vault.mint);
    const ata = await createAssociatedTokenAccountIdempotent(
      connection,
      admin,
      oldMint,
      admin.publicKey,
    );
    const leftover: PublicKey[] = [];
    const lender = lenderPda(admin.publicKey, programId);
    if (await connection.getAccountInfo(lender)) leftover.push(lender);
    const sig = await send(
      connection,
      new Transaction().add(
        resetPoolIx({
          admin: admin.publicKey,
          usdcMint: oldMint,
          adminUsdc: ata,
          leftover,
        }),
      ),
      [admin],
    );
    console.log("reset_pool", sig);
    vault = await readUsdcVault(connection);
  }

  const mintPk = await createMint(connection, admin, 6);
  console.log("usdc mint", mintPk.toBase58());
  const initSig = await send(
    connection,
    new Transaction().add(
      initializePoolIx({
        admin: admin.publicKey,
        usdcMint: mintPk,
        feeRecipient: admin.publicKey,
      }),
    ),
    [admin],
  );
  console.log("initialize_pool", initSig);

  const ata = await createAssociatedTokenAccountIdempotent(
    connection,
    admin,
    mintPk,
    admin.publicKey,
  );
  await send(
    connection,
    new Transaction().add(createMintToInstruction(mintPk, ata, admin.publicKey, DEPOSIT_ATOMS)),
    [admin],
  );
  const depSig = await send(
    connection,
    new Transaction().add(
      depositLiquidityIx({
        lender: admin.publicKey,
        usdcMint: mintPk,
        lenderUsdc: ata,
        amount: DEPOSIT_ATOMS,
      }),
    ),
    [admin],
  );
  console.log("deposit_liquidity", depSig);

  let collateralMint = ANTHROPIC_MAINNET;
  if (!(await connection.getAccountInfo(collateralMint))) {
    collateralMint = await createMint(connection, admin, 9);
    console.log("mock ANTHROPIC mint", collateralMint.toBase58());
  }

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
        postedDepth: 171_258_000_000n,
      }),
    ),
    [admin],
  );
  console.log("update_depth", depthSig);

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

  console.log(JSON.stringify(await readUsdcVault(connection), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

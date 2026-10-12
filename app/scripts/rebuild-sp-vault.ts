/**
 * Relink the bid-book USDC vault to the current pool mint, then reseed a −10% bid.
 *
 *   cd prelend/app && npx tsx scripts/rebuild-sp-vault.ts
 */
import {
  createAssociatedTokenAccountIdempotent,
  createMintToInstruction,
  getAccount,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rpcUrl } from "../lib/cluster";
import { rebuildSpUsdcVaultIx } from "../lib/anchor-ix";
import { buildStabilityDepositTx } from "../lib/prelend-actions";
import {
  MOCK_ANTHROPIC,
  prelendProgramId,
  readUsdcVault,
  stabilityDepositPda,
  stabilityPoolPda,
  spUsdcVaultPda,
} from "../lib/prelend";

const BID_UI = 25_000;
const DISCOUNT_BPS = 1_000;

function loadKeypair() {
  const p =
    process.env.SOLANA_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");
  const secret = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const connection = new Connection(rpcUrl(), "confirmed");
  const admin = loadKeypair();
  const programId = prelendProgramId();
  const vault = await readUsdcVault(connection);
  if (!vault.deployed || !vault.initialized || !vault.mint) {
    throw new Error("Senior vault is not initialized");
  }
  const usdcMint = new PublicKey(vault.mint);
  const collateralMint = new PublicKey(MOCK_ANTHROPIC);
  const book = stabilityPoolPda(collateralMint, programId);
  const spVault = spUsdcVaultPda(collateralMint, programId);
  const info = await connection.getAccountInfo(spVault);
  if (!info) throw new Error("Bid-book vault missing");
  const oldMint = new PublicKey(info.data.subarray(0, 32));
  console.log("pool USDC", usdcMint.toBase58());
  console.log("vault USDC", oldMint.toBase58());

  if (!oldMint.equals(usdcMint)) {
    const ata = await createAssociatedTokenAccountIdempotent(
      connection,
      admin,
      oldMint,
      admin.publicKey,
    );
    const leftover: PublicKey[] = [];
    const deposit = stabilityDepositPda(admin.publicKey, book, programId);
    if (await connection.getAccountInfo(deposit)) leftover.push(deposit);
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        rebuildSpUsdcVaultIx({
          admin: admin.publicKey,
          collateralMint,
          usdcMint,
          oldUsdcMint: oldMint,
          adminOldUsdc: ata,
          leftover,
        }),
      ),
      [admin],
    );
    console.log("rebuild_sp_usdc_vault", sig);
  } else {
    console.log("vault already on pool USDC");
  }

  const ata = await createAssociatedTokenAccountIdempotent(
    connection,
    admin,
    usdcMint,
    admin.publicKey,
  );
  const have = await getAccount(connection, ata);
  const need = BigInt(BID_UI) * 1_000_000n;
  if (have.amount < need) {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(createMintToInstruction(usdcMint, ata, admin.publicKey, need - have.amount)),
      [admin],
    );
  }
  const bidTx = await buildStabilityDepositTx({
    connection,
    depositor: admin.publicKey,
    usdcMint,
    collateralMint,
    uiAmount: BID_UI,
    discountBps: DISCOUNT_BPS,
  });
  const bidSig = await sendAndConfirmTransaction(connection, bidTx, [admin]);
  console.log("place_bid", BID_UI, "USDC @", DISCOUNT_BPS, "bps", bidSig);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

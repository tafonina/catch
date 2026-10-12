/**
 * Finish v1.2 bootstrap on the already-initialized senior vault:
 * create the ANTHROPIC bid book and seed one 10% bid so credit exists.
 */
import {
  createAssociatedTokenAccountIdempotent,
  createMintToInstruction,
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
import { initStabilityPoolIx } from "../lib/anchor-ix";
import { buildStabilityDepositTx } from "../lib/prelend-actions";
import {
  MOCK_ANTHROPIC,
  prelendProgramId,
  readUsdcVault,
  stabilityPoolPda,
} from "../lib/prelend";

const BID_UI = 25_000;
const MINT_EXTRA = 50_000;
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
    throw new Error("Senior vault is not initialized; run bootstrap-prelend.ts first");
  }
  const usdcMint = new PublicKey(vault.mint);
  const collateralMint = new PublicKey(MOCK_ANTHROPIC);
  if (!(await connection.getAccountInfo(collateralMint))) {
    throw new Error(`MOCK ANTHROPIC ${MOCK_ANTHROPIC} is not on this cluster`);
  }

  const book = stabilityPoolPda(collateralMint, programId);
  if (!(await connection.getAccountInfo(book))) {
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        initStabilityPoolIx({
          admin: admin.publicKey,
          collateralMint,
          usdcMint,
        }),
      ),
      [admin],
    );
    console.log("init_stability_pool", sig);
  } else {
    console.log("bid book already exists", book.toBase58());
  }

  const ata = await createAssociatedTokenAccountIdempotent(
    connection,
    admin,
    usdcMint,
    admin.publicKey,
  );
  const extra = BigInt(MINT_EXTRA) * 1_000_000n;
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(createMintToInstruction(usdcMint, ata, admin.publicKey, extra)),
    [admin],
  );
  console.log("minted", MINT_EXTRA, "USDC to", ata.toBase58());

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
  console.log(
    JSON.stringify(
      {
        programId: programId.toBase58(),
        usdcMint: usdcMint.toBase58(),
        collateralMint: collateralMint.toBase58(),
        bidBook: book.toBase58(),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

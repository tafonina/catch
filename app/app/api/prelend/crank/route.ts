import { NextResponse } from "next/server";
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { updateOracleIx } from "@/lib/anchor-ix";
import { resolveCollateralMint } from "@/lib/prelend";
import { rpcUrl } from "@/lib/cluster";
import type { PreStock } from "@/lib/prestocks";

export const dynamic = "force-dynamic";

function loadKeypair() {
  const p = process.env.SOLANA_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

export async function POST() {
  try {
    const connection = new Connection(rpcUrl(), "confirmed");
    const admin = loadKeypair();
    const mint = await resolveCollateralMint(connection);
    const res = await fetch("https://prestocks.com/api/prestocks", { cache: "no-store" });
    const stocks = (await res.json()) as PreStock[];
    const anthropic = stocks.find((s) => s.symbol === "ANTHROPIC");
    const mark = BigInt(Math.round((anthropic?.markPrice ?? 1050) * 1e6));
    const twap = BigInt(Math.round((anthropic?.tokenPrice ?? 1032) * 1e6));
    const tx = new Transaction().add(
      updateOracleIx({
        admin: admin.publicKey,
        mint,
        markPriceE6: mark,
        twapPriceE6: twap,
      }),
    );
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
    return NextResponse.json({ ok: true, sig, mint: mint.toBase58(), mark: Number(mark), twap: Number(twap) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "crank failed" },
      { status: 500 },
    );
  }
}

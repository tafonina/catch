import { NextRequest, NextResponse } from "next/server";
import {
  createAssociatedTokenAccountIdempotent,
  createMintToInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { rpcUrl } from "@/lib/cluster";
import { loadServerKeypair } from "@/lib/server-keypair";
import {
  FAUCET_ANTH,
  FAUCET_ANTH_MAX,
  FAUCET_SOL,
  FAUCET_USDC,
  FAUCET_USDC_MAX,
} from "@/lib/demo-wallets";
import { MOCK_ANTHROPIC, readUsdcVault } from "@/lib/prelend";

export const dynamic = "force-dynamic";

const SOL_TOPUP = Math.round(FAUCET_SOL * LAMPORTS_PER_SOL);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { wallet?: string; token?: string; amount?: number };
    const wallet = new PublicKey(body.wallet ?? "");
    const token = body.token === "anthropic" ? "anthropic" : body.token === "sol" ? "sol" : "usdc";
    const connection = new Connection(rpcUrl(), "confirmed");
    const admin = loadServerKeypair();
    const tx = new Transaction();
    const solBefore = await connection.getBalance(wallet);
    const solGap = Math.max(0, SOL_TOPUP - solBefore);
    if (solGap > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: wallet,
          lamports: solGap,
        }),
      );
    }

    let mintedUi = 0;
    let balanceUi = 0;
    let mintAddr: string | null = null;
    if (token !== "sol") {
      const amountUi = Number(body.amount);
      const fallback = token === "anthropic" ? FAUCET_ANTH : FAUCET_USDC;
      mintedUi = Number.isFinite(amountUi) && amountUi > 0 ? amountUi : fallback;
      const vault = await readUsdcVault(connection);
      if (!vault.initialized || !vault.mint) {
        return NextResponse.json({ error: "Pool is not initialized" }, { status: 400 });
      }
      const mint = new PublicKey(token === "anthropic" ? MOCK_ANTHROPIC : vault.mint);
      const mintInfo = await getMint(connection, mint);
      if (!mintInfo.mintAuthority?.equals(admin.publicKey)) {
        return NextResponse.json({ error: "Faucet mint authority mismatch" }, { status: 500 });
      }
      const cap = token === "anthropic" ? FAUCET_ANTH_MAX : FAUCET_USDC_MAX;
      const ata = await createAssociatedTokenAccountIdempotent(
        connection,
        admin,
        mint,
        wallet,
      );
      const existing = await getAccount(connection, ata);
      const have = Number(existing.amount) / 10 ** mintInfo.decimals;
      const room = Math.max(0, cap - have);
      mintedUi = Math.min(mintedUi, room);
      mintAddr = mint.toBase58();
      if (mintedUi > 0) {
        const atoms = BigInt(Math.round(mintedUi * 10 ** mintInfo.decimals));
        tx.add(createMintToInstruction(mint, ata, admin.publicKey, atoms));
      }
      if (tx.instructions.length === 0) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          token,
          wallet: wallet.toBase58(),
          mintedUi: 0,
          balanceUi: have,
          mint: mintAddr,
          cap,
        });
      }
      tx.feePayer = admin.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
      const account = await getAccount(connection, ata);
      balanceUi = Number(account.amount) / 10 ** mintInfo.decimals;
      return NextResponse.json({
        ok: true,
        sig,
        token,
        wallet: wallet.toBase58(),
        mintedUi,
        balanceUi,
        mint: mintAddr,
        cap,
        skipped: mintedUi === 0,
        solSent: solGap / LAMPORTS_PER_SOL,
      });
    }

    if (solGap === 0) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        token: "sol",
        wallet: wallet.toBase58(),
        solSent: 0,
        solBalance: solBefore / LAMPORTS_PER_SOL,
      });
    }
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
    return NextResponse.json({
      ok: true,
      sig,
      token: "sol",
      wallet: wallet.toBase58(),
      solSent: solGap / LAMPORTS_PER_SOL,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "faucet failed" },
      { status: 500 },
    );
  }
}

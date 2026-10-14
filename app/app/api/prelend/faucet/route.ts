import { NextRequest, NextResponse } from "next/server";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { loadServerKeypair } from "@/lib/server-keypair";
import {
  FAUCET_ANTH,
  FAUCET_ANTH_MAX,
  FAUCET_SOL,
  FAUCET_USDC,
  FAUCET_USDC_MAX,
} from "@/lib/demo-wallets";
import { MOCK_ANTHROPIC, readUsdcVault } from "@/lib/prelend";
import { appConnection } from "@/lib/rpc-connection";
import { sendAndConfirmFast } from "@/lib/send-tx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOL_TOPUP = Math.round(FAUCET_SOL * LAMPORTS_PER_SOL);
const HANDLER_MS = 50_000;

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "faucet failed";
}

async function handleFaucet(req: NextRequest) {
  const body = (await req.json()) as { wallet?: string; token?: string; amount?: number };
  const wallet = new PublicKey(body.wallet ?? "");
  const token = body.token === "anthropic" ? "anthropic" : body.token === "sol" ? "sol" : "usdc";
  const connection = appConnection();
  const admin = loadServerKeypair();
  const tx = new Transaction();
  const solBefore = await connection.getBalance(wallet);
  const requestedSol = Number(body.amount);
  const explicitSol = token === "sol" && Number.isFinite(requestedSol) && requestedSol > 0;
  const solLamports = explicitSol
    ? Math.round(Math.min(requestedSol, 1) * LAMPORTS_PER_SOL)
    : Math.max(0, SOL_TOPUP - solBefore);
  if (solLamports > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: wallet,
        lamports: solLamports,
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
    const authority = mintInfo.mintAuthority;
    if (!authority?.equals(admin.publicKey)) {
      return NextResponse.json(
        {
          error: `Faucet mint authority mismatch. Admin ${admin.publicKey.toBase58()} is not mint authority for ${mint.toBase58()}. Use the bootstrap keypair in SOLANA_KEYPAIR.`,
        },
        { status: 500 },
      );
    }
    const cap = token === "anthropic" ? FAUCET_ANTH_MAX : FAUCET_USDC_MAX;
    const ata = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_PROGRAM_ID);
    let have = 0;
    if (await connection.getAccountInfo(ata)) {
      const existing = await getAccount(connection, ata);
      have = Number(existing.amount) / 10 ** mintInfo.decimals;
    } else {
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          admin.publicKey,
          ata,
          wallet,
          mint,
          TOKEN_PROGRAM_ID,
        ),
      );
    }
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
    const sig = await sendAndConfirmFast(connection, tx, [admin]);
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
      solSent: solLamports / LAMPORTS_PER_SOL,
    });
  }

  if (solLamports === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      token: "sol",
      wallet: wallet.toBase58(),
      solSent: 0,
      solBalance: solBefore / LAMPORTS_PER_SOL,
    });
  }
  const sig = await sendAndConfirmFast(connection, tx, [admin]);
  return NextResponse.json({
    ok: true,
    sig,
    token: "sol",
    wallet: wallet.toBase58(),
    solSent: solLamports / LAMPORTS_PER_SOL,
  });
}

export async function POST(req: NextRequest) {
  try {
    const work = handleFaucet(req);
    const deadline = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              "Faucet server timeout — set SOLANA_RPC_URL to your Helius devnet URL in Coolify (runtime, no rebuild needed)",
            ),
        ),
        HANDLER_MS,
      );
    });
    return await Promise.race([work, deadline]);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

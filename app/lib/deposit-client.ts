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
import { globalConfigPda, lenderPda, usdcVaultPda } from "@/lib/prelend";

/** sha256("global:deposit_liquidity")[0..8] */
const DEPOSIT_DISC = Buffer.from([245, 99, 59, 25, 151, 71, 233, 249]);

function u64le(n: bigint) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

export function depositLiquidityIx(params: {
  lender: PublicKey;
  usdcMint: PublicKey;
  collateralMint: PublicKey;
  lenderUsdc: PublicKey;
  tokenProgram: PublicKey;
  amount: bigint;
}) {
  const programId = new PublicKey(PRELEND_PROGRAM_ID);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.lender, isSigner: true, isWritable: true },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: params.collateralMint, isSigner: false, isWritable: false },
      { pubkey: globalConfigPda(params.collateralMint, programId), isSigner: false, isWritable: true },
      { pubkey: params.lenderUsdc, isSigner: false, isWritable: true },
      { pubkey: usdcVaultPda(params.collateralMint, programId), isSigner: false, isWritable: true },
      { pubkey: lenderPda(params.lender, params.collateralMint, programId), isSigner: false, isWritable: true },
      { pubkey: params.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([DEPOSIT_DISC, u64le(params.amount)]),
  });
}

export async function readTokenUiAmount(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey,
) {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  try {
    const account = await getAccount(connection, ata, "confirmed", tokenProgram);
    return Number(account.amount) / 1e6;
  } catch {
    return 0;
  }
}

export async function buildDepositTx(params: {
  connection: Connection;
  lender: PublicKey;
  usdcMint: PublicKey;
  collateralMint: PublicKey;
  uiAmount: number;
}) {
  const mintInfo = await params.connection.getAccountInfo(params.usdcMint);
  if (!mintInfo) throw new Error("Pool USDC mint not found on this cluster");
  const tokenProgram = mintInfo.owner;
  const decimals = mintInfo.data[44];
  const amount = BigInt(Math.round(params.uiAmount * 10 ** decimals));
  if (amount <= 0n) throw new Error("Deposit amount must be greater than 0");

  const lenderUsdc = getAssociatedTokenAddressSync(
    params.usdcMint,
    params.lender,
    false,
    tokenProgram,
  );
  const ataInfo = await params.connection.getAccountInfo(lenderUsdc);
  const tx = new Transaction();
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        params.lender,
        lenderUsdc,
        params.lender,
        params.usdcMint,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  let walletUi = 0;
  if (ataInfo) {
    const account = await getAccount(params.connection, lenderUsdc, "confirmed", tokenProgram);
    walletUi = Number(account.amount) / 10 ** decimals;
    if (account.amount < amount) {
      throw new Error(
        `Wallet has ${walletUi.toLocaleString()} pool USDC; need ${params.uiAmount.toLocaleString()}. This is the vault mint, not Circle USDC.`,
      );
    }
  } else {
    throw new Error(
      "Wallet has 0 of the pool USDC mint. Bootstrap minted test USDC to the CLI keypair, not Phantom.",
    );
  }

  tx.add(
    depositLiquidityIx({
      lender: params.lender,
      usdcMint: params.usdcMint,
      collateralMint: params.collateralMint,
      lenderUsdc,
      tokenProgram,
      amount,
    }),
  );
  tx.feePayer = params.lender;
  tx.recentBlockhash = (await params.connection.getLatestBlockhash()).blockhash;
  return { tx, amount, walletUi, decimals };
}

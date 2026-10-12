/**
 * Attach Metaplex metadata so Phantom Devnet shows names instead of Unknown.
 * Signs with the mint authority (~/.config/solana/id.json).
 *
 *   cd prelend/app && npx tsx scripts/label-devnet-tokens.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rpcUrl } from "../lib/cluster";
import { MOCK_ANTHROPIC, resolveCollateralMint, usdcVaultPda } from "../lib/prelend";
import { getAccount } from "@solana/spl-token";

const META = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const USDC_URI =
  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png";
const ANTH_URI =
  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png";

function loadKeypair() {
  const p = process.env.SOLANA_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")) as number[]));
}

function metadataPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), META.toBuffer(), mint.toBuffer()],
    META,
  )[0];
}

function borshString(value: string) {
  const bytes = new TextEncoder().encode(value);
  const buf = new Uint8Array(4 + bytes.length);
  new DataView(buf.buffer).setUint32(0, bytes.length, true);
  buf.set(bytes, 4);
  return buf;
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return Buffer.from(out);
}

function createMetadataIx(params: {
  metadata: PublicKey;
  mint: PublicKey;
  authority: PublicKey;
  name: string;
  symbol: string;
  uri: string;
}) {
  return new TransactionInstruction({
    programId: META,
    keys: [
      { pubkey: params.metadata, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: concat(
      new Uint8Array([33]),
      borshString(params.name.slice(0, 32)),
      borshString(params.symbol.slice(0, 10)),
      borshString(params.uri.slice(0, 200)),
      new Uint8Array([0, 0]),
      new Uint8Array([0]),
      new Uint8Array([0]),
      new Uint8Array([0]),
      new Uint8Array([1]),
      new Uint8Array([0]),
    ),
  });
}

async function label(
  connection: Connection,
  admin: Keypair,
  mint: PublicKey,
  name: string,
  symbol: string,
  uri: string,
) {
  const metadata = metadataPda(mint);
  if (await connection.getAccountInfo(metadata)) {
    console.log(symbol, "metadata already exists", metadata.toBase58());
    return;
  }
  const tx = new Transaction().add(
    createMetadataIx({
      metadata,
      mint,
      authority: admin.publicKey,
      name,
      symbol,
      uri,
    }),
  );
  tx.feePayer = admin.publicKey;
  const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
  console.log(symbol, name, mint.toBase58(), sig);
}

async function main() {
  const connection = new Connection(rpcUrl(), "confirmed");
  const admin = loadKeypair();
  const market = await resolveCollateralMint(connection);
  const vault = await getAccount(connection, usdcVaultPda(market));
  const usdc = vault.mint;
  console.log("signer", admin.publicKey.toBase58());
  await label(connection, admin, usdc, "USD Coin", "USDC", USDC_URI);
  await label(connection, admin, new PublicKey(MOCK_ANTHROPIC), "ANTHROPIC", "ANTH", ANTH_URI);
  console.log("No SP share mint — skipped Catch shares.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

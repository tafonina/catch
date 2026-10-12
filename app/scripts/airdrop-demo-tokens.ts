/**
 * Mint demo ANTHROPIC / pool USDC to tester wallets on the current Catch market.
 */
import {
  createAssociatedTokenAccountIdempotent,
  createMintToInstruction,
  getMint,
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
import { MOCK_ANTHROPIC, readUsdcVault } from "../lib/prelend";

const ANTH_UI = 100;
const USDC_UI = 25_000;

const ANTH_WALLETS = [
  "GvNQRoDNtkXtTNaEGfW99ANALhqZHaezFQyQKb484SB7",
  "Gi2DogkrqvM3K6D6pcuHF2M4pMUvnDS7YQnz8wo38V5r",
];
const USDC_WALLETS = [
  "B8HA32J4hWuvUhxUpqXvJXTtUEfuRgLjwRYMq74HEBpW",
  "5Dnu9Qc9MjzUeQ3c9v9Pak5DjscKByfXgm3tUe3dBxdD",
  "42LgkxxGpLqQikAS9z9MJTB7yVikwikVWCHmuB9ihBjK",
  "BipMG4aJqU2LDSxdfikHNWtxAinHuHW9GDzBp4AdqjWQ",
];

function loadKeypair() {
  const p =
    process.env.SOLANA_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

async function main() {
  const connection = new Connection(rpcUrl(), "confirmed");
  const admin = loadKeypair();
  const vault = await readUsdcVault(connection);
  if (!vault.initialized || !vault.mint) {
    throw new Error("Pool USDC mint is not initialized");
  }
  const anthMint = new PublicKey(MOCK_ANTHROPIC);
  const usdcMint = new PublicKey(vault.mint);
  const anth = await getMint(connection, anthMint);
  const usdc = await getMint(connection, usdcMint);
  if (!anth.mintAuthority?.equals(admin.publicKey)) {
    throw new Error(`ANTH mint authority is ${anth.mintAuthority?.toBase58()}`);
  }
  if (!usdc.mintAuthority?.equals(admin.publicKey)) {
    throw new Error(`USDC mint authority is ${usdc.mintAuthority?.toBase58()}`);
  }

  async function mintTo(mint: PublicKey, owner: PublicKey, atoms: bigint) {
    const ata = await createAssociatedTokenAccountIdempotent(
      connection,
      admin,
      mint,
      owner,
    );
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(createMintToInstruction(mint, ata, admin.publicKey, atoms)),
      [admin],
    );
    return { ata: ata.toBase58(), sig };
  }

  const anthAtoms = BigInt(ANTH_UI) * 10n ** BigInt(anth.decimals);
  const usdcAtoms = BigInt(USDC_UI) * 10n ** BigInt(usdc.decimals);

  for (const w of ANTH_WALLETS) {
    const out = await mintTo(anthMint, new PublicKey(w), anthAtoms);
    console.log("ANTH", ANTH_UI, w, out.ata, out.sig);
  }
  for (const w of USDC_WALLETS) {
    const out = await mintTo(usdcMint, new PublicKey(w), usdcAtoms);
    console.log("USDC", USDC_UI, w, out.ata, out.sig);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

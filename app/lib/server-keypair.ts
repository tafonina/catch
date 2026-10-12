import { Keypair } from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_PATH = path.join(os.homedir(), ".config/solana/id.json");

function parseSecret(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }
  return Uint8Array.from(JSON.parse(fs.readFileSync(trimmed, "utf8")) as number[]);
}

/** Devnet faucet / crank admin — same key as bootstrap mint authority. */
export function loadServerKeypair(): Keypair {
  const fromEnv = process.env.SOLANA_KEYPAIR?.trim();
  try {
    if (fromEnv) {
      return Keypair.fromSecretKey(parseSecret(fromEnv));
    }
    if (!fs.existsSync(DEFAULT_PATH)) {
      throw new Error(
        `Server wallet missing. Set SOLANA_KEYPAIR in Coolify to your bootstrap keypair JSON array, or mount id.json at ${DEFAULT_PATH}.`,
      );
    }
    return Keypair.fromSecretKey(parseSecret(DEFAULT_PATH));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Server wallet missing")) {
      throw error;
    }
    const hint = fromEnv
      ? "SOLANA_KEYPAIR is set but invalid (expect JSON array or path to id.json)."
      : `No keypair at ${DEFAULT_PATH}. Set SOLANA_KEYPAIR on the server.`;
    throw new Error(hint, { cause: error });
  }
}

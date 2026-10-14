import { Connection, Keypair, Transaction } from "@solana/web3.js";

const CONFIRM_POLL_MS = 1_500;
const CONFIRM_MAX_MS = 40_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(err: unknown): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json;
    } catch {
      // fall through
    }
  }
  return "Transaction failed";
}

async function transactionLogs(connection: Connection, signature: string) {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    return (tx?.meta?.logMessages ?? []).join("\n");
  } catch {
    return "";
  }
}

async function confirmSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
) {
  const started = Date.now();
  while (Date.now() - started < CONFIRM_MAX_MS) {
    const status = await connection.getSignatureStatus(signature);
    const value = status.value;
    if (value?.err) {
      throw new Error(txErrMessage(value.err, await transactionLogs(connection, signature)));
    }
    const conf = value?.confirmationStatus;
    if (conf === "processed" || conf === "confirmed" || conf === "finalized") return;
    const height = await connection.getBlockHeight("confirmed");
    if (height > lastValidBlockHeight) throw new Error("Transaction expired — try again");
    await sleep(CONFIRM_POLL_MS);
  }
  throw new Error("Transaction not confirmed. Devnet may be slow — try again.");
}

/** Sign with the wallet-adapter signer, then send. No injected provider. */
export async function sendWithWallet(params: {
  connection: Connection;
  tx: Transaction;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  extraSigners?: Keypair[];
}) {
  const latest = await params.connection.getLatestBlockhash("confirmed");
  const fresh = new Transaction();
  for (const ix of params.tx.instructions) fresh.add(ix);
  fresh.feePayer = params.tx.feePayer;
  fresh.recentBlockhash = latest.blockhash;
  if (params.extraSigners?.length) fresh.partialSign(...params.extraSigners);

  const signed = await params.signTransaction(fresh);
  const signature = await params.connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });
  await confirmSignature(params.connection, signature, latest.lastValidBlockHeight);
  return signature;
}

function txErrMessage(err: unknown, logs = ""): string {
  const raw = `${errorText(err)}\n${logs}`;
  if (raw.includes("6001")) return "LTV over 30% at the oracle price";
  if (raw.includes("6002")) return "Position is not in the expected status";
  if (raw.includes("6003")) return "Oracle price is stale";
  if (raw.includes("6005")) return "Not enough USDC in the pool";
  if (raw.includes("6008")) return "Wrong USDC mint — use the pool USDC, not Circle USDC";
  if (raw.includes("6016")) return "Bid book is full (8 bids)";
  if (raw.includes("6017")) return "This wallet already has a bid at another discount";
  if (raw.includes("6018")) return "Market is not initialized for this token";
  if (raw.includes("6007")) return "Amount must be greater than zero";
  if (/insufficient lamports/i.test(raw)) return "Not enough SOL to open the bid account";
  if (raw.includes("2014") || raw.includes("ConstraintTokenMint")) {
    return "Bid book vault is still on the old USDC mint — rebuild the vault";
  }
  if (/blockhash not found|BlockhashNotFound/i.test(raw)) return "Transaction expired — try again";
  const anchor = logs.match(/Error Message: ([^\n]+)/);
  if (anchor?.[1]) return anchor[1];
  return raw.includes("InstructionError") ? "Transaction failed" : raw.slice(0, 120);
}

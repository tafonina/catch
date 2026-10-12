import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { demoKeypair, isDemoWalletActive } from "@/lib/demo-wallets";

type PhantomInjected = {
  isConnected?: boolean;
  connect: () => Promise<unknown>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
};

function phantomInjected(): PhantomInjected | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    phantom?: { solana?: PhantomInjected };
    solana?: PhantomInjected;
  };
  const wallet = w.phantom?.solana ?? w.solana;
  if (!wallet?.signTransaction || !wallet.connect) return undefined;
  return wallet;
}

export async function sendWithPhantom(params: {
  connection: Connection;
  tx: Transaction;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  extraSigners?: Keypair[];
}) {
  const latest = await params.connection.getLatestBlockhash("confirmed");
  const fresh = new Transaction();
  for (const ix of params.tx.instructions) fresh.add(ix);
  fresh.feePayer = params.tx.feePayer;
  fresh.recentBlockhash = latest.blockhash;

  const demo = isDemoWalletActive() ? demoKeypair() : null;
  let signed: Transaction;
  if (demo) {
    fresh.feePayer = demo.publicKey;
    fresh.partialSign(demo, ...(params.extraSigners ?? []));
    signed = fresh;
  } else {
    const phantom = phantomInjected();
    if (phantom && !phantom.isConnected) {
      await phantom.connect();
    }
    const sign =
      phantom?.signTransaction && phantom.isConnected
        ? (tx: Transaction) => phantom.signTransaction(tx)
        : params.signTransaction;
    if (!sign) throw new Error("Reconnect wallet");
    signed = await sign(fresh);
    if (params.extraSigners?.length) signed.partialSign(...params.extraSigners);
  }
  const signature = await params.connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
    maxRetries: 5,
  });
  let err: unknown = null;
  try {
    const confirmed = await params.connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed",
    );
    err = confirmed.value.err;
  } catch {
    const status = await params.connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });
    err = status.value?.err ?? null;
    if (!status.value) throw new Error("Transaction not confirmed");
  }
  if (err) {
    let logs = "";
    try {
      const tx = await params.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      logs = (tx?.meta?.logMessages ?? []).join("\n");
    } catch {
      logs = "";
    }
    throw new Error(txErrMessage(err, logs));
  }
  return signature;
}

function txErrMessage(err: unknown, logs = ""): string {
  const raw = `${JSON.stringify(err)}\n${logs}`;
  if (raw.includes("6001")) return "LTV over 30% at the oracle price";
  if (raw.includes("6002")) return "Position is not in the expected status";
  if (raw.includes("6003")) return "Oracle price is stale";
  if (raw.includes("6005")) return "Not enough USDC in the pool";
  if (raw.includes("6008")) return "Wrong USDC mint — use the pool USDC, not Circle USDC";
  if (raw.includes("6016")) return "Bid book is full (8 bids)";
  if (raw.includes("6017")) return "This wallet already has a bid at another discount";
  if (raw.includes("6018")) return "Market is not initialized for this token";
  if (raw.includes("6007")) return "Amount must be greater than zero";
  if (/insufficient lamports/i.test(raw)) {
    return "Not enough SOL to open the bid account";
  }
  if (raw.includes("2014") || raw.includes("ConstraintTokenMint")) {
    return "Bid book vault is still on the old USDC mint — rebuild the vault";
  }
  const anchor = logs.match(/Error Message: ([^\n]+)/);
  if (anchor?.[1]) return anchor[1];
  return raw.includes("InstructionError") ? "Transaction failed" : raw.slice(0, 90);
}

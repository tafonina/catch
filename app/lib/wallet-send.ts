import { Connection, Keypair, Transaction } from "@solana/web3.js";

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
  const phantom = phantomInjected();
  if (phantom && !phantom.isConnected) {
    await phantom.connect();
  }

  const sign =
    phantom?.signTransaction && phantom.isConnected
      ? (tx: Transaction) => phantom.signTransaction(tx)
      : params.signTransaction;
  if (!sign) throw new Error("Reconnect wallet");

  const latest = await params.connection.getLatestBlockhash("confirmed");
  const fresh = new Transaction();
  for (const ix of params.tx.instructions) fresh.add(ix);
  fresh.feePayer = params.tx.feePayer;
  fresh.recentBlockhash = latest.blockhash;

  const signed = await sign(fresh);
  if (params.extraSigners?.length) signed.partialSign(...params.extraSigners);
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
  if (err) throw new Error(txErrMessage(err));
  return signature;
}

function txErrMessage(err: unknown): string {
  const raw = JSON.stringify(err);
  if (raw.includes("6001")) return "LTV over 30% at the oracle price";
  if (raw.includes("6002")) return "Position is not in the expected status";
  if (raw.includes("6003")) return "Oracle price is stale";
  if (raw.includes("6005")) return "Not enough USDC in the pool";
  return raw.includes("InstructionError") ? "Transaction failed" : raw.slice(0, 90);
}

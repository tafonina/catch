import { Connection, Keypair, Transaction, type SendOptions } from "@solana/web3.js";

const CONFIRM_MS = 28_000;

export async function sendAndConfirmFast(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  sendOpts: SendOptions = { skipPreflight: false, maxRetries: 2 },
) {
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), sendOpts);
  const confirm = connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            "Transaction confirm timeout — set SOLANA_RPC_URL (Helius devnet) in Coolify and redeploy",
          ),
        ),
      CONFIRM_MS,
    );
  });
  await Promise.race([confirm, timeout]);
  return sig;
}

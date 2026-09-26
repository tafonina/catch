/**
 * Check if Pyth Index feeds are readable on-chain via the OLD push oracle
 * (`@pythnetwork/client`) AND the NEW pull oracle (`@pythnetwork/pyth-solana-receiver`).
 *
 *   cd prelend && npx tsx scripts/check-pyth-onchain.ts
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { PythHttpClient, getPythProgramKeyForCluster } from "@pythnetwork/client";

const RPC_MAINNET = "https://api.mainnet-beta.solana.com";
const RPC_DEVNET = "https://api.devnet.solana.com";

const TARGET_SYMBOLS = ["ANTHROPIC", "OPENAI", "SPACEX", "ANDURIL", "NEURALINK"];

async function checkPushOracle(cluster: "mainnet-beta" | "devnet") {
  console.log(`\n━━━ Push Oracle (old @pythnetwork/client) — ${cluster} ━━━`);
  const rpc = cluster === "mainnet-beta" ? RPC_MAINNET : RPC_DEVNET;
  const connection = new Connection(rpc, "confirmed");

  let pythKey: PublicKey;
  try {
    pythKey = getPythProgramKeyForCluster(cluster);
  } catch {
    console.log(`  ❌ No Pyth program key for cluster ${cluster}`);
    return;
  }
  console.log(`  Pyth program: ${pythKey.toBase58()}`);

  try {
    const client = new PythHttpClient(connection, pythKey);
    console.log("  Fetching all products (this can take a moment)…");
    const data = await client.getData();

    console.log(`  Total products: ${data.products.length}`);
    console.log(`  Total price feeds: ${data.productPrice.size}`);

    let found = 0;
    for (const [symbol, priceData] of data.productPrice) {
      try {
        const sym = (symbol ?? "").toUpperCase();
        const matches = TARGET_SYMBOLS.some((t) => sym.includes(t));
        if (matches || sym.includes("INDEX") || sym.includes("PRE")) {
          found++;
          console.log(`\n  ✅ FOUND: ${symbol}`);
          console.log(`     price     = $${priceData.price ?? "null"}`);
          console.log(`     conf      = ±${priceData.confidence ?? "null"}`);
          console.log(`     status    = ${priceData.status}`);
          console.log(`     account   = ${priceData.productAccountKey?.toBase58() ?? "?"}`);
        }
      } catch {
        // skip malformed entry
      }
    }

    if (found === 0) {
      console.log("\n  No ANTHROPIC/OPENAI/Index feeds found in push oracle.");
      console.log("  Checking for any Equity.* or Index.* symbols…");
      let equityCount = 0;
      for (const [symbol] of data.productPrice) {
        try {
          if (symbol && (symbol.includes("Equity") || symbol.includes("Index"))) {
            equityCount++;
            if (equityCount <= 5) console.log(`    ${symbol}`);
          }
        } catch { /* skip */ }
      }
      console.log(`  Total Equity/Index feeds: ${equityCount}`);
    }
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}`);
  }
}

async function checkPullOracle() {
  console.log("\n━━━ Pull Oracle (Hermes → on-chain post check) ━━━");

  const ANTHROPIC_FEED = "0x5da511a7c68b17a3bc94380cab4756bc83ab87f86307af10ea58467a64b6689d";

  // The Pyth Solana Receiver program stores posted price updates.
  // Check if there's already a price update account for this feed on devnet/mainnet.
  const PYTH_RECEIVER_PROGRAM = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT"); // Pyth Solana Receiver

  for (const [label, rpc] of [["mainnet", RPC_MAINNET], ["devnet", RPC_DEVNET]] as const) {
    console.log(`\n  ${label}:`);
    const connection = new Connection(rpc, "confirmed");

    // Try to find if receiver program exists
    for (const [name, prog] of [["Pyth Receiver", PYTH_RECEIVER_PROGRAM]] as const) {
      const info = await connection.getAccountInfo(prog);
      console.log(`    ${name} (${prog.toBase58().slice(0, 8)}…): ${info ? (info.executable ? "✅ deployed" : "exists but not executable") : "❌ not found"}`);
    }
  }

  // Try to use PythSolanaReceiver to derive the price account address
  try {
    const { InstructionWithEphemeralSigners, PythSolanaReceiver } = await import("@pythnetwork/pyth-solana-receiver");
    console.log("\n  PythSolanaReceiver SDK loaded ✅");

    // The SDK needs a wallet to construct, but we can try to get the price feed account
    // address derivation
    const connection = new Connection(RPC_DEVNET, "confirmed");

    // Try reading the guardian set or treasury to verify receiver is alive
    console.log("  (SDK imported but full posting test requires funded wallet — see verify-oracle.ts)");
  } catch (e: any) {
    console.log(`\n  PythSolanaReceiver import: ${e.message?.slice(0, 100)}`);
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Pyth On-Chain Feed Check: Push Oracle vs Pull Oracle");
  console.log("═══════════════════════════════════════════════════════════");

  await checkPushOracle("mainnet-beta");
  await checkPushOracle("devnet");
  await checkPullOracle();

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  CONCLUSION");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  If ANTHROPIC/OPENAI feeds appear in push oracle → FREE on-chain reads");
  console.log("  If not → pull oracle only → need Hermes API → need pyth-indices key");
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

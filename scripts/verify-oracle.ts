/**
 * Day-0 oracle verification — run BEFORE touching the oracle code.
 *
 *   cd prelend && npx tsx scripts/verify-oracle.ts
 *
 * Reads PYTH_API_KEY from app/.env.local (optional — indices may not need it).
 * Output decides: Class A (Pyth on-chain) vs restricted (API-only).
 */

import * as fs from "fs";
import * as path from "path";

/* ------------------------------------------------------------------ */
/*  0. env                                                             */
/* ------------------------------------------------------------------ */

const envPath = path.resolve(__dirname, "../app/.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

const PYTH_KEY = process.env.PYTH_API_KEY ?? "";
const HERMES =
  process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";

function hermesHeaders(withKey: boolean): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (withKey && PYTH_KEY) h.Authorization = `Bearer ${PYTH_KEY}`;
  return h;
}

const HERMES_PUBLIC = "https://hermes.pyth.network";

async function hermesGet(url: string): Promise<any> {
  // Try with key first, then without, then public endpoint
  for (const attempt of ["withKey", "noKey", "public"] as const) {
    let targetUrl = url;
    let headers: Record<string, string>;

    if (attempt === "public") {
      targetUrl = url.replace(HERMES, HERMES_PUBLIC);
      headers = { accept: "application/json" };
    } else {
      headers = hermesHeaders(attempt === "withKey");
    }

    const res = await fetch(targetUrl, { headers });
    if (res.ok) {
      if (attempt !== "withKey") {
        console.log(`  ℹ  Succeeded via ${attempt === "public" ? "public Hermes" : "no-key"}`);
      }
      return res.json();
    }
    if ((res.status === 401 || res.status === 403) && attempt !== "public") {
      console.log(`  ⚠  ${res.status} (${attempt}), trying next…`);
      continue;
    }
    if (attempt === "public") {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${targetUrl}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  1. Feed discovery                                                  */
/* ------------------------------------------------------------------ */

type FeedEntry = {
  id: string;
  attributes?: {
    symbol?: string;
    asset_type?: string;
    base?: string;
    quote_currency?: string;
    [k: string]: any;
  };
};

async function discoverFeeds(query: string): Promise<FeedEntry[]> {
  console.log(`\n🔍  Searching Hermes for "${query}" …`);
  const url = `${HERMES}/v2/price_feeds?query=${encodeURIComponent(query)}`;
  try {
    const data: FeedEntry[] = await hermesGet(url);
    if (!data || data.length === 0) {
      console.log(`   No feeds found for "${query}".`);
      return [];
    }
    for (const f of data) {
      const sym = f.attributes?.symbol ?? "?";
      const atype = f.attributes?.asset_type ?? "?";
      console.log(`   ✅  ${sym}  |  type=${atype}  |  id=0x${f.id}`);
    }
    return data;
  } catch (e: any) {
    console.log(`   ❌  ${e.message}`);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  2. Price and units                                                 */
/* ------------------------------------------------------------------ */

type PriceUpdate = {
  id: string;
  price?: { price: string; expo: number; conf: string; publish_time: number };
  ema_price?: { price: string; expo: number; conf: string };
};

async function fetchPrice(
  feedId: string,
): Promise<PriceUpdate | null> {
  const url = `${HERMES}/v2/updates/price/latest?ids[]=${feedId}`;
  try {
    const body = await hermesGet(url);
    const parsed: PriceUpdate[] = body.parsed ?? [];
    return parsed.find((p) => p.id === feedId) ?? null;
  } catch (e: any) {
    console.log(`   ❌  price fetch failed: ${e.message}`);
    return null;
  }
}

function priceUi(p: PriceUpdate): {
  price: number;
  conf: number;
  expo: number;
  publishTime: number;
} {
  const price = Number(p.price!.price) * 10 ** p.price!.expo;
  const conf = Number(p.price!.conf) * 10 ** p.price!.expo;
  return {
    price,
    conf,
    expo: p.price!.expo,
    publishTime: p.price!.publish_time,
  };
}

/* ------------------------------------------------------------------ */
/*  3. Update frequency and confidence (poll 5 min)                    */
/* ------------------------------------------------------------------ */

async function pollFeed(
  feedId: string,
  durationMs: number = 5 * 60 * 1000,
  intervalMs: number = 10_000,
) {
  console.log(
    `\n⏱  Polling 0x${feedId.slice(0, 8)}… for ${durationMs / 1000}s every ${intervalMs / 1000}s`,
  );
  const publishTimes: number[] = [];
  const confPcts: number[] = [];
  const start = Date.now();
  let ticks = 0;

  while (Date.now() - start < durationMs) {
    const p = await fetchPrice(feedId);
    ticks++;
    if (p?.price) {
      const u = priceUi(p);
      const confPct = (u.conf / u.price) * 100;
      publishTimes.push(u.publishTime);
      confPcts.push(confPct);
      process.stdout.write(
        `   tick ${ticks}: $${u.price.toFixed(2)}  ±${u.conf.toFixed(2)} (${confPct.toFixed(2)}%)  t=${u.publishTime}\r`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  console.log("");

  const unique = [...new Set(publishTimes)].sort();
  const gaps: number[] = [];
  for (let i = 1; i < unique.length; i++) gaps.push(unique[i] - unique[i - 1]);
  const maxGap = gaps.length > 0 ? Math.max(...gaps) : 0;

  const minConf = confPcts.length > 0 ? Math.min(...confPcts) : 0;
  const maxConf = confPcts.length > 0 ? Math.max(...confPcts) : 0;
  const avgConf =
    confPcts.length > 0
      ? confPcts.reduce((a, b) => a + b, 0) / confPcts.length
      : 0;

  console.log(`   Distinct publish_times : ${unique.length}`);
  console.log(`   Max gap                : ${maxGap}s`);
  console.log(
    `   Confidence (%price)    : min=${minConf.toFixed(2)}%  max=${maxConf.toFixed(2)}%  avg=${avgConf.toFixed(2)}%`,
  );

  return { maxGap, minConf, maxConf, avgConf, uniqueCount: unique.length };
}

/* ------------------------------------------------------------------ */
/*  4. On-chain availability — the decisive test                       */
/* ------------------------------------------------------------------ */

async function testOnChain(feedId: string) {
  console.log(`\n🔗  Testing on-chain availability for 0x${feedId.slice(0, 8)}…`);

  // Fetch binary VAA from Hermes
  const url = `${HERMES}/v2/updates/price/latest?ids[]=${feedId}&encoding=base64`;
  try {
    const body = await hermesGet(url);
    const vaas: string[] = body.binary?.data ?? [];
    if (vaas.length === 0) {
      console.log("   ❌  No binary VAA returned from Hermes.");
      return false;
    }
    console.log(`   Binary VAA received (${vaas[0].length} chars base64)`);

    // Try to post to devnet using the Pyth Solana receiver
    // We need @pythnetwork/pyth-solana-receiver for this
    let hasSolanaReceiver = false;
    try {
      require.resolve("@pythnetwork/pyth-solana-receiver");
      hasSolanaReceiver = true;
    } catch {
      // not installed
    }

    if (!hasSolanaReceiver) {
      console.log(
        "   ⚠  @pythnetwork/pyth-solana-receiver not installed — skipping on-chain post.",
      );
      console.log(
        '   Install with: npm i @pythnetwork/pyth-solana-receiver && re-run',
      );
      console.log("   Binary VAA IS available from Hermes, so on-chain posting is likely possible.");
      console.log("   Marking as LIKELY CLASS A (confirm after installing SDK).");
      return "likely";
    }

    // If SDK is installed, attempt the post
    console.log("   @pythnetwork/pyth-solana-receiver found — attempting devnet post…");
    try {
      const { PythSolanaReceiver } = require("@pythnetwork/pyth-solana-receiver");
      const { Connection, Keypair } = require("@solana/web3.js");

      const connection = new Connection("https://api.devnet.solana.com", "confirmed");

      // Load local wallet for devnet tx
      const walletPath = path.join(
        process.env.HOME ?? "~",
        ".config/solana/id.json",
      );
      let payer: any;
      if (fs.existsSync(walletPath)) {
        const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
        payer = Keypair.fromSecretKey(Uint8Array.from(raw));
      } else {
        console.log("   ⚠  No local wallet at ~/.config/solana/id.json — cannot post tx.");
        return "likely";
      }

      const pythReceiver = new PythSolanaReceiver({
        connection,
        wallet: { publicKey: payer.publicKey, signTransaction: async (tx: any) => { tx.sign(payer); return tx; }, signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.sign(payer)); return txs; } },
      });

      const txBuilder = pythReceiver.newTransactionBuilder({
        closeUpdateAccounts: true,
      });
      await txBuilder.addPostPriceUpdates([vaas[0]]);
      const txs = await txBuilder.buildVersionedTransactions({
        computeUnitPriceMicroLamports: 50_000,
      });

      if (txs.length > 0) {
        console.log(`   Built ${txs.length} posting tx(es) — sending to devnet…`);
        for (const tx of txs) {
          tx.sign([payer]);
          const sig = await connection.sendTransaction(tx);
          console.log(`   ✅  Posted: ${sig}`);
          await connection.confirmTransaction(sig, "confirmed");
        }

        // Read back price account
        const priceAccounts = await txBuilder.getPriceUpdateAccounts();
        if (priceAccounts.length > 0) {
          const acct = await connection.getAccountInfo(priceAccounts[0]);
          console.log(`   Price account: ${priceAccounts[0].toBase58()}`);
          console.log(`   Account exists: ${!!acct}, size: ${acct?.data?.length ?? 0}`);
        }
        return true;
      }
    } catch (e: any) {
      console.log(`   ❌  On-chain post failed: ${e.message}`);
      return false;
    }
  } catch (e: any) {
    console.log(`   ❌  Binary VAA fetch failed: ${e.message}`);
    return false;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  5. Other PreStocks symbols                                         */
/* ------------------------------------------------------------------ */

const OTHER_SYMBOLS = [
  "ANDURIL",
  "FIGUREAI",
  "KALSHI",
  "NEURALINK",
  "POLYMARKET",
  "SPACEX",
];

/* ------------------------------------------------------------------ */
/*  6. DEX pool for the TWAP                                           */
/* ------------------------------------------------------------------ */

async function findDexPool() {
  console.log("\n🏊  Looking for ANTHROPIC/USDC DEX pool …");

  // Search Jupiter for the token
  try {
    const searchRes = await fetch(
      "https://api.jup.ag/tokens/v1/search?query=ANTHROPIC",
    );
    if (searchRes.ok) {
      const tokens = await searchRes.json();
      console.log(
        `   Jupiter token search: ${Array.isArray(tokens) ? tokens.length : 0} results`,
      );
      if (Array.isArray(tokens)) {
        for (const t of tokens.slice(0, 5)) {
          console.log(
            `     ${t.symbol ?? "?"} — ${t.address} — name: ${t.name ?? "?"}`,
          );
        }
      }
    }
  } catch (e: any) {
    console.log(`   Jupiter token search failed: ${e.message}`);
  }

  // Try Jupiter Quote API for depth measurement
  // Need the ANTHROPIC token mint on mainnet first
  // Use prestocks.com API to get the contract address
  try {
    const psRes = await fetch("https://prestocks.com/api/prestocks");
    if (psRes.ok) {
      const stocks: any[] = await psRes.json();
      const anthro = stocks.find(
        (s) =>
          s.symbol === "ANTHROPIC" ||
          s.name?.toLowerCase().includes("anthropic"),
      );
      if (anthro) {
        console.log(
          `   PreStocks ANTHROPIC mint: ${anthro.contract_address ?? anthro.contractAddress ?? "?"}`,
        );
        console.log(
          `   markPrice: $${anthro.markPrice}  tokenPrice: $${anthro.tokenPrice}`,
        );

        const mint = anthro.contract_address ?? anthro.contractAddress;
        if (mint) {
          // Binary-search Jupiter Quote for max sale with ≤5% impact
          const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
          console.log("\n   📏  Measuring depth (max sell with ≤5% impact) …");
          let lo = 1;
          let hi = 100; // in tokens
          let bestAmount = 0;
          const tokenDecimals = 6; // PreStocks use ScaledUiAmount, 6 decimals typical

          for (let step = 0; step < 15; step++) {
            const mid = Math.floor((lo + hi) / 2);
            const amountRaw = mid * 10 ** tokenDecimals;
            try {
              const quoteRes = await fetch(
                `https://api.jup.ag/quote/v1?inputMint=${mint}&outputMint=${USDC_MINT}&amount=${amountRaw}&swapMode=ExactIn&slippageBps=500`,
              );
              if (quoteRes.ok) {
                const q = await quoteRes.json();
                const outAmount = Number(q.outAmount ?? 0) / 1e6;
                const fairValue = mid * (anthro.markPrice ?? anthro.tokenPrice);
                const impact =
                  fairValue > 0
                    ? ((fairValue - outAmount) / fairValue) * 100
                    : 100;
                console.log(
                  `     sell ${mid} tokens → $${outAmount.toFixed(2)} (impact ${impact.toFixed(1)}%)`,
                );
                if (impact <= 5) {
                  bestAmount = outAmount;
                  lo = mid + 1;
                } else {
                  hi = mid - 1;
                }
              } else {
                console.log(
                  `     sell ${mid} tokens → Jupiter ${quoteRes.status}`,
                );
                hi = mid - 1;
              }
            } catch (e: any) {
              console.log(`     sell ${mid} tokens → error: ${e.message}`);
              hi = mid - 1;
            }
          }
          console.log(`   Initial depth (≤5% impact): $${bestAmount.toFixed(2)}`);
          return bestAmount;
        }
      } else {
        console.log("   ANTHROPIC not found in PreStocks API response.");
      }
    }
  } catch (e: any) {
    console.log(`   PreStocks / Jupiter depth check failed: ${e.message}`);
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  PreLend — Day-0 Oracle Verification");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Hermes: ${HERMES}`);
  console.log(`  API key: ${PYTH_KEY ? PYTH_KEY.slice(0, 8) + "…" : "(none)"}`);

  // ── Step 1: Feed discovery ──────────────────────────────────────
  console.log("\n━━━ Step 1: Feed Discovery ━━━");
  const anthropicFeeds = await discoverFeeds("ANTHROPIC");
  const openaiFeeds = await discoverFeeds("OPENAI");

  // Also try explicit index format
  if (anthropicFeeds.length === 0) {
    console.log("\n   Retrying with 'Pyth.Index.ANTHROPIC' …");
    await discoverFeeds("Pyth.Index.ANTHROPIC");
  }
  if (openaiFeeds.length === 0) {
    console.log("\n   Retrying with 'Pyth.Index.OPENAI' …");
    await discoverFeeds("Pyth.Index.OPENAI");
  }

  // Pick the best feed for ANTHROPIC
  let anthropicFeed: FeedEntry | null = null;
  for (const f of anthropicFeeds) {
    const sym = f.attributes?.symbol ?? "";
    if (
      sym.includes("ANTHROPIC") &&
      (sym.includes("Index") || sym.includes("USD"))
    ) {
      anthropicFeed = f;
      break;
    }
  }
  if (!anthropicFeed && anthropicFeeds.length > 0) {
    anthropicFeed = anthropicFeeds[0];
  }

  let openAiFeed: FeedEntry | null = null;
  for (const f of openaiFeeds) {
    const sym = f.attributes?.symbol ?? "";
    if (
      sym.includes("OPENAI") &&
      (sym.includes("Index") || sym.includes("USD"))
    ) {
      openAiFeed = f;
      break;
    }
  }
  if (!openAiFeed && openaiFeeds.length > 0) {
    openAiFeed = openaiFeeds[0];
  }

  if (!anthropicFeed) {
    console.log("\n❌  ANTHROPIC feed NOT found. Market = RESTRICTED.");
    console.log("   Pyth track stops here for ANTHROPIC.");
  }

  // ── Step 2: Price and units ─────────────────────────────────────
  console.log("\n━━━ Step 2: Price and Units ━━━");
  let anthropicPythPrice: number | null = null;

  if (anthropicFeed) {
    const p = await fetchPrice(anthropicFeed.id);
    if (p?.price) {
      const u = priceUi(p);
      anthropicPythPrice = u.price;
      console.log(`   Pyth ANTHROPIC:`);
      console.log(`     price = $${u.price.toFixed(2)}`);
      console.log(`     conf  = ±$${u.conf.toFixed(2)}`);
      console.log(`     expo  = ${u.expo}`);
      console.log(
        `     publish_time = ${u.publishTime} (${new Date(u.publishTime * 1000).toISOString()})`,
      );
    } else {
      console.log("   ❌  Could not fetch ANTHROPIC price.");
    }
  }

  if (openAiFeed) {
    const p = await fetchPrice(openAiFeed.id);
    if (p?.price) {
      const u = priceUi(p);
      console.log(`   Pyth OPENAI:`);
      console.log(`     price = $${u.price.toFixed(2)}`);
      console.log(`     conf  = ±$${u.conf.toFixed(2)}`);
      console.log(`     expo  = ${u.expo}`);
      console.log(
        `     publish_time = ${u.publishTime} (${new Date(u.publishTime * 1000).toISOString()})`,
      );
    }
  }

  // Compare with PreStocks
  console.log("\n   Fetching PreStocks API for comparison…");
  let psMarkPrice: number | null = null;
  let psTokenPrice: number | null = null;
  try {
    const psRes = await fetch("https://prestocks.com/api/prestocks");
    if (psRes.ok) {
      const stocks: any[] = await psRes.json();
      const anthro = stocks.find(
        (s: any) =>
          s.symbol === "ANTHROPIC" ||
          s.name?.toLowerCase().includes("anthropic"),
      );
      if (anthro) {
        psMarkPrice = anthro.markPrice;
        psTokenPrice = anthro.tokenPrice;
        console.log(
          `   PreStocks ANTHROPIC: markPrice=$${psMarkPrice}  tokenPrice=$${psTokenPrice}`,
        );
      } else {
        console.log("   ANTHROPIC not found in PreStocks response.");
      }
    }
  } catch (e: any) {
    console.log(`   PreStocks fetch failed: ${e.message}`);
  }

  if (anthropicPythPrice && psMarkPrice) {
    const ratio = anthropicPythPrice / psMarkPrice;
    console.log(`\n   Pyth / markPrice ratio: ${ratio.toFixed(4)}`);
    if (ratio > 0.9 && ratio < 1.1) {
      console.log("   → Within 10%: per-share, unit scale ≈ 1 ✅");
    } else if (ratio > 1e6) {
      console.log(
        "   → Orders of magnitude off — likely a valuation, not per-share.",
      );
      console.log(
        `   → Conversion: divide Pyth by ${(ratio).toExponential(2)} to get per-share price.`,
      );
    } else {
      console.log(`   → Ratio ${ratio.toFixed(4)} — investigate scale.`);
    }
  }

  // ── Step 3: Update frequency and confidence ─────────────────────
  console.log("\n━━━ Step 3: Update Frequency and Confidence (5 min poll) ━━━");
  let pollResult = null;
  if (anthropicFeed) {
    pollResult = await pollFeed(anthropicFeed.id);
  } else {
    console.log("   Skipped — no ANTHROPIC feed.");
  }

  // ── Step 4: On-chain availability ───────────────────────────────
  console.log("\n━━━ Step 4: On-chain Availability (decisive test) ━━━");
  let onChainResult: boolean | string = false;
  if (anthropicFeed) {
    onChainResult = await testOnChain(anthropicFeed.id);
  } else {
    console.log("   Skipped — no ANTHROPIC feed.");
  }

  // ── Step 5: Other PreStocks symbols ─────────────────────────────
  console.log("\n━━━ Step 5: Other PreStocks Symbols ━━━");
  const otherResults: Record<string, boolean> = {};
  for (const sym of OTHER_SYMBOLS) {
    const feeds = await discoverFeeds(sym);
    otherResults[sym] = feeds.length > 0;
  }

  console.log("\n   Symbol table:");
  console.log("   ─────────────────────────────");
  for (const sym of OTHER_SYMBOLS) {
    console.log(`   ${sym.padEnd(15)} → ${otherResults[sym] ? "✅ feed found" : "❌ no feed"}`);
  }

  // ── Step 6: DEX pool for the TWAP ──────────────────────────────
  console.log("\n━━━ Step 6: DEX Pool & Depth ━━━");
  const depth = await findDexPool();

  // ── Decision block ─────────────────────────────────────────────
  const marketClass =
    onChainResult === true
      ? "A"
      : onChainResult === "likely"
        ? "A (likely — confirm with SDK)"
        : "restricted";

  const maxConf = pollResult
    ? `${pollResult.maxConf.toFixed(2)}%`
    : "unknown";
  const stalenessOk =
    pollResult && pollResult.maxGap < 300
      ? `${pollResult.maxGap}s (< 300s ✅)`
      : pollResult
        ? `${pollResult.maxGap}s (⚠ may exceed 300s limit)`
        : "unknown";

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║           DECISION BLOCK — paste into README        ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  ANTHROPIC market class : ${marketClass.padEnd(28)}║`);
  console.log(
    `║  pyth feed id           : ${anthropicFeed ? ("0x" + anthropicFeed.id.slice(0, 16) + "…").padEnd(28) : "none".padEnd(28)}║`,
  );
  console.log(
    `║  unit scale             : ${anthropicPythPrice && psMarkPrice ? (anthropicPythPrice / psMarkPrice).toFixed(4).padEnd(28) : "unknown".padEnd(28)}║`,
  );
  console.log(`║  staleness limit        : ${stalenessOk.padEnd(28)}║`);
  console.log(`║  max confidence         : ${maxConf.padEnd(28)}║`);
  console.log(
    `║  TWAP source            : ${"posted".padEnd(28)}║`,
  );
  console.log(
    `║  dex pool               : ${"see output above".padEnd(28)}║`,
  );
  console.log(
    `║  initial depth          : ${("$" + depth.toFixed(0)).padEnd(28)}║`,
  );
  console.log(`║  admin debt cap         : ${"50,000 USDC".padEnd(28)}║`);
  console.log("╚══════════════════════════════════════════════════════╝");

  if (anthropicFeed) {
    console.log(`\n  Full feed id: 0x${anthropicFeed.id}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

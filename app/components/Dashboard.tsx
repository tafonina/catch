"use client";

import Image from "next/image";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, type Keypair, type Transaction } from "@solana/web3.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LIQUIDATION_LTV,
  MAX_BORROW_LTV,
  PREVIEW_MAX_LTV,
  formatAprPct,
  healthFactor,
  ltvFromParts,
  marketYields,
  engageBids,
  stateForPosition,
  type BidRow,
} from "@/lib/loan";
import { ISOLATED_MARKETS, marketLabel, type MarketTab } from "@/lib/markets";
import { RESTRICTED_ORACLE, type PreStock } from "@/lib/prestocks";
import { buildDepositTx } from "@/lib/deposit-client";
import {
  buildBorrowTx,
  buildClaimStabilityTx,
  buildLiquidateTx,
  buildMigrateSpTx,
  buildRepayTx,
  buildSetTestPriceTx,
  buildWarpAccrualTx,
  buildStabilityDepositTx,
  buildWithdrawStabilityTx,
  buildWithdrawTx,
} from "@/lib/prelend-actions";
import {
  phantomInjected,
  reconnectTrustedPhantom,
  signerKey,
  walletIntent,
} from "@/lib/active-wallet";
import { sendWithPhantom } from "@/lib/wallet-send";
import {
  buildBurnLoanNftTx,
  buildMintLoanNftTx,
  buildSplBurnNftTx,
  clearStoredNft,
  findLoanNft,
  metadataUriFor,
  writeStoredNft,
} from "@/lib/loan-nft";
import { explorerAccount } from "@/lib/cluster";
import { isDemoWalletActive } from "@/lib/demo-wallets";
import { MOCK_ANTHROPIC, positionPda } from "@/lib/prelend";
import { PriceQuote, tokenLabel } from "@/components/PriceQuote";
import { WalletConnect } from "@/components/WalletConnect";
import { MarketDetails } from "@/components/MarketDetails";
import { recordMarketSnapshot } from "@/lib/market-history";

function formatUsd(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

function floorUsd(n: number, decimals = 6) {
  const f = 10 ** decimals;
  return Math.floor(n * f + 1e-9) / f;
}

function formatCompact(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(n));
}

export function Dashboard({
  marketId = "anthropic",
  initialTab = "lend",
  onBack,
}: {
  marketId?: string;
  initialTab?: MarketTab;
  onBack?: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const [stocks, setStocks] = useState<PreStock[]>([]);
  const listed = ISOLATED_MARKETS.find((m) => m.id === marketId) ?? ISOLATED_MARKETS[0];
  const [symbol, setSymbol] = useState(listed.base);
  const [collateralInput, setCollateralInput] = useState("10");
  const [ltvSlider, setLtvSlider] = useState(0.18);
  const [priceShock, setPriceShock] = useState(1);
  const [lendInput, setLendInput] = useState("");
  const [lendMode, setLendMode] = useState<"deposit" | "withdraw">("deposit");
  const [spInput, setSpInput] = useState("");
  const [bidDiscount, setBidDiscount] = useState(10);
  const [tab, setTab] = useState<MarketTab>(initialTab);
  const [deposited, setDeposited] = useState(0);
  const [usdcWallet, setUsdcWallet] = useState(0);
  const [borrowedUi, setBorrowedUi] = useState(0);
  const [poolValueUi, setPoolValueUi] = useState(0);
  const [borrowedOpen, setBorrowedOpen] = useState(false);
  const [loanDebt, setLoanDebt] = useState(0);
  const [loanPrincipal, setLoanPrincipal] = useState(0);
  const [loanCollateral, setLoanCollateral] = useState(0);
  const [loanLiquidated, setLoanLiquidated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [vaultOnChain, setVaultOnChain] = useState<number | null>(null);
  const [vaultMint, setVaultMint] = useState<string | null>(null);
  const [feeRecipient, setFeeRecipient] = useState<string | null>(null);
  const [collateralMint, setCollateralMint] = useState<string | null>(null);
  const [spUsdc, setSpUsdc] = useState(0);
  const [spCollateral, setSpCollateral] = useState(0);
  const [bidRows, setBidRows] = useState<BidRow[]>([]);
  const [mySpUsdc, setMySpUsdc] = useState(0);
  const [mySpClaimable, setMySpClaimable] = useState(0);
  const [spNeedsMigrate, setSpNeedsMigrate] = useState(false);
  const [spBlocked, setSpBlocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [collWallet, setCollWallet] = useState(0);
  const [activeWallet, setActiveWallet] = useState<string | null>(null);
  const [positionAddr, setPositionAddr] = useState<string | null>(null);
  const [nftMint, setNftMint] = useState<string | null>(null);
  const [userReady, setUserReady] = useState(true);
  const [lastAccrualTs, setLastAccrualTs] = useState(0);
  const [oraclePrice, setOraclePrice] = useState(0);
  const [testModePrice, setTestModePrice] = useState(0);
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const [debtCapUi, setDebtCapUi] = useState(0);
  const vaultFetch = useRef(0);

  useEffect(() => {
    const load = () => {
      fetchPre();
      void fetchVault();
    };
    void reconnectTrustedPhantom().then(load);
    const id = setInterval(load, 45_000);
    const phantom = phantomInjected();
    phantom?.on?.("connect", load);
    phantom?.on?.("accountChanged", load);
    phantom?.on?.("disconnect", load);
    window.addEventListener("prelend-wallet", load);
    return () => {
      clearInterval(id);
      phantom?.off?.("connect", load);
      phantom?.off?.("accountChanged", load);
      phantom?.off?.("disconnect", load);
      window.removeEventListener("prelend-wallet", load);
    };
  }, []);

  useEffect(() => {
    void fetchVault();
  }, [publicKey]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const senior = poolValueUi > 0 ? poolValueUi : (vaultOnChain ?? 0) + borrowedUi;
    if (senior <= 0 && borrowedUi <= 0) return;
    const y = marketYields({ borrowed: borrowedUi, senior, book: spUsdc });
    recordMarketSnapshot(listed.id, { t: Date.now(), util: y.util, borrowApr: y.borrowApr });
  }, [listed.id, borrowedUi, poolValueUi, vaultOnChain, spUsdc]);

  async function fetchPre() {
    const res = await fetch("/api/prestocks");
    const data = (await res.json()) as PreStock[];
    setStocks(data);
  }

  function activeKey() {
    return signerKey(publicKey);
  }

  function poolCollateralMint() {
    if (collateralMint) return collateralMint;
    if (listed.live && listed.id === "anthropic") return MOCK_ANTHROPIC;
    return null;
  }

  function walletId() {
    return activeKey()?.toBase58() ?? null;
  }

  async function fetchVault() {
    let key = activeKey();
    if (!key && walletIntent() === "connected") {
      setUserReady(false);
      for (let i = 0; i < 20 && !key; i += 1) {
        await new Promise((r) => window.setTimeout(r, 50));
        key = activeKey();
      }
    }
    const gen = ++vaultFetch.current;
    const expected = key?.toBase58() ?? null;
    if (expected) {
      const cached = sessionStorage.getItem(`prelend.bal.${expected}`);
      if (cached) {
        try {
          const snap = JSON.parse(cached) as { deposited?: number };
          if (typeof snap.deposited === "number") setDeposited(snap.deposited);
          setUserReady(true);
        } catch {
          setUserReady(false);
        }
      } else {
        setUserReady(false);
      }
    }
    const q = expected ? `?wallet=${expected}` : "";
    const res = await fetch(`/api/prelend/vault${q}`);
    const data = await res.json();
    if (gen !== vaultFetch.current) return;

    const stillSameWallet = (activeKey()?.toBase58() ?? null) === expected;
    const poolOk = Boolean(data.initialized && typeof data.uiAmount === "number");
    const walletOk =
      Boolean(expected) &&
      stillSameWallet &&
      (typeof data.wallet === "string" ? data.wallet === expected : Boolean(expected && q));

    if (data.stability) {
      const bookUi =
        (Number(data.stability.totalUsdc) + Number(data.stability.legacyUsdc || 0)) / 1e6;
      setSpUsdc(bookUi);
      setSpCollateral(
        (Number(data.stability.collateralHeld) + Number(data.stability.legacyColl || 0)) / 1e9,
      );
      const owners = Array.isArray(data.stability.owners) ? data.stability.owners : [];
      const amounts = Array.isArray(data.stability.bidUsdc) ? data.stability.bidUsdc : [];
      const discs = Array.isArray(data.stability.discountBps) ? data.stability.discountBps : [];
      setBidRows(
        owners
          .map((owner: string, i: number) => ({
            owner,
            usdc: Number(amounts[i] ?? 0) / 1e6,
            discountBps: Number(discs[i] ?? 0),
          }))
          .filter((row: BidRow) => row.usdc > 0),
      );
    }

    if (typeof data.collateralMint === "string" && data.collateralMint) {
      setCollateralMint(data.collateralMint);
    }

    if (poolOk) {
      setVaultOnChain(data.uiAmount);
      setVaultMint(typeof data.mint === "string" ? data.mint : null);
      setFeeRecipient(typeof data.feeRecipient === "string" ? data.feeRecipient : null);
      setBorrowedUi(typeof data.totalBorrowedUi === "number" ? data.totalBorrowedUi : 0);
      setDebtCapUi(data.stability ? Number(data.stability.totalUsdc) / 1e6 : 0);
      setPoolValueUi(typeof data.poolValueUi === "number" ? data.poolValueUi : 0);
      if (typeof data.testModePriceE6 === "number" && data.testModePriceE6 > 0) {
        const test = data.testModePriceE6 / 1e6;
        setTestModePrice(test);
        setOraclePrice(test);
      } else if (data.oracle) {
        const mark = Number(data.oracle.markPriceE6) / 1e6;
        const twap = Number(data.oracle.twapPriceE6) / 1e6;
        setTestModePrice(0);
        setOraclePrice(Math.min(mark, twap) || 0);
      } else if (!walletOk) {
        setTestModePrice(0);
        setOraclePrice(0);
      }
      setLastAccrualTs(typeof data.lastAccrualTs === "number" ? data.lastAccrualTs : 0);
    } else {
      setVaultOnChain(null);
      setVaultMint(null);
    }

    if (!walletOk || !poolOk) return;

    setDeposited(typeof data.lenderValueUi === "number" ? data.lenderValueUi : 0);
    setUserReady(true);
    if (expected && typeof data.lenderValueUi === "number") {
      sessionStorage.setItem(
        `prelend.bal.${expected}`,
        JSON.stringify({ deposited: data.lenderValueUi }),
      );
    }
    if (typeof data.usdcWalletUi === "number") setUsdcWallet(data.usdcWalletUi);
    if (typeof data.collateralWalletUi === "number") setCollWallet(data.collateralWalletUi);
    setActiveWallet(typeof data.wallet === "string" ? data.wallet : null);
    if (data.spPosition) {
      setMySpUsdc(Number(data.spPosition.usdcUi) || 0);
      setMySpClaimable(Number(data.spPosition.claimableUi) || 0);
      setSpNeedsMigrate(Boolean(data.spPosition.needsMigrate || data.stabilityDeposit?.legacy));
      setSpBlocked(Boolean(data.spPosition.blocked));
    } else {
      setMySpUsdc(0);
      setMySpClaimable(0);
      setSpNeedsMigrate(Boolean(data.stability?.needsMigrate));
      setSpBlocked(Boolean(data.stability?.legacyShares > 0 || data.stability?.needsMigrate));
    }
    const posOpen = Boolean(data.position && data.position.status === 0);
    const posLiq = Boolean(data.position && data.position.status === 1);
    setBorrowedOpen(posOpen);
    setLoanLiquidated(posLiq);
    setLoanDebt(typeof data.loanDebtUi === "number" ? data.loanDebtUi : 0);
    setLoanPrincipal(typeof data.loanPrincipalUi === "number" ? data.loanPrincipalUi : 0);
    setLoanCollateral(typeof data.loanCollateralUi === "number" ? data.loanCollateralUi : 0);
    const nextPosition = typeof data.positionAddress === "string" ? data.positionAddress : null;
    setPositionAddr(data.position ? nextPosition : null);
    if (gen !== vaultFetch.current) return;
    if (key && data.position && nextPosition) {
      try {
        const found = await findLoanNft(connection, key, nextPosition);
        if (gen === vaultFetch.current) setNftMint(found?.toBase58() ?? null);
      } catch {
        if (gen === vaultFetch.current) setNftMint(null);
      }
    } else {
      setNftMint(null);
    }
  }

  async function signSend(tx: Transaction, extraSigners?: Keypair[]) {
    await sendWithPhantom({
      connection,
      tx,
      extraSigners,
      signTransaction: signTransaction
        ? async (next) => (await signTransaction(next)) as typeof next
        : undefined,
    });
  }

  async function mintLoanNft(key: PublicKey, position: PublicKey, tokenSymbol: string) {
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ??
      (typeof window !== "undefined" ? window.location.origin : "");
    const built = await buildMintLoanNftTx({
      connection,
      owner: key,
      position,
      symbol: tokenSymbol,
      uri: metadataUriFor(origin, position),
    });
    await signSend(built.tx, [built.mint]);
    writeStoredNft(position.toBase58(), built.mint.publicKey.toBase58());
    setNftMint(built.mint.publicKey.toBase58());
    setPositionAddr(position.toBase58());
    return built.mint.publicKey;
  }

  async function burnLoanNft(key: PublicKey, position: string) {
    const mint = await findLoanNft(connection, key, position);
    if (!mint) return;
    try {
      await signSend(buildBurnLoanNftTx({ owner: key, mint }));
    } catch {
      await signSend(buildSplBurnNftTx({ owner: key, mint }));
    }
    clearStoredNft(position);
    setNftMint(null);
  }

  function fail(err: unknown, fallback: string) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    if (/User rejected|rejected the request|cancelled|canceled/i.test(msg)) ping("Rejected");
    else if (/Wallet has|need |insufficient|Not enough/i.test(msg)) ping("Not enough tokens");
    else if (/LTV over 30%/i.test(msg)) ping(msg);
    else ping(msg.trim() ? msg.slice(0, 90) : fallback);
  }

  const selected = stocks.find((s) => s.symbol === symbol) ?? stocks[0];
  const listedSymbol = listed.base;
  const isListed = (selected?.symbol ?? listedSymbol) === listedSymbol;
  const collateral = Number(collateralInput);
  const collateralAmt = Number.isFinite(collateral) && collateral > 0 ? collateral : 0;
  const livePrice = (selected?.tokenPrice ?? 0) * priceShock;
  const quotePrice = isListed && oraclePrice > 0 ? oraclePrice : livePrice;
  const collateralValue = collateralAmt * quotePrice;
  const previewLtv = Math.min(Math.max(ltvSlider, 0), PREVIEW_MAX_LTV);
  const borrowLtv = Math.min(previewLtv, MAX_BORROW_LTV);
  const overBorrowCap = previewLtv > MAX_BORROW_LTV + 1e-9;
  const maxBorrow = collateralValue * MAX_BORROW_LTV;
  const borrowAmount = collateralValue * borrowLtv;
  const remainingDebtCap = Math.max(0, debtCapUi - borrowedUi);
  const overDebtCap = borrowAmount > remainingDebtCap + 1e-6;
  const ltv = ltvFromParts(borrowAmount, collateralAmt, quotePrice);
  const cashUi = vaultOnChain ?? 0;
  const poolTotal = poolValueUi > 0 ? poolValueUi : cashUi;
  const yields = marketYields({ borrowed: borrowedUi, senior: poolTotal, book: spUsdc });
  const utilization = yields.util;
  const marketApr = yields.borrowApr;
  const lenderApr = yields.depositApr;
  const elapsed = lastAccrualTs > 0 ? Math.max(0, nowTs - lastAccrualTs) : 0;
  const displayDebt =
    borrowedOpen && loanDebt > 0
      ? loanDebt * (1 + marketApr * (elapsed / 31_536_000))
      : loanDebt;
  const liveMark = selected
    ? Math.min(selected.markPrice, selected.tokenPrice || selected.markPrice)
    : 0;
  const dropFromLive =
    liveMark > 0 && testModePrice > 0
      ? Math.round((1 - testModePrice / liveMark) * 100)
      : Math.round((1 - priceShock) * 100);
  const activeDrop = ([10, 20, 30, 40] as const).find((p) => Math.abs(dropFromLive - p) <= 2) ?? null;
  const usedPrice = oraclePrice > 0 ? oraclePrice : livePrice;
  const loanValue = loanCollateral * usedPrice;
  const liveLtv = borrowedOpen ? ltvFromParts(displayDebt, loanCollateral, usedPrice) : previewLtv;
  const nft = stateForPosition(liveLtv, loanLiquidated);
  const health = healthFactor(liveLtv);
  const loanInterest = Math.max(0, displayDebt - loanPrincipal);
  const withdrawable = Math.min(deposited, cashUi);
  const lendAmount = Number(lendInput);
  const spAmount = Number(spInput);
  const liveBids = engageBids(bidRows, borrowedUi);
  const myWallet = activeWallet ?? activeKey()?.toBase58() ?? null;
  const myBid = liveBids.find((b) => b.owner === myWallet);
  const myFree = myBid?.free ?? 0;
  const ceilingUsed = spUsdc > 0 ? Math.min(1, borrowedUi / spUsdc) : 0;

  function ping(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  }

  async function onLend() {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    if (!vaultMint || !collateralMint) return ping("Pool unavailable");
    const amount = Number(lendInput);
    if (!(amount > 0)) return ping("Enter a deposit amount.");
    if (amount > usdcWallet + 1e-9) return ping("Not enough USDC in wallet");
    setBusy("lend");
    try {
      const { tx } = await buildDepositTx({
        connection,
        lender: key,
        usdcMint: new PublicKey(vaultMint),
        collateralMint: new PublicKey(collateralMint),
        uiAmount: amount,
      });
      await signSend(tx);
      setLendInput("");
      await fetchVault();
      ping(`Deposited ${formatUsd(amount)}`);
    } catch (err) {
      fail(err, "Deposit failed");
    } finally {
      setBusy(null);
    }
  }

  async function onWithdraw() {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    if (!vaultMint || !collateralMint) return ping("Pool unavailable");
    const amount = floorUsd(Math.min(Number(lendInput), withdrawable));
    if (!(amount > 0)) return ping("Enter an amount.");
    if (Number(lendInput) > withdrawable + 1e-6) return ping("Only your idle pool cash can be withdrawn");
    setBusy("withdraw");
    try {
      const tx = await buildWithdrawTx({
        connection,
        lender: key,
        usdcMint: new PublicKey(vaultMint),
        collateralMint: new PublicKey(collateralMint),
        uiAmount: amount,
        fast:
          withdrawable > 0
            ? {
                tokenProgram: TOKEN_PROGRAM_ID,
                decimals: 6,
                lenderHasUsdcAta: true,
              }
            : undefined,
      });
      await signSend(tx);
      setLendInput("");
      ping(`Withdrew ${formatUsd(amount)}`);
    } catch (err) {
      fail(err, "Withdraw failed");
    } finally {
      setBusy(null);
    }
    void fetchVault();
  }

  async function onBorrow() {
    if (overBorrowCap || overDebtCap) return;
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    if (!vaultMint || !collateralMint || !feeRecipient) return ping("Pool unavailable");
    setBusy("borrow");
    try {
      await fetch("/api/prelend/crank", { method: "POST" });
      await signSend(
        await buildBorrowTx({
          connection,
          borrower: key,
          usdcMint: new PublicKey(vaultMint),
          collateralMint: new PublicKey(collateralMint),
          feeRecipient: new PublicKey(feeRecipient),
          collateralUi: collateralAmt,
          borrowUi: borrowAmount,
        }),
      );
      setBorrowedOpen(true);
      const position = positionPda(key, new PublicKey(collateralMint));
      try {
        await mintLoanNft(key, position, symbol);
        ping("Loan opened · NFT in wallet");
      } catch (nftErr) {
        console.error(nftErr);
        ping("Loan opened · NFT mint failed");
      }
      await fetchVault();
    } catch (err) {
      fail(err, "Borrow failed");
    } finally {
      setBusy(null);
    }
  }

  async function onRepay() {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    if (!vaultMint || !collateralMint) return ping("Pool unavailable");
    setBusy("repay");
    try {
      await signSend(
        await buildRepayTx({
          connection,
          borrower: key,
          usdcMint: new PublicKey(vaultMint),
          collateralMint: new PublicKey(collateralMint),
        }),
      );
      if (positionAddr) {
        try {
          await burnLoanNft(key, positionAddr);
        } catch (nftErr) {
          console.error(nftErr);
        }
      }
      setBorrowedOpen(false);
      setPriceShock(1);
      await fetchVault();
      ping("Repaid");
    } catch (err) {
      fail(err, "Repay failed");
    } finally {
      setBusy(null);
    }
  }

  async function simulateDrop(dropPct: 10 | 20 | 30 | 40) {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    const mint = poolCollateralMint();
    if (!mint) return ping("Pool unavailable");
    setBusy("drop");
    try {
      const used = selected
        ? Math.min(selected.markPrice, selected.tokenPrice || selected.markPrice)
        : 1032;
      const shock = 1 - dropPct / 100;
      await signSend(
        buildSetTestPriceTx({
          caller: key,
          collateralMint: new PublicKey(mint),
          priceE6: BigInt(Math.round(used * shock * 1e6)),
        }),
      );
      setPriceShock(shock);
      setTestModePrice(used * shock);
      void fetchVault();
      ping(`Price −${dropPct}%`);
    } catch (err) {
      fail(err, "Price update failed");
    } finally {
      setBusy(null);
    }
  }

  async function resetOracle() {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    setBusy("drop");
    try {
      const mint = poolCollateralMint();
      if (!mint) return ping("Pool unavailable");
      await signSend(
        buildSetTestPriceTx({
          caller: key,
          collateralMint: new PublicKey(mint),
          priceE6: 0n,
        }),
      );
      setPriceShock(1);
      setTestModePrice(0);
      await fetchVault();
      ping("Oracle restored");
    } catch (err) {
      fail(err, "Reset failed");
    } finally {
      setBusy(null);
    }
  }

  async function warpOneMonth() {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    const mint = poolCollateralMint();
    if (!mint) return ping("Pool unavailable");
    setBusy("drop");
    try {
      await signSend(
        buildWarpAccrualTx({
          caller: key,
          collateralMint: new PublicKey(mint),
          extraSecs: 2_628_000n,
        }),
      );
      await fetchVault();
      ping("1 month passed · +1% interest");
    } catch (err) {
      fail(err, "Time warp failed");
    } finally {
      setBusy(null);
    }
  }

  async function onLiquidate() {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    if (!vaultMint || !collateralMint) return ping("Pool unavailable");
    setBusy("liq");
    try {
      await signSend(
        await buildLiquidateTx({
          connection,
          caller: key,
          borrower: key,
          usdcMint: new PublicKey(vaultMint),
          collateralMint: new PublicKey(collateralMint),
        }),
      );
      setBorrowedOpen(false);
      setLoanLiquidated(true);
      if (positionAddr) {
        try {
          await burnLoanNft(key, positionAddr);
        } catch (nftErr) {
          console.error(nftErr);
        }
      }
      await fetchVault();
      ping("Liquidated");
    } catch (err) {
      fail(err, "Liquidate failed");
    } finally {
      setBusy(null);
    }
  }

  async function onSpDeposit() {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    if (!vaultMint || !collateralMint) return ping("Pool unavailable");
    if (!(spAmount > 0)) return ping("Enter an amount.");
    const discountBps = myBid ? myBid.discountBps : Math.round(bidDiscount * 100);
    setBusy("sp");
    try {
      await fetch("/api/prelend/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: key.toBase58(), token: "sol" }),
      });
      await fetch("/api/prelend/crank", { method: "POST" });
      await signSend(
        await buildStabilityDepositTx({
          connection,
          depositor: key,
          usdcMint: new PublicKey(vaultMint),
          collateralMint: new PublicKey(collateralMint),
          uiAmount: spAmount,
          discountBps,
        }),
      );
      setSpInput("");
      await fetchVault();
      ping(`Bid ${formatUsd(spAmount)} at −${bidDiscount}%`);
    } catch (err) {
      fail(err, "Bid failed");
    } finally {
      setBusy(null);
    }
  }

  async function onSpWithdraw(requested?: number) {
    const key = activeKey();
    if (!key || !vaultMint || !collateralMint) return;
    const mine = engageBids(bidRows, borrowedUi).find((b) => b.owner === key.toBase58());
    const free = mine?.free ?? 0;
    if (free <= 0) {
      return ping(
        (mine?.engaged ?? 0) > 0
          ? "This bid is covering loans. Only the idle tail can leave."
          : "Nothing to withdraw",
      );
    }
    const want = requested && requested > 0 ? requested : spAmount > 0 ? spAmount : free;
    const amt = floorUsd(Math.min(want, free));
    if (!(amt > 0)) return ping("Nothing idle to withdraw");
    if (want > free + 1e-6) {
      ping(`Only ${formatUsd(free)} is idle — the rest covers ${formatUsd(borrowedUi)} borrowed`);
    }
    setBusy("sp");
    try {
      await signSend(
        await buildWithdrawStabilityTx({
          connection,
          depositor: key,
          usdcMint: new PublicKey(vaultMint),
          collateralMint: new PublicKey(collateralMint),
          uiAmount: amt,
        }),
      );
      setSpInput("");
      await fetchVault();
      ping(amt + 1e-6 >= (mine?.usdc ?? 0) ? "Bid removed" : `Withdrew ${formatUsd(amt)}`);
    } catch (err) {
      fail(err, "Withdraw failed");
    } finally {
      setBusy(null);
    }
  }

  async function onSpClaim() {
    const key = activeKey();
    if (!key || !vaultMint || !collateralMint) return;
    if (!(mySpClaimable > 0)) return ping("No tokens to claim");
    setBusy("sp");
    try {
      await signSend(
        await buildClaimStabilityTx({
          connection,
          depositor: key,
          usdcMint: new PublicKey(vaultMint),
          collateralMint: new PublicKey(collateralMint),
        }),
      );
      await fetchVault();
      ping(`Claimed ${mySpClaimable.toFixed(4)} ANTHROPIC`);
    } catch (err) {
      fail(err, "Claim failed");
    } finally {
      setBusy(null);
    }
  }

  async function onSpMigrate() {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    const mint = collateralMint ?? MOCK_ANTHROPIC;
    setBusy("sp");
    ping("Approve in Phantom");
    try {
      await signSend(
        buildMigrateSpTx({
          payer: key,
          collateralMint: new PublicKey(mint),
          depositor: key,
        }),
      );
      await fetchVault();
      ping("Stability pool upgraded");
    } catch (err) {
      fail(err, "Upgrade failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="shrink-0">
            <img
              src="/catch-mark.svg"
              alt=""
              className="h-12 w-12 rounded-2xl border border-[rgba(212,175,55,0.18)]"
            />
          </Link>
          <div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              <Link href="/" className="hover:text-amber-200">
                Catch
              </Link>
            </h1>
            <p className="mt-1 max-w-xl text-sm text-slate-400">
              Isolated markets. Credit is capped by the bid book in that pool only.
            </p>
          </div>
        </div>
        <WalletConnect
          usdc={usdcWallet}
          anthropic={collWallet}
          onChanged={() => void fetchVault()}
          onRole={(next) =>
            setTab(next === "borrower" ? "borrow" : next === "bidder" ? "stability" : "lend")
          }
        />
      </header>

      <div className="mb-6">
        <div className="mb-1 flex gap-4 text-xs uppercase tracking-widest">
          <Link href="/" className="text-slate-500 hover:text-amber-200">
            ← Landing
          </Link>
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-slate-500 hover:text-amber-200"
            >
              ← Markets
            </button>
          ) : null}
        </div>
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{marketLabel(listed)}</h2>
        <p className="mt-1 max-w-xl text-sm text-slate-400">
          Isolated pool. LTV and rates apply only here. Credit is capped by this bid book.
        </p>
      </div>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Metric
          label="Total supply"
          value={formatUsd(poolTotal > 0 ? poolTotal : (vaultOnChain ?? 0), 0)}
          hint={`${(utilization * 100).toFixed(0)}% utilized`}
        />
        <Metric label="Borrowed USDC" value={formatUsd(borrowedUi, 0)} />
        <Metric
          label="Bid book"
          value={formatUsd(spUsdc, 0)}
          hint={`${(ceilingUsed * 100).toFixed(0)}% utilized`}
        />
        <Metric
          label="Max / Liq LTV"
          value={
            <>
              30% /{" "}
              <span className="group relative inline cursor-help border-b border-dotted border-amber-200/70">
                40%
                <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-56 -translate-x-1/2 rounded-2xl border border-white/10 bg-[#0c1018] p-3 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-slate-300 shadow-xl group-hover:block">
                  Partial liquidation down to Max LTV (30%).
                </span>
              </span>
            </>
          }
        />
        <Metric label="Borrow APY" value={formatAprPct(marketApr)} />
        <Metric
          label="Price"
          value={
            selected ? (
              <PriceQuote
                mark={selected.markPrice}
                token={selected.tokenPrice}
                display={testModePrice > 0 ? testModePrice : undefined}
                test={testModePrice > 0}
                name={tokenLabel(selected.name)}
                className={testModePrice > 0 ? "text-red-300" : "text-sky-300"}
              />
            ) : (
              "—"
            )
          }
          hint={selected ? tokenLabel(selected.name) : listedSymbol}
        />
      </section>

      <nav className="mb-6 flex flex-wrap gap-8 border-b border-white/10">
        {(
          [
            ["lend", "Lend"],
            ["borrow", "Borrow"],
            ["stability", "Bids"],
            ["details", "Market details"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 pb-3 text-xl ${
              tab === id
                ? "border-white font-semibold text-white"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "details" && (
        <MarketDetails
          marketId={listed.id}
          borrowed={borrowedUi}
          senior={poolTotal}
          book={spUsdc}
          yields={yields}
        />
      )}

      {tab === "lend" && (
        <section className="panel max-w-3xl rounded-3xl p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xl">Earn on USDC</h2>
            <span className="mono text-lg text-emerald-400">APY {formatAprPct(lenderApr)}</span>
          </div>
          <p className="mb-4 text-sm text-slate-400">
            Senior vault. Borrow APY is kinked: 10% at 0% used → 15% at 80% → 30% full. Deposit APY
            is your share of that interest after the 10% reserve and the 5% senior floor, split
            with engaged bids. Now {formatAprPct(lenderApr)} deposit with{" "}
            {(utilization * 100).toFixed(0)}% utilized.
          </p>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <Stat label="Your position" value={userReady ? formatUsd(deposited, 2) : "…"} />
            <Stat
              label="Available to withdraw now"
              value={userReady ? formatUsd(withdrawable, 2) : "…"}
            />
          </div>
          <div className="mb-4 flex gap-2">
            {(
              [
                ["deposit", "Deposit"],
                ["withdraw", "Withdraw"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setLendMode(id);
                  setLendInput("");
                }}
                className={`rounded-full px-4 py-1.5 text-sm ${
                  lendMode === id ? "bg-amber-400 font-semibold text-black" : "bg-black/30 text-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {lendMode === "withdraw" && withdrawable + 0.01 < deposited ? (
            <p className="mb-3 text-xs text-slate-500">
              {formatUsd(deposited - withdrawable, 2)} is out on loans until borrowers repay.
            </p>
          ) : null}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1 text-xs text-slate-500">
              Amount
              <input
                type="number"
                inputMode="decimal"
                placeholder="0"
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-base text-white"
                value={lendInput}
                min={0}
                onChange={(e) => setLendInput(e.target.value)}
              />
            </label>
            {lendMode === "withdraw" ? (
              <button
                type="button"
                disabled={withdrawable <= 0}
                onClick={() => setLendInput(String(floorUsd(withdrawable)))}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm disabled:opacity-50"
              >
                Max
              </button>
            ) : null}
            {lendMode === "deposit" ? (
              <button
                onClick={() => void onLend()}
                disabled={busy !== null || !(lendAmount > 0) || lendAmount > usdcWallet + 1e-9}
                className="rounded-xl bg-amber-400 px-5 py-2 font-semibold text-black disabled:opacity-50"
              >
                {busy === "lend" ? "Depositing…" : "Deposit"}
              </button>
            ) : (
              <button
                onClick={() => void onWithdraw()}
                disabled={busy !== null || !(lendAmount > 0) || lendAmount > withdrawable + 1e-9}
                className="rounded-xl bg-amber-400 px-5 py-2 font-semibold text-black disabled:opacity-50"
              >
                {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
              </button>
            )}
          </div>
        </section>
      )}

      {tab === "borrow" && (
      <section className="grid items-start gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          {isListed && borrowedOpen ? (
          <div className="panel rounded-3xl p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-xl">Your {listedSymbol} loan</h2>
              <span className="mono text-lg text-sky-300">
                {formatAprPct(marketApr)} APR · Liq 40%
              </span>
            </div>
            {liveLtv >= LIQUIDATION_LTV ? (
              <p className="mb-3 text-xs text-orange-300">
                Liquidatable — LTV is at or above 40%. The loan is still open until someone
                liquidates.
              </p>
            ) : null}
            <p className="mb-4 text-sm text-slate-400">
              One loan per listed token. Repay in full to unlock collateral and borrow again.
            </p>
            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              <Stat label="Debt (you owe)" value={formatUsd(displayDebt, 2)} />
              <Stat
                label="Collateral locked"
                value={`${loanCollateral.toFixed(4)} ${listedSymbol}`}
                hint={formatUsd(loanValue)}
              />
              <Stat label="Original borrow" value={formatUsd(loanPrincipal, 2)} />
              <Stat label="Interest accrued" value={formatUsd(loanInterest, 2)} />
              <Stat label="LTV" value={`${(liveLtv * 100).toFixed(2)}%`} />
              <Stat
                label="Health factor"
                value={Number.isFinite(health) ? health.toFixed(2) : "—"}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void onRepay()}
                disabled={busy !== null}
                className="rounded-xl bg-white px-5 py-2 font-semibold text-black disabled:opacity-50"
              >
                {busy === "repay" ? "Repaying…" : `Repay ${formatUsd(displayDebt, 2)}`}
              </button>
              <button
                onClick={() => void onLiquidate()}
                disabled={busy !== null || liveLtv < LIQUIDATION_LTV}
                className="rounded-xl bg-red-500/80 px-5 py-2 font-semibold disabled:opacity-50"
              >
                Liquidate
              </button>
            </div>
            {usdcWallet + 1e-6 < displayDebt ? (
              <p className="mt-3 text-xs text-amber-300">
                Wallet has {formatUsd(usdcWallet, 2)} USDC. You need {formatUsd(displayDebt, 2)} to repay.
              </p>
            ) : null}
          </div>
          ) : isListed && !loanLiquidated ? (
          <div className="panel rounded-3xl p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xl">Open a {selected?.symbol ?? listedSymbol} loan</h2>
              <span className="mono text-lg text-sky-300">{formatAprPct(marketApr)} APR</span>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Lock {selected?.symbol ?? listedSymbol}, borrow USDC up to 30% LTV. You repay debt plus
              interest.
            </p>
            <label className="text-xs text-slate-500">
              Collateral ({selected?.symbol ?? "PreStock"} · wallet {collWallet.toFixed(2)})
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white"
                value={collateralInput}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === "" || /^\d*\.?\d*$/.test(next)) setCollateralInput(next);
                }}
              />
            </label>
            <div className="mt-5">
              <div className="mb-2 flex justify-between text-xs text-slate-400">
                <span>Borrow USDC</span>
                <span className="mono">
                  {overBorrowCap
                    ? `${formatUsd(maxBorrow)} · max 30%`
                    : overDebtCap
                      ? `${formatUsd(remainingDebtCap)} · protocol cap`
                      : `${formatUsd(borrowAmount)} · ${(ltv * 100).toFixed(1)}% LTV`}
                </span>
              </div>
              <input
                className="range"
                type="range"
                min={0.05}
                max={PREVIEW_MAX_LTV}
                step={0.005}
                value={ltvSlider}
                onChange={(e) => setLtvSlider(Number(e.target.value))}
              />
              <div className="mono mt-2 flex justify-between text-[11px] text-slate-500">
                <span>Safe &lt;30%</span>
                <span>Liq 40%</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <Stat label="Collateral value" value={formatUsd(collateralValue)} />
              <Stat label="You receive" value={formatUsd(borrowAmount)} />
              <Stat
                label="Health factor"
                value={Number.isFinite(health) ? health.toFixed(2) : "—"}
              />
            </div>
            <div className="mt-5">
              <button
                onClick={() => void onBorrow()}
                disabled={overBorrowCap || overDebtCap || busy !== null || !(collateralAmt > 0)}
                className={`rounded-xl px-5 py-2 font-semibold disabled:opacity-50 ${
                  overBorrowCap || overDebtCap
                    ? "cursor-not-allowed bg-white/20 text-slate-400"
                    : "bg-white text-black"
                }`}
              >
                {busy === "borrow"
                  ? "Borrowing…"
                  : overDebtCap
                    ? `Cap ${formatUsd(remainingDebtCap, 0)}`
                    : `Borrow ${formatUsd(borrowAmount)}`}
              </button>
              {overDebtCap ? (
                <p className="mt-3 text-xs text-amber-300">
                  Outstanding debt cannot exceed {formatUsd(debtCapUi, 0)} (locked bids). Lower LTV or lock less collateral.
                </p>
              ) : null}
            </div>
          </div>
          ) : (
          <div className="panel rounded-3xl p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-xl">{selected?.symbol ?? "Market"}</h2>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-400">
                Not listed
              </span>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              {selected
                ? `${formatUsd(selected.tokenPrice)} mark · oracle and vault are not live for this token yet.`
                : "Select a market."}{" "}
              Day-0 listing is {listedSymbol} only.
            </p>
            {borrowedOpen ? (
              <button
                type="button"
                onClick={() => setSymbol(listedSymbol)}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm"
              >
                View your {listedSymbol} loan
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSymbol(listedSymbol)}
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black"
              >
                Open a {listedSymbol} loan
              </button>
            )}
          </div>
          )}

          <div className="panel rounded-3xl p-5">
            <h2 className="mb-4 text-xl">
              Market <span className="text-base font-normal text-slate-500">(for demo)</span>
            </h2>
            <p className="mb-3 text-sm text-slate-400">
              Borrow APY is kinked (now {formatAprPct(marketApr)}). Max LTV 30% and liquidation at
              40% apply only to this pool. Liquidation trims back to 30%.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {([10, 20, 30, 40] as const).map((pct) => {
                const active = activeDrop === pct;
                return (
                  <button
                    key={pct}
                    onClick={() => void simulateDrop(pct)}
                    disabled={busy !== null}
                    className={`rounded-xl px-4 py-2 font-semibold disabled:opacity-50 ${
                      active
                        ? "bg-red-500 text-white"
                        : "border border-red-400/50 bg-red-500/15 text-red-100"
                    }`}
                  >
                    −{pct}%
                  </button>
                );
              })}
              <button
                onClick={() => void resetOracle()}
                disabled={busy !== null}
                className="rounded-xl border border-slate-500 px-4 py-2 font-semibold text-slate-200 disabled:opacity-50"
              >
                Reset oracle
              </button>
              <button
                onClick={() => void warpOneMonth()}
                disabled={busy !== null}
                className="rounded-xl border border-amber-400/50 bg-amber-400/15 px-4 py-2 font-semibold text-amber-100 disabled:opacity-50"
              >
                +1 month
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel overflow-hidden rounded-3xl p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl">Loan cNFT</h2>
              <span>
                {nft.emoji} {nft.name}
              </span>
            </div>
            <div
              className="relative overflow-hidden rounded-2xl"
              style={{ boxShadow: `0 0 40px ${nft.glow}` }}
            >
              <Image
                src={nft.image}
                alt={nft.name}
                width={800}
                height={800}
                className="aspect-square w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                <div className="text-lg">{nft.status}</div>
                <div className="mono text-xs text-slate-300">
                  Risk {nft.risk} · Liquidation {nft.liquidation}
                </div>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-400">
              <div>LTV {(liveLtv * 100).toFixed(2)}%</div>
              <div>{loanLiquidated ? "Liquidated" : borrowedOpen ? "Live loan" : "Preview"}</div>
              <div>
                {nftMint
                  ? `NFT ${nftMint.slice(0, 4)}…${nftMint.slice(-4)}`
                  : `Mint ${selected?.contract_address.slice(0, 8) ?? "—"}…`}
              </div>
              <div>{borrowedOpen ? listedSymbol : (selected?.symbol ?? "—")}</div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {positionAddr ? (
                <a
                  href={`/p/${positionAddr}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-white/15 px-3 py-1.5"
                >
                  Share card
                </a>
              ) : null}
              {nftMint && explorerAccount(nftMint) ? (
                <a
                  href={explorerAccount(nftMint)!}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-white/15 px-3 py-1.5"
                >
                  Explorer
                </a>
              ) : null}
              {borrowedOpen && positionAddr && collateralMint && !nftMint ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    const key = activeKey();
                    if (!key || !positionAddr) return;
                    setBusy("nft");
                    void mintLoanNft(key, new PublicKey(positionAddr), symbol)
                      .then(() => ping("NFT minted"))
                      .catch((err) => fail(err, "NFT mint failed"))
                      .finally(() => setBusy(null));
                  }}
                  className="rounded-lg bg-amber-400/90 px-3 py-1.5 font-semibold text-black disabled:opacity-50"
                >
                  Mint loan NFT
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      )}

      {tab === "stability" && (
      <section className="grid items-start gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="panel rounded-3xl p-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl">Place a bid</h2>
              <span className="mono text-lg text-amber-200">
                Bid APY {formatAprPct(yields.bidApr)}
              </span>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Lock USDC at a discount. Tightest bids fill first and become the loan ceiling.
            </p>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <Stat label="Bid book" value={formatUsd(spUsdc, 0)} hint="Debt ceiling" />
              <Stat
                label="Ceiling used"
                value={`${(ceilingUsed * 100).toFixed(0)}%`}
                hint={`${formatUsd(borrowedUi, 0)} borrowed`}
              />
              <Stat label="Unfilled room" value={formatUsd(Math.max(0, spUsdc - borrowedUi), 0)} />
            </div>
            {spNeedsMigrate ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">
                <p className="text-sm text-amber-100">
                  Upgrade this wallet from the old share ledger once.
                </p>
                <button
                  onClick={() => void onSpMigrate()}
                  disabled={busy !== null}
                  className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-black disabled:opacity-50"
                >
                  Upgrade position
                </button>
              </div>
            ) : spBlocked ? (
              <p className="mb-4 text-sm text-amber-200">
                New deposits wait until leftover share positions are upgraded.
              </p>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[10rem] flex-1 text-xs text-slate-500">
                Amount
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-base text-white"
                  value={spInput}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === "" || /^\d*\.?\d*$/.test(next)) setSpInput(next);
                  }}
                />
              </label>
              <label className="w-24 text-xs text-slate-500">
                Discount
                <select
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-2 py-2 text-base text-white disabled:opacity-60"
                  value={myBid ? Math.round(myBid.discountBps / 100) : bidDiscount}
                  disabled={Boolean(myBid)}
                  onChange={(e) => setBidDiscount(Number(e.target.value))}
                >
                  {(myBid ? [Math.round(myBid.discountBps / 100)] : [10, 15, 20, 25, 30]).map(
                    (pct) => (
                      <option key={pct} value={pct}>
                        {pct}%
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setSpInput(usdcWallet > 0 ? String(floorUsd(usdcWallet)) : "")}
                className="mb-0.5 text-xs text-sky-300"
              >
                Max
              </button>
              <button
                onClick={() => void onSpDeposit()}
                disabled={busy !== null || !(spAmount > 0) || spBlocked}
                className="rounded-xl bg-amber-400 px-5 py-2 font-semibold text-black disabled:opacity-50"
              >
                Place bid
              </button>
            </div>
            {myBid && myFree < myBid.usdc ? (
              <p className="mt-3 text-xs text-slate-500">
                A bid cannot leave if the remaining book would fall below{" "}
                {formatUsd(borrowedUi, 0)} borrowed. Your idle slice is {formatUsd(myFree)}.
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel overflow-hidden rounded-3xl p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl">Live bids</h2>
              <span className="mono text-xs text-slate-400">{liveBids.length} in book</span>
            </div>
            {liveBids.length === 0 ? (
              <p className="rounded-2xl bg-black/30 px-4 py-8 text-center text-sm text-slate-500">
                No bids yet. Yours will be first.
              </p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <div className="grid grid-cols-[2rem_1fr_1fr_4.5rem] gap-2 border-b border-white/10 px-3 py-2 text-[11px] uppercase tracking-widest text-slate-500">
                  <div>#</div>
                  <div>USDC</div>
                  <div className="text-center">Wallet</div>
                  <div className="text-right">Discount</div>
                </div>
                {liveBids.map((row, i) => {
                  const mine = row.owner === myWallet;
                  const covering = row.engaged > 0;
                  return (
                    <div
                      key={`${row.owner}-${i}`}
                      className={`cursor-default border-t border-white/5 px-3 py-2.5 transition-colors hover:bg-white/[0.06] ${
                        mine ? "bg-amber-400/10 hover:bg-amber-400/15" : ""
                      }`}
                    >
                      <div className="grid grid-cols-[2rem_1fr_1fr_4.5rem] items-center gap-2 text-sm">
                        <div className="mono text-slate-500">{i + 1}</div>
                        <div>
                          <div className="mono">{formatUsd(row.usdc)}</div>
                          {mine ? (
                            <div className="text-[11px] text-slate-400">
                              {covering
                                ? `${formatUsd(row.free)} idle / ${formatUsd(row.engaged)} covering`
                                : `${formatUsd(row.free)} idle`}
                            </div>
                          ) : (
                            <div className={`text-[11px] ${covering ? "text-amber-200/80" : "text-slate-500"}`}>
                              {covering ? "Covering" : "Idle"}
                            </div>
                          )}
                        </div>
                        <div className="text-center font-mono text-[11px] text-slate-500">
                          {row.owner.slice(0, 4)}…{row.owner.slice(-4)}
                          {mine ? (
                            <div className="mt-0.5 text-[10px] font-semibold text-amber-300">You</div>
                          ) : null}
                        </div>
                        <div className="text-right text-base font-semibold">
                          −{(row.discountBps / 100).toFixed(0)}%
                        </div>
                      </div>
                      {mine ? (
                        <div className="mt-2 flex flex-wrap justify-end gap-2">
                          {mySpClaimable > 0 ? (
                            <button
                              type="button"
                              onClick={() => void onSpClaim()}
                              disabled={busy !== null}
                              className="rounded-lg bg-sky-400 px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
                            >
                              Claim {mySpClaimable.toFixed(4)} ANTH
                            </button>
                          ) : null}
                          {row.free > 0 ? (
                            <button
                              type="button"
                              onClick={() => void onSpWithdraw(row.free)}
                              disabled={busy !== null}
                              className="rounded-lg border border-white/20 px-3 py-1 text-xs disabled:opacity-50"
                            >
                              {covering ? "Withdraw idle" : "Remove"}
                            </button>
                          ) : covering ? (
                            <span className="text-[11px] text-slate-500">Locked by debt</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {spCollateral > 0 ? (
              <p className="mt-4 text-xs text-slate-500">
                Book holds {spCollateral.toFixed(4)} ANTH from fills — claim from your card.
              </p>
            ) : null}
          </div>
        </div>
      </section>
      )}

      {tab === "borrow" && (
      <section className="panel mt-6 rounded-3xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl">Oracle</h2>
          <span className="mono text-[11px] text-amber-300">{RESTRICTED_ORACLE.marketClass}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="mono text-[11px] text-slate-500">Price used</div>
            <div className="text-lg">
              {selected ? (
                <PriceQuote
                  mark={selected.markPrice}
                  token={selected.tokenPrice}
                  display={testModePrice > 0 ? testModePrice : usedPrice}
                  test={testModePrice > 0}
                  name={tokenLabel(selected.name)}
                  className={testModePrice > 0 ? "text-red-300" : "text-sky-300"}
                />
              ) : usedPrice > 0 ? (
                formatUsd(usedPrice)
              ) : (
                "—"
              )}
            </div>
            <div className="text-[11px] text-slate-500">
              {testModePrice > 0 && activeDrop ? `test −${activeDrop}%` : "min(mark, token)"}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="mono text-[11px] text-slate-500">PreStocks mark</div>
            <div className="text-lg">{selected ? formatUsd(selected.markPrice) : "—"}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="mono text-[11px] text-slate-500">DEX token</div>
            <div className="text-lg">{selected ? formatUsd(selected.tokenPrice) : "—"}</div>
          </div>
        </div>
        {selected && (
          <p className="mt-3 text-xs text-slate-500">
            Implied {formatCompact(selected.impliedValuation)}
          </p>
        )}
      </section>
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-semibold text-black shadow-xl">
          {toast}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-black/30 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mono">{value}</div>
      {hint ? <div className="mono text-[11px] text-slate-400">{hint}</div> : null}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="panel rounded-2xl px-4 py-3">
      <div className="mono text-[11px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 text-lg text-amber-200">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

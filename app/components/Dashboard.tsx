"use client";

import Image from "next/image";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, type Keypair, type Transaction } from "@solana/web3.js";
import { useEffect, useRef, useState } from "react";
import {
  BORROW_APR,
  LIQUIDATION_LTV,
  MAX_BORROW_LTV,
  PREVIEW_MAX_LTV,
  healthFactor,
  ltvFromParts,
  stateForPosition,
} from "@/lib/loan";
import { RESTRICTED_ORACLE, type PreStock } from "@/lib/prestocks";
import { buildDepositTx } from "@/lib/deposit-client";
import {
  buildBorrowTx,
  buildClaimStabilityTx,
  buildClaimSurplusTx,
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
import { MOCK_ANTHROPIC, positionPda } from "@/lib/prelend";
import { readLoanHistory, upsertLoanRecord, type LoanRecord } from "@/lib/loan-history";
import { WalletConnect } from "@/components/WalletConnect";

function formatUsd(n: number, digits = 2) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

function floorUsd(n: number, decimals = 6) {
  const f = 10 ** decimals;
  return Math.floor(n * f + 1e-9) / f;
}

function formatCompact(n: number) {
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function Dashboard() {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const [stocks, setStocks] = useState<PreStock[]>([]);
  const [symbol, setSymbol] = useState("ANTHROPIC");
  const [collateral, setCollateral] = useState(10);
  const [ltvSlider, setLtvSlider] = useState(0.18);
  const [priceShock, setPriceShock] = useState(1);
  const [poolUsdc, setPoolUsdc] = useState(250_000);
  const [lendInput, setLendInput] = useState("");
  const [lendMode, setLendMode] = useState<"deposit" | "withdraw">("deposit");
  const [spInput, setSpInput] = useState("");
  const [tab, setTab] = useState<"lend" | "borrow" | "stability">("lend");
  const [deposited, setDeposited] = useState(0);
  const [usdcWallet, setUsdcWallet] = useState(0);
  const [borrowedUi, setBorrowedUi] = useState(0);
  const [poolValueUi, setPoolValueUi] = useState(0);
  const [borrowedOpen, setBorrowedOpen] = useState(false);
  const [loanDebt, setLoanDebt] = useState(0);
  const [loanPrincipal, setLoanPrincipal] = useState(0);
  const [loanCollateral, setLoanCollateral] = useState(0);
  const [loanSurplus, setLoanSurplus] = useState(0);
  const [loanLiquidated, setLoanLiquidated] = useState(false);
  const [loanHistory, setLoanHistory] = useState<LoanRecord[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [vaultOnChain, setVaultOnChain] = useState<number | null>(null);
  const [vaultMint, setVaultMint] = useState<string | null>(null);
  const [feeRecipient, setFeeRecipient] = useState<string | null>(null);
  const [collateralMint, setCollateralMint] = useState<string | null>(null);
  const [spUsdc, setSpUsdc] = useState(0);
  const [spCollateral, setSpCollateral] = useState(0);
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

  async function fetchPre() {
    const res = await fetch("/api/prestocks");
    const data = (await res.json()) as PreStock[];
    setStocks(data);
  }

  function activeKey() {
    return signerKey(publicKey);
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
    if ((activeKey()?.toBase58() ?? null) !== expected) return;
    if (data.initialized && typeof data.uiAmount === "number") {
      setVaultOnChain(data.uiAmount);
      setVaultMint(typeof data.mint === "string" ? data.mint : null);
      setFeeRecipient(typeof data.feeRecipient === "string" ? data.feeRecipient : null);
      setCollateralMint(typeof data.collateralMint === "string" ? data.collateralMint : null);
      setDeposited(typeof data.lenderValueUi === "number" ? data.lenderValueUi : 0);
      setUserReady(true);
      if (expected && typeof data.lenderValueUi === "number") {
        sessionStorage.setItem(
          `prelend.bal.${expected}`,
          JSON.stringify({ deposited: data.lenderValueUi }),
        );
      }
      setUsdcWallet(typeof data.usdcWalletUi === "number" ? data.usdcWalletUi : 0);
      setBorrowedUi(typeof data.totalBorrowedUi === "number" ? data.totalBorrowedUi : 0);
      {
        const depth = typeof data.postedDepthUi === "number" ? data.postedDepthUi : 0;
        const sp = data.stability
          ? (Number(data.stability.totalUsdc) + Number(data.stability.legacyUsdc || 0)) / 1e6
          : 0;
        setDebtCapUi(sp + depth);
      }
      setPoolValueUi(typeof data.poolValueUi === "number" ? data.poolValueUi : 0);
      setCollWallet(typeof data.collateralWalletUi === "number" ? data.collateralWalletUi : 0);
      setActiveWallet(typeof data.wallet === "string" ? data.wallet : null);
      if (data.stability) {
        setSpUsdc(
          (Number(data.stability.totalUsdc) + Number(data.stability.legacyUsdc || 0)) / 1e6,
        );
        setSpCollateral(
          (Number(data.stability.collateralHeld) + Number(data.stability.legacyColl || 0)) / 1e9,
        );
      }
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
      setLoanSurplus(typeof data.loanClaimableUi === "number" ? data.loanClaimableUi : 0);
      setLastAccrualTs(typeof data.lastAccrualTs === "number" ? data.lastAccrualTs : 0);
      if (typeof data.testModePriceE6 === "number" && data.testModePriceE6 > 0) {
        const test = data.testModePriceE6 / 1e6;
        setTestModePrice(test);
        setOraclePrice(test);
      } else if (data.oracle) {
        const mark = Number(data.oracle.markPriceE6) / 1e6;
        const twap = Number(data.oracle.twapPriceE6) / 1e6;
        setTestModePrice(0);
        setOraclePrice(Math.min(mark, twap) || 0);
      } else {
        setTestModePrice(0);
        setOraclePrice(0);
      }
      const nextPosition = typeof data.positionAddress === "string" ? data.positionAddress : null;
      setPositionAddr(data.position ? nextPosition : null);
      if (expected) {
        if (posOpen && nextPosition) {
          setLoanHistory(
            upsertLoanRecord(expected, {
              position: nextPosition,
              symbol: listedSymbol,
              status: "open",
              collateral: typeof data.loanCollateralUi === "number" ? data.loanCollateralUi : 0,
              principal: typeof data.loanPrincipalUi === "number" ? data.loanPrincipalUi : 0,
              surplus: 0,
              at: Date.now(),
            }),
          );
        } else if (posLiq && nextPosition) {
          setLoanHistory(
            upsertLoanRecord(expected, {
              position: nextPosition,
              symbol: listedSymbol,
              status: "liquidated",
              collateral: typeof data.loanCollateralUi === "number" ? data.loanCollateralUi : 0,
              principal: typeof data.loanPrincipalUi === "number" ? data.loanPrincipalUi : 0,
              surplus: typeof data.loanClaimableUi === "number" ? data.loanClaimableUi : 0,
              at: Date.now(),
            }),
          );
        } else {
          setLoanHistory(readLoanHistory(expected));
        }
      }
      if (key && data.position && nextPosition) {
        try {
          const found = await findLoanNft(connection, key, nextPosition);
          setNftMint(found?.toBase58() ?? null);
        } catch {
          setNftMint(null);
        }
      } else {
        setNftMint(null);
      }
    } else {
      setVaultOnChain(null);
      setVaultMint(null);
    }
  }

  async function signSend(tx: Transaction, extraSigners?: Keypair[]) {
    const injected = (
      window as unknown as {
        phantom?: { solana?: { isConnected?: boolean; connect: () => Promise<unknown> } };
      }
    ).phantom?.solana;
    if (injected && !injected.isConnected) await injected.connect();
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
  const listedSymbol = "ANTHROPIC";
  const isListed = (selected?.symbol ?? listedSymbol) === listedSymbol;
  const livePrice = (selected?.tokenPrice ?? 0) * priceShock;
  const quotePrice = isListed && oraclePrice > 0 ? oraclePrice : livePrice;
  const collateralValue = collateral * quotePrice;
  const previewLtv = Math.min(Math.max(ltvSlider, 0), PREVIEW_MAX_LTV);
  const borrowLtv = Math.min(previewLtv, MAX_BORROW_LTV);
  const overBorrowCap = previewLtv > MAX_BORROW_LTV + 1e-9;
  const maxBorrow = collateralValue * MAX_BORROW_LTV;
  const borrowAmount = collateralValue * borrowLtv;
  const remainingDebtCap = Math.max(0, debtCapUi - borrowedUi);
  const overDebtCap = borrowAmount > remainingDebtCap + 1e-6;
  const ltv = ltvFromParts(borrowAmount, collateral, quotePrice);
  const elapsed = lastAccrualTs > 0 ? Math.max(0, nowTs - lastAccrualTs) : 0;
  const displayDebt =
    borrowedOpen && loanDebt > 0
      ? loanDebt * (1 + BORROW_APR * (elapsed / 31_536_000))
      : loanDebt;
  const liveMark = selected ? Math.min(selected.markPrice, selected.tokenPrice) : 0;
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
  const cashUi = vaultOnChain ?? 0;
  const poolTotal = poolValueUi > 0 ? poolValueUi : cashUi + borrowedUi;
  const utilization = poolTotal > 0 ? Math.min(1, borrowedUi / poolTotal) : 0;
  const lenderApr = BORROW_APR * utilization;
  const withdrawable = Math.min(deposited, cashUi);
  const lendAmount = Number(lendInput);
  const spAmount = Number(spInput);

  function ping(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  }

  async function onLend() {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    if (!vaultMint) return ping("Pool unavailable");
    const amount = Number(lendInput);
    if (!(amount > 0)) return ping("Enter a deposit amount.");
    if (amount > usdcWallet + 1e-9) return ping("Not enough USDC in wallet");
    setBusy("lend");
    try {
      const { tx } = await buildDepositTx({
        connection,
        lender: key,
        usdcMint: new PublicKey(vaultMint),
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
    if (!vaultMint) return ping("Pool unavailable");
    const amount = floorUsd(Math.min(Number(lendInput), withdrawable));
    if (!(amount > 0)) return ping("Enter an amount.");
    if (Number(lendInput) > withdrawable + 1e-6) return ping("Only your idle pool cash can be withdrawn");
    setBusy("withdraw");
    try {
      await signSend(
        await buildWithdrawTx({
          connection,
          lender: key,
          usdcMint: new PublicKey(vaultMint),
          uiAmount: amount,
        }),
      );
      setLendInput("");
      await fetchVault();
      ping(`Withdrew ${formatUsd(amount)}`);
    } catch (err) {
      fail(err, "Withdraw failed");
    } finally {
      setBusy(null);
    }
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
          collateralUi: collateral,
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
      if (positionAddr && walletId()) {
        setLoanHistory(
          upsertLoanRecord(walletId(), {
            position: positionAddr,
            symbol: listedSymbol,
            status: "repaid",
            collateral: loanCollateral,
            principal: loanPrincipal,
            surplus: 0,
            at: Date.now(),
          }),
        );
      }
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
    if (!vaultMint || !collateralMint) return ping("Pool unavailable");
    setBusy("drop");
    try {
      const used = selected
        ? Math.min(selected.markPrice, selected.tokenPrice)
        : 1032;
      const shock = 1 - dropPct / 100;
      await signSend(
        buildSetTestPriceTx({
          caller: key,
          priceE6: BigInt(Math.round(used * shock * 1e6)),
        }),
      );
      setPriceShock(shock);
      setTestModePrice(used * shock);
      await fetchVault();
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
      await signSend(buildSetTestPriceTx({ caller: key, priceE6: 0n }));
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
    setBusy("drop");
    try {
      await signSend(
        buildWarpAccrualTx({
          caller: key,
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
      if (positionAddr && walletId()) {
        setLoanHistory(
          upsertLoanRecord(walletId(), {
            position: positionAddr,
            symbol: listedSymbol,
            status: "liquidated",
            collateral: loanCollateral,
            principal: loanPrincipal,
            surplus: loanSurplus,
            at: Date.now(),
          }),
        );
      }
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

  async function onClaimSurplus(row: LoanRecord) {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    if (!collateralMint) return ping("Pool unavailable");
    setBusy("claim");
    try {
      await signSend(
        await buildClaimSurplusTx({
          connection,
          borrower: key,
          collateralMint: new PublicKey(collateralMint),
        }),
      );
      setLoanHistory(
        upsertLoanRecord(key.toBase58(), {
          ...row,
          status: "claimed",
          surplus: 0,
          at: Date.now(),
        }),
      );
      setLoanLiquidated(false);
      setLoanSurplus(0);
      await fetchVault();
      ping(`Claimed ${row.surplus.toFixed(4)} ${row.symbol}`);
    } catch (err) {
      fail(err, "Claim failed");
    } finally {
      setBusy(null);
    }
  }

  async function onSpDeposit() {
    const key = activeKey();
    if (!key) return ping("Connect wallet");
    if (!vaultMint || !collateralMint) return ping("Pool unavailable");
    if (!(spAmount > 0)) return ping("Enter an amount.");
    setBusy("sp");
    try {
      await fetch("/api/prelend/crank", { method: "POST" });
      await signSend(
        await buildStabilityDepositTx({
          connection,
          depositor: key,
          usdcMint: new PublicKey(vaultMint),
          collateralMint: new PublicKey(collateralMint),
          uiAmount: spAmount,
        }),
      );
      setSpInput("");
      await fetchVault();
      ping(`Backstop ${formatUsd(spAmount)}`);
    } catch (err) {
      fail(err, "Stability deposit failed");
    } finally {
      setBusy(null);
    }
  }

  async function onSpWithdraw() {
    const key = activeKey();
    if (!key || !vaultMint || !collateralMint) return;
    const amt = spAmount > 0 ? spAmount : mySpUsdc;
    if (!(amt > 0)) return ping("Nothing to withdraw");
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
      ping(`Withdrew ${formatUsd(amt)}`);
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
          <img
            src="/catch-mark.svg"
            alt="Catch"
            className="h-12 w-12 rounded-2xl border border-[rgba(212,175,55,0.18)]"
          />
          <div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Catch</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-400">
              Borrow USDC against PreStocks. Liquidations never hit the book.
            </p>
          </div>
        </div>
        <WalletConnect />
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <Metric
          label="Pool USDC"
          value={formatUsd(poolTotal > 0 ? poolTotal : (vaultOnChain ?? poolUsdc), 0)}
        />
        <Metric label="Idle cash" value={formatUsd(cashUi, 0)} />
        <Metric label="Max borrow LTV" value="30%" />
        <Metric label="Liquidation LTV" value="40%" />
      </section>

      <nav className="mb-6 flex flex-wrap gap-2">
        {(
          [
            ["lend", "Lend"],
            ["borrow", "Borrow"],
            ["stability", "Stability"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full px-4 py-2 text-sm ${
              tab === id ? "bg-amber-400 font-semibold text-black" : "panel text-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "lend" && (
        <section className="panel max-w-3xl rounded-3xl p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xl">Earn on USDC</h2>
            <span className="mono text-xs text-emerald-400">up to {(BORROW_APR * 100).toFixed(0)}%</span>
          </div>
          <p className="mb-4 text-sm text-slate-400">
            Supply USDC. Borrowers pay {(BORROW_APR * 100).toFixed(0)}% APR; you earn a share —
            now {(lenderApr * 100).toFixed(1)}% with {(utilization * 100).toFixed(0)}% of the pool
            borrowed.
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
          <div className="panel rounded-3xl p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xl">Collateral markets</h2>
              <span className="mono text-xs text-slate-500">
                {listedSymbol}
                {activeDrop ? ` −${activeDrop}%` : " live"}
              </span>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Pick a token. Only listed markets can be borrowed against.
            </p>
            <div className="grid gap-2 sm:grid-cols-4">
              {stocks.map((s) => {
                const listed = s.symbol === listedSymbol;
                const openHere = listed && borrowedOpen;
                const active = s.symbol === selected?.symbol;
                return (
                  <button
                    key={s.symbol}
                    type="button"
                    onClick={() => {
                      setSymbol(s.symbol);
                      if (!listed) setPriceShock(1);
                    }}
                    className={`rounded-2xl border px-3 py-2 text-left text-sm ${
                      active
                        ? "border-amber-400 bg-amber-400/10"
                        : "border-white/10 bg-black/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{s.symbol}</span>
                      <span
                        className={`mono text-[10px] ${
                          openHere
                            ? "text-emerald-300"
                            : listed
                              ? "text-amber-300"
                              : "text-slate-500"
                        }`}
                      >
                        {openHere ? "Open" : listed ? "Listed" : "Soon"}
                      </span>
                    </div>
                    <div className="mono text-[11px] text-slate-300">
                      {listed && testModePrice > 0 ? (
                        <span>
                          <span className="text-red-300">{formatUsd(testModePrice)}</span>
                          <span className="ml-1 text-slate-500 line-through">
                            {formatUsd(s.tokenPrice)}
                          </span>
                        </span>
                      ) : (
                        formatUsd(s.tokenPrice)
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {loanHistory.length > 0 ? (
          <div className="panel rounded-3xl p-5">
            <h2 className="mb-3 text-xl">Your loans</h2>
            <div className="space-y-2">
              {loanHistory.map((row) => (
                <div
                  key={row.position}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-black/30 px-3 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold">{row.symbol}</div>
                    <div className="mono text-[11px] text-slate-400">
                      {row.status === "open"
                        ? `Open · ${row.collateral.toFixed(2)} locked · borrowed ${formatUsd(row.principal, 0)}`
                        : row.status === "liquidated"
                          ? `Liquidated · leftover ${row.surplus.toFixed(4)} ${row.symbol}`
                          : row.status === "claimed"
                            ? "Closed · leftover claimed"
                            : "Repaid"}
                    </div>
                  </div>
                  {row.status === "liquidated" ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void onClaimSurplus(row)}
                      className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                    >
                      {busy === "claim"
                        ? "Claiming…"
                        : row.surplus > 0
                          ? `Claim leftover ${row.surplus.toFixed(2)}`
                          : "Close loan"}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {loanLiquidated ? (
              <p className="mt-3 text-xs text-slate-500">
                Claim leftover to close this loan and borrow {listedSymbol} again.
              </p>
            ) : null}
          </div>
          ) : null}

          {isListed && borrowedOpen ? (
          <div className="panel rounded-3xl p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-xl">Your {listedSymbol} loan</h2>
              <span className="mono text-xs text-sky-300">
                {(BORROW_APR * 100).toFixed(0)}% APR · Liq 40%
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
              <span className="mono text-xs text-sky-300">{(BORROW_APR * 100).toFixed(0)}% APR</span>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Lock {selected?.symbol ?? listedSymbol}, borrow USDC up to 30% LTV. You repay debt plus
              interest.
            </p>
            <label className="text-xs text-slate-500">
              Collateral ({selected?.symbol ?? "PreStock"} · wallet {collWallet.toFixed(2)})
              <input
                type="number"
                min={0}
                step={0.1}
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white"
                value={collateral}
                onChange={(e) => setCollateral(Number(e.target.value))}
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
                disabled={overBorrowCap || overDebtCap || busy !== null || !(collateral > 0)}
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
                  Outstanding debt cannot exceed {formatUsd(debtCapUi, 0)} (Stability Pool + DEX
                  depth). Lower LTV or lock less collateral.
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

          <div className="panel rounded-3xl p-5">
            <h2 className="mb-4 text-xl">Market</h2>
            <p className="mb-3 text-sm text-slate-400">
              Borrowers pay {(BORROW_APR * 100).toFixed(0)}% APR. Max LTV 30%. Liquidation at 40%.
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
      </section>
      )}

      {tab === "stability" && (
      <section className="panel max-w-3xl rounded-3xl p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl">Stability Pool</h2>
          <span className="mono text-[11px] text-sky-300">10% liquidation bonus</span>
        </div>
        <p className="mb-4 text-sm text-slate-400">
          Deposit USDC to absorb future liquidations. After a liquidation your USDC shrinks and
          you can claim the seized PreStocks at a 10% discount. New deposits do not buy tokens
          already sitting in the pool.
        </p>
        <div className="mb-4 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Pool USDC" value={formatUsd(spUsdc, 0)} />
            <Stat label="Unclaimed in pool" value={`${spCollateral.toFixed(2)} ANTH`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Your USDC" value={formatUsd(mySpUsdc)} />
            <Stat label="Claimable" value={`${mySpClaimable.toFixed(4)} ANTH`} />
          </div>
        </div>
        {spNeedsMigrate ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">
            <p className="text-sm text-amber-100">
              Upgrade this wallet from the old share ledger. Every old depositor must do this
              once.
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
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[10rem] flex-1 text-xs text-slate-500">
              Amount
              <input
                type="number"
                inputMode="decimal"
                placeholder="0"
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-base text-white"
                value={spInput}
                min={0}
                onChange={(e) => setSpInput(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() => setSpInput(mySpUsdc > 0 ? String(mySpUsdc) : "")}
              className="mb-0.5 text-xs text-sky-300"
            >
              Max
            </button>
            <button
              onClick={() => void onSpDeposit()}
              disabled={busy !== null || !(spAmount > 0) || spBlocked}
              className="rounded-xl bg-sky-400 px-5 py-2 font-semibold text-black disabled:opacity-50"
            >
              Deposit
            </button>
            <button
              onClick={() => void onSpWithdraw()}
              disabled={busy !== null || mySpUsdc <= 0}
              className="rounded-xl border border-white/20 px-5 py-2 disabled:opacity-50"
            >
              Withdraw
            </button>
          </div>
          <button
            onClick={() => void onSpClaim()}
            disabled={busy !== null || mySpClaimable <= 0}
            className="w-full rounded-xl border border-sky-400/40 px-5 py-2 font-semibold text-sky-100 disabled:opacity-40"
          >
            Claim {mySpClaimable > 0 ? `${mySpClaimable.toFixed(4)} ANTHROPIC` : "ANTHROPIC"}
          </button>
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
            <div className={`text-lg ${testModePrice > 0 ? "text-red-300" : ""}`}>
              {usedPrice > 0 ? formatUsd(usedPrice) : "—"}
            </div>
            <div className="text-[11px] text-slate-500">
              {testModePrice > 0 && activeDrop
                ? `test −${activeDrop}%`
                : "min(mark, DEX)"}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel rounded-2xl px-4 py-3">
      <div className="mono text-[11px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 text-lg text-amber-200">{value}</div>
    </div>
  );
}

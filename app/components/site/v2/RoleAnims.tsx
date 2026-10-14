"use client";

import { useEffect, useState } from "react";
import { useInView } from "./motion";

export function BorrowerAnim() {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);

  return (
    <div ref={ref} className={`lx-stage lx-borrow ${inView ? "is-play" : ""}`} aria-hidden="true">
      <div className="lx-borrow-row">
        <div className="lx-chip">
          <small>Your token</small>
          <b>ANTHROPIC</b>
          <span className="lx-up">$10,000 ↗</span>
        </div>
        <div className="lx-vault">
          <span>Catch</span>
        </div>
        <div className="lx-chip is-usdc">
          <small>In your wallet</small>
          <b>USDC</b>
          <span>+$3,000</span>
        </div>
        <i className="lx-coin is-token" />
        <i className="lx-coin is-usdc" />
      </div>
      <div className="lx-meter">
        <div className="lx-meter-head">
          <span>Loan to value</span>
          <b>30%</b>
        </div>
        <div className="lx-meter-bar">
          <em />
          <i className="lx-meter-limit" style={{ left: "40%" }} />
        </div>
        <p>The token stays yours, upside included. Repay and take it back.</p>
      </div>
    </div>
  );
}

export function LenderAnim() {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const [earned, setEarned] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setEarned(810);
      return;
    }
    const id = window.setInterval(() => {
      setEarned((v) => (v >= 810 ? 0 : v + 9));
    }, 60);
    return () => window.clearInterval(id);
  }, [inView]);

  return (
    <div ref={ref} className={`lx-stage lx-lend ${inView ? "is-play" : ""}`} aria-hidden="true">
      <div className="lx-lend-top">
        <div>
          <small>Deposited</small>
          <b>$10,000 USDC</b>
        </div>
        <div className="lx-earned">
          <small>Earned, in USDC</small>
          <b>+${earned.toLocaleString("en-US")}</b>
        </div>
      </div>
      <div className="lx-layers">
        <div className="lx-layer is-1">
          <b>Bidders’ USDC</b>
          <span>buys the collateral first, and takes the first loss</span>
        </div>
        <div className="lx-layer is-2">
          <b>Market reserve</b>
          <span>funded from interest, covers a gap</span>
        </div>
        <div className="lx-layer is-3">
          <b>Your deposit</b>
          <span>repaid in USDC</span>
        </div>
      </div>
    </div>
  );
}

const PRICE = "M0 36 C 50 26, 90 52, 140 42 S 215 46, 238 80 S 252 104, 262 104 S 300 122, 330 114 S 375 96, 400 94";

export function BidderAnim() {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);

  return (
    <div ref={ref} className={`lx-stage lx-bidder ${inView ? "is-play" : ""}`} aria-hidden="true">
      <div className="lx-bid-head">
        <div>
          <small>Your bid</small>
          <b>$5,000 · 10% below market</b>
        </div>
        <div className="lx-earned">
          <small>While it backs a loan</small>
          <b>earns yield</b>
        </div>
      </div>
      <svg viewBox="0 0 400 150" className="lx-chart">
        <line x1="0" y1="34" x2="400" y2="34" className="lx-chart-mark" />
        <text x="400" y="24" textAnchor="end">Market price</text>
        <line x1="0" y1="104" x2="400" y2="104" className="lx-chart-bid" />
        <text x="0" y="122">Your price · 10% below</text>
        <path d={PRICE} className="lx-chart-price" pathLength={1} />
        <circle cx="262" cy="104" r="7" className="lx-chart-hit" />
      </svg>
      <div className="lx-filled">Filled: you own the token at your price</div>
    </div>
  );
}

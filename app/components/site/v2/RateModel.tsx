"use client";

import { useState } from "react";
import { useInView } from "./motion";

const BASE = 10;
const KINK = 0.8;
const KINK_RATE = 15;
const MAX = 30;
const RESERVE = 0.1;
const FLOOR = 5;
const SENIOR = 100_000;

const BOOKS = [
  { id: "thin", label: "Few bids", book: 100_000 },
  { id: "mid", label: "Balanced", book: 300_000 },
  { id: "deep", label: "Many bids", book: 900_000 },
] as const;

function borrowRate(u: number) {
  if (u <= KINK) return BASE + (u / KINK) * (KINK_RATE - BASE);
  return KINK_RATE + ((u - KINK) / (1 - KINK)) * (MAX - KINK_RATE);
}

function x(u: number) {
  return 20 + u * 360;
}

function y(rate: number) {
  return 170 - (rate / MAX) * 150;
}

const CURVE = `M${x(0)} ${y(BASE)} L${x(KINK)} ${y(KINK_RATE)} L${x(1)} ${y(MAX)}`;

export function RateModel() {
  const [util, setUtil] = useState(80);
  const [book, setBook] = useState<(typeof BOOKS)[number]["id"]>("mid");
  const [ref, inView] = useInView<HTMLDivElement>(0.25);

  const u = util / 100;
  const rate = borrowRate(u);
  const net = rate * (1 - RESERVE);
  const J = BOOKS.find((b) => b.id === book)!.book;
  const seniorShare = J / (SENIOR + J);
  const senior = Math.max(net * seniorShare, Math.min(FLOOR, net));
  const junior = net - senior;
  const parts = [
    { name: "Lenders", value: senior, cls: "is-lend" },
    { name: "Bidders", value: junior, cls: "is-bid" },
    { name: "Reserve", value: rate - net, cls: "is-res" },
  ];

  return (
    <div ref={ref} className={`lx-rate ${inView ? "is-play" : ""}`}>
      <div className="lx-stage">
        <div className="lx-stage-label">
          <span>01 · The borrow rate</span>
          <b>{rate.toFixed(1)}%</b>
        </div>
        <svg viewBox="0 0 400 190" className="lx-curve" aria-hidden="true">
          <line x1="20" y1="170" x2="380" y2="170" className="lx-axis" />
          <line x1={x(KINK)} y1="20" x2={x(KINK)} y2="170" className="lx-kink" />
          <text x={x(KINK) - 30} y="16">kink 80%</text>
          <path d={CURVE} className="lx-curve-line" pathLength={1} />
          <circle cx={x(u)} cy={y(rate)} r="7" className="lx-curve-dot" />
          <text x="20" y="186">vault idle</text>
          <text x="318" y="186">fully lent</text>
        </svg>
        <label className="lx-slider">
          <span>Share of the lending vault that is borrowed: {util}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={util}
            onChange={(e) => setUtil(Number(e.target.value))}
          />
        </label>
        <p className="lx-note">
          10% when the vault is idle, 15% at 80% borrowed, 30% when it is full. A high rate pulls in
          new deposits and pushes repayment, so the vault refills.
        </p>
      </div>

      <div className="lx-stage">
        <div className="lx-stage-label">
          <span>02 · Where that interest goes</span>
          <b>of {rate.toFixed(1)}%</b>
        </div>
        <div className="lx-seg" role="radiogroup" aria-label="Bid book depth">
          {BOOKS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={book === b.id}
              className={book === b.id ? "is-on" : ""}
              onClick={() => setBook(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="lx-split" aria-hidden="true">
          {parts.map((p) => (
            <i key={p.name} className={p.cls} style={{ flexGrow: Math.max(p.value, 0.01) }} />
          ))}
        </div>
        <ul className="lx-legend">
          {parts.map((p) => (
            <li key={p.name}>
              <i className={p.cls} />
              <span>{p.name}</span>
              <b>{p.value.toFixed(1)}%</b>
            </li>
          ))}
        </ul>
        <p className="lx-note">
          Fewer bids, a bigger share for bidders. More bids, more for lenders. The side the market is
          short of earns more, so it fills back up. Lenders always keep at least 5%. Only bids that
          are backing a loan are paid.
        </p>
      </div>
    </div>
  );
}

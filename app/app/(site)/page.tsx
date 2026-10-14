import type { Metadata } from "next";
import Link from "next/link";
import { SiteChrome } from "@/components/site/SiteChrome";
import { HeroLoan } from "@/components/site/v2/HeroLoan";
import { CountUp, Reveal } from "@/components/site/v2/motion";
import { RateModel } from "@/components/site/v2/RateModel";
import { BidderAnim, BorrowerAnim, LenderAnim } from "@/components/site/v2/RoleAnims";
import "@/components/site/v2/landing.css";

export const metadata: Metadata = {
  title: "Catch — Credit against low-liquidity tokens",
  description:
    "Catch unlocks credit against low-liquidity tokens on Solana, secured by committed exit liquidity: USDC that bidders lock to buy the collateral at their own price.",
};

const steps = [
  {
    t: "Bidders commit",
    d: "They lock USDC to buy the token at their own discount. “I’ll buy at 10% below market.”",
  },
  {
    t: "Holders borrow",
    d: "USDC against the token, without selling it. Each loan is sized to the bids behind it.",
  },
  {
    t: "A bad loan is caught",
    d: "Bidders buy just enough collateral at their price. Lenders are repaid in USDC. Nothing is dumped on a DEX.",
  },
];

const roles = [
  {
    id: "borrower",
    tag: "Borrower",
    title: "Cash without selling your token.",
    perks: [
      "Borrow USDC against a pre-IPO token today.",
      "Keep the upside. Repay and the token is back in your wallet.",
      "If the price falls, only part is sold, to bidders. Never into a thin DEX pool.",
    ],
    cta: { href: "/app?pool=anthropic&tab=borrow", label: "Borrow" },
    Anim: BorrowerAnim,
  },
  {
    id: "lender",
    tag: "Lender",
    title: "Yield, repaid in USDC.",
    perks: [
      "Earn interest on USDC lent to holders of scarce tokens.",
      "Paid back in USDC. You never end up holding the token.",
      "Bidders’ cash stands in front of you, then the market reserve.",
    ],
    cta: { href: "/app?pool=anthropic&tab=lend", label: "Lend" },
    Anim: LenderAnim,
  },
  {
    id: "bidder",
    tag: "Bidder",
    title: "Buy the token at your price, and get paid while you wait.",
    perks: [
      "Missed the allocation? Name the discount you would buy at.",
      "Earn yield while your bid is backing a loan.",
      "Your cash is never lent out. Unused bids withdraw any time.",
    ],
    cta: { href: "/app?pool=anthropic&tab=stability", label: "Place a bid" },
    Anim: BidderAnim,
  },
];

export default function LandingPage() {
  return (
    <SiteChrome active="home">
      <main className="lx">
        <section className="lx-hero">
          <Reveal>
            <p className="lx-kicker">Pre-IPO and long-tail tokens · Solana</p>
            <h1>
              Catch unlocks credit against low{"\u2011"}liquidity tokens,
              <em> secured by committed exit liquidity.</em>
            </h1>
            <p className="lx-lead">
              Bidders lock USDC to buy the token at a price they choose. That is what makes a loan
              safe to give: holders borrow without selling, and lenders are repaid in USDC.
            </p>
            <div className="lx-cta">
              <Link href="/app?pool=anthropic" className="lx-btn">
                Open the app
              </Link>
              <a href="#roles" className="lx-textlink">
                What each side gets ↓
              </a>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <HeroLoan />
          </Reveal>
        </section>

        <section id="problem" className="lx-block">
          <Reveal>
            <p className="lx-kicker">The problem</p>
            <h2>
              Valuable tokens. <em>Almost no exit.</em>
            </h2>
            <p className="lx-prose">
              Need cash but hold Anthropic stock? Today you have to sell. Solana’s big lending markets
              take only public stocks, because one liquidation into a thin pool would crash the price
              and leave bad debt.
            </p>
          </Reveal>
          <ul className="lx-stats">
            <Reveal as="li">
              <b>
                <CountUp to={1500} suffix="+" />
              </b>
              <span>private unicorns, about $6 trillion, stay illiquid until an IPO</span>
            </Reveal>
            <Reveal as="li" delay={120}>
              <b>
                <CountUp to={78} prefix="~" suffix="%" />
              </b>
              <span>of pre-IPO token volume already trades on Solana</span>
            </Reveal>
            <Reveal as="li" delay={240}>
              <b>
                <CountUp to={3} prefix="~" suffix="%" />
              </b>
              <span>of an $8M Anthropic token can be sold on a DEX ($236k of liquidity)</span>
            </Reveal>
          </ul>
        </section>

        <section id="how" className="lx-block">
          <Reveal>
            <p className="lx-kicker">How it works</p>
            <h2>
              The buyer is lined up <em>before the loan.</em>
            </h2>
          </Reveal>
          <ol className="lx-steps3">
            {steps.map((s, i) => (
              <Reveal as="li" key={s.t} delay={i * 140}>
                <i>0{i + 1}</i>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </Reveal>
            ))}
          </ol>
        </section>

        <section id="roles" className="lx-block">
          <Reveal>
            <p className="lx-kicker">Three sides, one market</p>
            <h2>
              Every side <em>gets something.</em>
            </h2>
          </Reveal>
          <div className="lx-rolelist">
            {roles.map(({ id, tag, title, perks, cta, Anim }, i) => (
              <article key={id} className={`lx-roleblock ${i % 2 ? "is-flip" : ""}`}>
                <Reveal>
                  <p className="lx-tag">
                    0{i + 1} · {tag}
                  </p>
                  <h3>{title}</h3>
                  <ul className="lx-perks">
                    {perks.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <Link href={cta.href} className="lx-textlink">
                    {cta.label} →
                  </Link>
                </Reveal>
                <Reveal delay={150}>
                  <Anim />
                </Reveal>
              </article>
            ))}
          </div>
        </section>

        <section id="rates" className="lx-block">
          <Reveal>
            <p className="lx-kicker">Interest rate model and yield distribution</p>
            <h2>
              A market that <em>balances itself.</em>
            </h2>
            <p className="lx-prose">
              Each market sets its own rate from how much of the lending vault is borrowed. Interest
              is then split between lenders, bidders and a bad-debt reserve, leaning toward whichever
              side the market needs more of.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <RateModel />
          </Reveal>
        </section>

        <section className="lx-block">
          <Reveal>
            <div className="lx-close">
              <p className="lx-kicker">Live on devnet</p>
              <h2>The Anthropic market is open.</h2>
              <p className="lx-prose">
                Borrow against the token, lend USDC, or place a bid at your discount. Not offered to
                US persons.
              </p>
              <div className="lx-cta">
                <Link href="/app?pool=anthropic" className="lx-btn">
                  Open the app
                </Link>
                <Link href="/docs" className="lx-textlink">
                  Read the docs
                </Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
    </SiteChrome>
  );
}

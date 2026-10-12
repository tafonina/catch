# Catch

Credit against long-tail and private-market tokens, capped by committed exit liquidity.

Catch is over-collateralized lending for [PreStocks](https://prestocks.com) on Solana. Built for [Stocklana](https://stocklana.com) / Colosseum. Live on **devnet**.

If you hold ANTHROPIC and need dollars, you should not have to sell it. If nobody has locked a bid, you cannot borrow.

## How it works

Three roles, one isolated market.

| | What you do | What you get |
|---|---|---|
| **Borrower** | Lock ANTHROPIC, take USDC (max 30% LTV) | Dollars without selling. Kinked APR (10–30%). Liquidation trims back to 30% |
| **Senior lender** | Supply USDC that is lent out | Scarcity-weighted share of interest, 5% floor. Never receives the token |
| **Bidder** | Escrow USDC in a yNFT at your discount | Lock yield on the engaged part + collateral at that discount on liquidation |

The bid book **is** the debt ceiling. Liquidations fill the book by price–time (tightest discount first) and never sell into a DEX.

The protocol takes **0.5%** once, when the loan opens. 10% of interest goes to the market reserve; the rest splits between senior and engaged bids.

Loan health is a cNFT: **Chad VC** → **Anxious Trader** → **McPepe** → **Rekt**.

A demo drop (−10/−20/−30/−40%) writes a test price on-chain so you can watch LTV and the loan NFT move.

## Parameters

| | |
|---|---|
| Max borrow LTV | 30% |
| Liquidation LTV | 40% (trim to 30%) |
| Borrow APR | 10% → 15% at 80% senior util → 30% full |
| Reserve factor | 10% of interest |
| Senior floor | 5% of net interest |
| Protocol fee | 0.5% on borrow |
| Ceiling | USDC locked in the bid book |
| Program | `5gcsfFaJWpRxnCAsms297U8XxqjnrrM5sWZ7552biuGY` |

## Run

```bash
cd app
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. Phantom on **devnet**.

After this layout change, bootstrap the market again (`initialize_pool` + `init_stability_pool`). Old account data will not decode.

## Repo

```
programs/prelend   Anchor program (senior vault, yNFT bid book, partial liquidation)
app                Next.js dashboard + loan NFTs
scripts            oracle helpers
```

Deploy / bootstrap: [`DEPLOY.md`](DEPLOY.md). Layout: [`ARCHITECTURE.md`](ARCHITECTURE.md). Next: [`IMPROVEMENTS.md`](IMPROVEMENTS.md). Spec: `Catch — Protocol Spec (Colosseum).md`.

## Honest limits

- An empty bid book produces no credit, not bad debt — that is the point.
- A gap deeper than the bids can still leave a shortfall for the reserve.
- Oracle is posted (keeper). Test-mode price and +1 month are demo switches.
- Unaudited. Redeploy required after the v1.2 account layout.

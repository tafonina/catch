# Catch

Lock PreStocks, borrow USDC, keep the upside. A Stability Pool is funded first so it can take the liquidation.

Catch is over-collateralized lending for [PreStocks](https://prestocks.com) on Solana. Built for [Stocklana](https://stocklana.com). Live on **devnet**.

If you hold ANTHROPIC and need dollars, you should not have to sell it.

## How it works

Three roles, one market.

| | What you do | What you get |
|---|---|---|
| **Borrower** | Lock ANTHROPIC, take USDC (max 30% LTV) | Dollars without selling. 12% APR. Liquidation at 40% |
| **Lender** | Supply USDC to the vault | Share of the 12% borrowers pay |
| **Stability Pool** | Park USDC before anyone is liquidated | Seized tokens at a 10% discount |

When a loan crosses 40% LTV the pool repays the debt and takes the collateral.

The protocol takes **0.5%** once, when the loan opens. Interest goes to lenders.

Collateral is valued at `min(PreStocks mark, DEX TWAP)`. A demo drop (−10/−20/−30/−40%) writes a test price on-chain so you can watch LTV and the loan NFT move.

Loan health is a cNFT: **Chad VC** → **Anxious Trader** → **McPepe** → **Rekt**.

## Parameters

| | |
|---|---|
| Max borrow LTV | 30% |
| Liquidation LTV | 40% |
| Borrower APR | 12% (to lenders) |
| Protocol fee | 0.5% on borrow |
| SP bonus | 10% |
| Debt cap | Stability Pool USDC + DEX depth at 5% impact |
| Program | `HujDemHxNw2y7qJSDrgE1eYhVS8SGTvQL55oweQfNQfd` |

## Run

```bash
cd app
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. Phantom on **devnet**.

## Repo

```
programs/prelend   Anchor program (vaults, LTV, Stability Pool, liquidation)
app                Next.js dashboard
scripts            oracle helpers
```

Deploy / bootstrap: [`DEPLOY.md`](DEPLOY.md). Layout: [`ARCHITECTURE.md`](ARCHITECTURE.md). What we would ship next: [`IMPROVEMENTS.md`](IMPROVEMENTS.md).

## Honest limits

- An empty Stability Pool can still produce bad debt.
- Oracle and DEX depth are posted (keeper). Pyth pre-IPO indices exist but are gated.
- Test-mode price and +1 month are demo switches. Not for mainnet.
- Unaudited.

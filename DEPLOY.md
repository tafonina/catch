# Deploy PreLend

Do **not** send these transactions against mainnet unless you explicitly decide to. Default is **devnet**.

## 1. Cluster

```bash
solana config set --url https://api.devnet.solana.com
```

In `app/.env.local`:

```
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PRELEND_PROGRAM_ID=HujDemHxNw2y7qJSDrgE1eYhVS8SGTvQL55oweQfNQfd
```

Point Phantom at **Devnet**. Restart `npm run dev`.

Surfpool (`NO_DNA=1 surfpool start` + RPC `http://127.0.0.1:8899`) clones mainnet PreStocks mints locally if you need a fork demo.

## 2. Deploy

From `prelend`, with `NO_DNA=1` if your environment injects an extra `rustc`:

```bash
cd prelend
NO_DNA=1 anchor build
NO_DNA=1 anchor deploy
```

Program id is `HujDemHxNw2y7qJSDrgE1eYhVS8SGTvQL55oweQfNQfd`. `[provider] cluster` in `Anchor.toml` is `devnet`.

Then seed the vault (mock USDC + `initialize_pool` + deposit):

```bash
cd app
npx tsx scripts/bootstrap-prelend.ts
```

Reload the dashboard. **Pool USDC** should switch to the live `usdc-vault` balance.

After the program rework, bootstrap also needs: `init_stability_pool`, `update_oracle` (mark + TWAP), `update_depth` ($171,258 for ANTHROPIC).

## 3. Demo cycle (target)

| Step | What is real |
|---|---|
| Borrow slider capped at 30% (restricted) and remaining debt cap | UI + on-chain params |
| Oracle panel: markPrice, DEX TWAP, which min() is used, staleness, debt-cap breakdown | UI + posted oracle |
| Simulate market drop | on-chain `set_test_price` (test-mode, any wallet) |
| Liquidate | real `liquidate` — Stability Pool absorbs, surplus claimable |
| Stability Pool deposit / cooldown / in-kind withdraw | on-chain |

Nothing is sent until you approve a wallet popup.

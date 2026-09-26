pub mod constants;
pub mod error;
pub mod instructions;
pub mod math;
pub mod state;
pub mod token_utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("HujDemHxNw2y7qJSDrgE1eYhVS8SGTvQL55oweQfNQfd");

#[program]
pub mod prelend {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        protocol_fee_bps: u16,
        risk_params: RiskParams,
    ) -> Result<()> {
        instructions::lending::handle_initialize_pool(ctx, protocol_fee_bps, risk_params)
    }

    pub fn update_oracle(
        ctx: Context<UpdateOracle>,
        mark_price_e6: Option<u64>,
        twap_price_e6: Option<u64>,
    ) -> Result<()> {
        instructions::oracle::handle_update_oracle(ctx, mark_price_e6, twap_price_e6)
    }

    pub fn deposit_liquidity(ctx: Context<DepositLiquidity>, amount: u64) -> Result<()> {
        instructions::lending::handle_deposit_liquidity(ctx, amount)
    }

    pub fn withdraw_liquidity(ctx: Context<WithdrawLiquidity>, amount: u64) -> Result<()> {
        instructions::lending::handle_withdraw_liquidity(ctx, amount)
    }

    pub fn borrow_usdc(
        ctx: Context<BorrowUsdc>,
        collateral_amount: u64,
        borrow_amount: u64,
    ) -> Result<()> {
        instructions::lending::handle_borrow_usdc(ctx, collateral_amount, borrow_amount)
    }

    pub fn repay_and_withdraw(ctx: Context<RepayAndWithdraw>) -> Result<()> {
        instructions::lending::handle_repay_and_withdraw(ctx)
    }

    pub fn init_stability_pool(ctx: Context<InitStabilityPool>) -> Result<()> {
        instructions::stability::handle_init_stability_pool(ctx)
    }

    pub fn deposit_stability(ctx: Context<DepositStability>, amount: u64) -> Result<()> {
        instructions::stability::handle_deposit_stability(ctx, amount)
    }

    pub fn withdraw_stability(ctx: Context<WithdrawStability>, amount: u64) -> Result<()> {
        instructions::stability::handle_withdraw_stability(ctx, amount)
    }

    pub fn claim_stability(ctx: Context<ClaimStability>) -> Result<()> {
        instructions::stability::handle_claim_stability(ctx)
    }

    pub fn migrate_stability_pool(ctx: Context<MigrateStabilityPool>) -> Result<()> {
        instructions::stability::handle_migrate_stability_pool(ctx)
    }

    pub fn migrate_stability_deposit(ctx: Context<MigrateStabilityDeposit>) -> Result<()> {
        instructions::stability::handle_migrate_stability_deposit(ctx)
    }

    pub fn reset_stability(ctx: Context<ResetStability>) -> Result<()> {
        instructions::stability::handle_reset_stability(ctx)
    }

    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        instructions::liquidation::handle_liquidate(ctx)
    }

    pub fn external_liquidate(ctx: Context<ExternalLiquidate>) -> Result<()> {
        instructions::liquidation::handle_external_liquidate(ctx)
    }

    pub fn claim_surplus_collateral(ctx: Context<ClaimSurplusCollateral>) -> Result<()> {
        instructions::liquidation::handle_claim_surplus_collateral(ctx)
    }

    pub fn update_depth(ctx: Context<UpdateDepth>, posted_depth: u64) -> Result<()> {
        instructions::admin::handle_update_depth(ctx, posted_depth)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::admin::handle_set_paused(ctx, paused)
    }

    pub fn reset_pool<'a>(ctx: Context<'a, ResetPool<'a>>) -> Result<()> {
        instructions::admin::handle_reset_pool(ctx)
    }

    #[cfg(feature = "test-mode")]
    pub fn set_test_price(ctx: Context<SetTestPrice>, price_e6: u64) -> Result<()> {
        instructions::oracle::handle_set_test_price(ctx, price_e6)
    }

    #[cfg(feature = "test-mode")]
    pub fn warp_accrual(ctx: Context<SetTestPrice>, extra_secs: i64) -> Result<()> {
        instructions::oracle::handle_warp_accrual(ctx, extra_secs)
    }
}

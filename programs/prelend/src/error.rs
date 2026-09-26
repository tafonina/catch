use anchor_lang::prelude::*;

#[error_code]
pub enum PreLendError {
    #[msg("Only the protocol admin can perform this action")]
    Unauthorized,
    #[msg("Requested borrow exceeds the max-borrow LTV cap")]
    LtvExceeded,
    #[msg("Position is not in the expected status")]
    InvalidPositionStatus,
    #[msg("Oracle price is stale or missing")]
    StaleOracle,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Insufficient USDC liquidity in the lending pool")]
    InsufficientLiquidity,
    #[msg("Insufficient lender deposits to withdraw")]
    InsufficientDeposits,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("USDC mint does not match the pool configuration")]
    InvalidUsdcMint,
    #[msg("Borrowing is paused")]
    PoolPaused,
    #[msg("New borrow would exceed the debt cap")]
    DebtCapExceeded,
    #[msg("Stability pool does not have enough USDC to cover the debt")]
    StabilityPoolInsufficient,
    #[msg("No withdrawal has been requested")]
    NoWithdrawalRequested,
    #[msg("Withdrawal cooldown has not elapsed")]
    CooldownNotElapsed,
    #[msg("Stability pool still has unmigrated share deposits")]
    StabilityPoolNeedsMigrate,
    #[msg("Stability deposit is already migrated")]
    AlreadyMigrated,
    #[msg("Position LTV is below the liquidation threshold")]
    PositionStillHealthy,
    #[msg("No surplus collateral to claim")]
    NoSurplusCollateral,
}

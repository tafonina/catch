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
    #[msg("New borrow would exceed the bid-book ceiling")]
    DebtCapExceeded,
    #[msg("Bid book does not have enough unlocked USDC")]
    StabilityPoolInsufficient,
    #[msg("Position LTV is below the liquidation threshold")]
    PositionStillHealthy,
    #[msg("No surplus collateral to claim")]
    NoSurplusCollateral,
    #[msg("Mark-vs-DEX spread is wider than the book's tightest bid")]
    SpreadPause,
    #[msg("This bid is engaged against open debt")]
    BidEngaged,
    #[msg("Bid book is full")]
    BidBookFull,
    #[msg("Discount does not match the existing bid")]
    BidDiscountMismatch,
    #[msg("Mint is not admitted (fee, permanent delegate, or missing book)")]
    MintNotAdmitted,
    #[msg("Bid accounts must be passed in price-time order")]
    BidOrderInvalid,
}

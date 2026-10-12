use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"global-config";

#[constant]
pub const USDC_VAULT_SEED: &[u8] = b"usdc-vault";

#[constant]
pub const COLLATERAL_VAULT_SEED: &[u8] = b"collateral-vault";

#[constant]
pub const POSITION_SEED: &[u8] = b"position";

#[constant]
pub const LENDER_SEED: &[u8] = b"lender";

#[constant]
pub const ORACLE_SEED: &[u8] = b"oracle";

#[constant]
pub const STABILITY_POOL_SEED: &[u8] = b"stability-pool";

#[constant]
pub const STABILITY_DEPOSIT_SEED: &[u8] = b"stability-deposit";

#[constant]
pub const SP_USDC_VAULT_SEED: &[u8] = b"sp-usdc-vault";

#[constant]
pub const BPS_DENOMINATOR: u64 = 10_000;

#[constant]
pub const SECONDS_PER_YEAR: u64 = 31_536_000;

/// 1e18 fixed-point base for the borrow index.
pub const E18: u128 = 1_000_000_000_000_000_000;

/// Bid-book account layout (v1.2 yNFT book).
pub const BID_BOOK_VERSION: u8 = 2;

/// Hard cap on live bids per market (price–time queue on the book account).
pub const MAX_BIDS: usize = 8;

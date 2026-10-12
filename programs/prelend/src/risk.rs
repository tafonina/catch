use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct RiskParams {
    pub max_borrow_ltv_bps: u16,
    pub liquidation_ltv_bps: u16,
    pub target_ltv_bps: u16,
    pub base_rate_bps: u16,
    pub kink_util_bps: u16,
    pub kink_rate_bps: u16,
    pub max_rate_bps: u16,
    pub reserve_factor_bps: u16,
    pub senior_floor_bps: u16,
    pub interest_headroom_secs: i64,
    pub price_staleness_secs: i64,
    pub keeper_fee_usdc: u64,
    pub dust_usdc: u64,
    pub market_class: u8,
}

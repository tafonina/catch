use crate::constants::*;
use crate::error::PreLendError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

// ─── UpdateOracle (admin only) ──────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpdateOracle<'info> {
    pub admin: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
        has_one = admin @ PreLendError::Unauthorized,
        constraint = config.collateral_mint == mint.key() @ PreLendError::MintNotAdmitted,
    )]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + OraclePrice::INIT_SPACE,
        seeds = [ORACLE_SEED, mint.key().as_ref()],
        bump,
    )]
    pub oracle: Account<'info, OraclePrice>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_update_oracle(
    ctx: Context<UpdateOracle>,
    mark_price_e6: Option<u64>,
    twap_price_e6: Option<u64>,
) -> Result<()> {
    require!(
        mark_price_e6.is_some() || twap_price_e6.is_some(),
        PreLendError::ZeroAmount
    );
    let now = Clock::get()?.unix_timestamp;
    let oracle = &mut ctx.accounts.oracle;
    oracle.mint = ctx.accounts.mint.key();
    oracle.bump = ctx.bumps.oracle;

    if let Some(mark) = mark_price_e6 {
        require!(mark > 0, PreLendError::ZeroAmount);
        oracle.mark_price_e6 = mark;
        oracle.mark_updated_at = now;
    }
    if let Some(twap) = twap_price_e6 {
        require!(twap > 0, PreLendError::ZeroAmount);
        oracle.twap_price_e6 = twap;
        oracle.twap_updated_at = now;
    }

    emit!(OracleUpdated {
        mint: oracle.mint,
        mark_price_e6: oracle.mark_price_e6,
        twap_price_e6: oracle.twap_price_e6,
    });
    Ok(())
}

#[event]
pub struct OracleUpdated {
    pub mint: Pubkey,
    pub mark_price_e6: u64,
    pub twap_price_e6: u64,
}

// ─── SetTestPrice (test-mode feature gate) ──────────────────────────────────

#[cfg(feature = "test-mode")]
#[derive(Accounts)]
pub struct SetTestPrice<'info> {
    pub caller: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.collateral_mint == mint.key() @ PreLendError::MintNotAdmitted,
    )]
    pub config: Account<'info, GlobalConfig>,
}

#[cfg(feature = "test-mode")]
pub fn handle_set_test_price(ctx: Context<SetTestPrice>, price_e6: u64) -> Result<()> {
    ctx.accounts.config.test_mode_price_e6 = price_e6;
    Ok(())
}

#[cfg(feature = "test-mode")]
pub fn handle_warp_accrual(ctx: Context<SetTestPrice>, extra_secs: i64) -> Result<()> {
    require!(extra_secs > 0, PreLendError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts
        .config
        .accrue_interest(now.saturating_add(extra_secs))?;
    ctx.accounts.config.last_accrual_ts = now;
    Ok(())
}

use crate::constants::*;
use crate::error::PreLendError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

// ─── Liquidate (permissionless) ─────────────────────────────────────────────

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    /// CHECK: original borrower, used as PDA seed only.
    pub borrower: UncheckedAccount<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [ORACLE_SEED, collateral_mint.key().as_ref()],
        bump = oracle.bump,
        constraint = oracle.mint == collateral_mint.key(),
    )]
    pub oracle: Box<Account<'info, OraclePrice>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, borrower.key().as_ref(), collateral_mint.key().as_ref()],
        bump = position.bump,
        constraint = position.borrower == borrower.key() @ PreLendError::Unauthorized,
        has_one = collateral_mint,
    )]
    pub position: Box<Account<'info, UserPosition>>,
    #[account(
        mut,
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump = stability_pool.bump,
        constraint = stability_pool.collateral_mint == collateral_mint.key(),
    )]
    pub stability_pool: Box<Account<'info, StabilityPool>>,
    #[account(
        mut,
        seeds = [SP_USDC_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = stability_pool,
    )]
    pub sp_usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [USDC_VAULT_SEED],
        bump = config.usdc_vault_bump,
        token::mint = usdc_mint,
        token::authority = config,
    )]
    pub usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_liquidate(ctx: Context<Liquidate>) -> Result<()> {
    require!(
        ctx.accounts.position.status == PositionStatus::Active,
        PreLendError::InvalidPositionStatus
    );

    // 1. Accrue interest
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.config.accrue_interest(now)?;

    // 2. Read oracle, compute LTV
    let price = crate::math::oracle_price_valid(
        ctx.accounts.oracle.mark_price_e6,
        ctx.accounts.oracle.twap_price_e6,
        ctx.accounts.oracle.mark_updated_at,
        ctx.accounts.oracle.twap_updated_at,
        now,
        ctx.accounts.config.risk_params.price_staleness_secs,
        ctx.accounts.config.test_mode_price_e6,
    )?;

    let debt = crate::math::actual_debt(
        ctx.accounts.position.scaled_debt,
        ctx.accounts.config.borrow_index_e18,
    )?;

    let collateral_value = crate::math::collateral_value_usdc(
        ctx.accounts.position.collateral_amount,
        ctx.accounts.collateral_mint.decimals,
        price,
    )?;
    let ltv = crate::math::ltv_bps(debt, collateral_value)?;
    require!(
        ltv >= ctx.accounts.config.risk_params.liquidation_ltv_bps as u64,
        PreLendError::PositionStillHealthy
    );

    // 3. Compute seize, capped at position's collateral
    let seize = std::cmp::min(
        crate::math::seize_amount(
            debt,
            ctx.accounts.config.risk_params.liquidation_bonus_bps,
            price,
            ctx.accounts.collateral_mint.decimals,
        )?,
        ctx.accounts.position.collateral_amount,
    );

    // 4. Surplus
    let surplus = ctx
        .accounts
        .position
        .collateral_amount
        .saturating_sub(seize);

    // 5. SP must cover the debt (snapshot bucket only — migrate leftover shares first)
    require!(
        ctx.accounts.stability_pool.version == SP_ACCOUNT_VERSION,
        PreLendError::StabilityPoolNeedsMigrate
    );
    require!(
        ctx.accounts.stability_pool.legacy_shares == 0,
        PreLendError::StabilityPoolNeedsMigrate
    );
    require!(
        ctx.accounts.stability_pool.total_usdc >= debt,
        PreLendError::StabilityPoolInsufficient
    );

    // Transfer debt USDC from SP vault → lender USDC vault
    let mint_key = ctx.accounts.collateral_mint.key();
    let pool_seeds: &[&[u8]] = &[
        STABILITY_POOL_SEED,
        mint_key.as_ref(),
        &[ctx.accounts.stability_pool.bump],
    ];
    crate::token_utils::transfer_checked_signed(
        ctx.accounts.token_program.key(),
        ctx.accounts.sp_usdc_vault.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.usdc_vault.to_account_info(),
        ctx.accounts.stability_pool.to_account_info(),
        debt,
        ctx.accounts.usdc_mint.decimals,
        &[pool_seeds],
    )?;

    // 6. Bookkeeping — product–sum so only incumbents earn this seize
    let pool = &mut ctx.accounts.stability_pool;
    let (remaining, p, s, epoch, prev_s, prev_epoch) = crate::math::sp_apply_offset(
        pool.total_usdc,
        pool.p_e18,
        pool.s_e18,
        pool.epoch,
        debt,
        seize,
    )?;
    pool.total_usdc = remaining;
    pool.p_e18 = p;
    pool.s_e18 = s;
    pool.epoch = epoch;
    if remaining == 0 {
        pool.prev_s_e18 = prev_s;
        pool.prev_epoch = prev_epoch;
    }
    pool.collateral_held = pool
        .collateral_held
        .checked_add(seize)
        .ok_or(PreLendError::MathOverflow)?;

    ctx.accounts.config.total_borrowed = ctx
        .accounts
        .config
        .total_borrowed
        .saturating_sub(ctx.accounts.position.usdc_amount);

    let borrower_key = ctx.accounts.position.borrower;
    {
        let position = &mut ctx.accounts.position;
        position.scaled_debt = 0;
        position.usdc_amount = 0;
        position.collateral_amount = 0;
        position.borrower_claimable_collateral = surplus;
        position.status = PositionStatus::Liquidated;
    }

    emit!(PositionLiquidated {
        borrower: borrower_key,
        position: ctx.accounts.position.key(),
        debt_repaid: debt,
        collateral_seized: seize,
        surplus_collateral: surplus,
    });
    Ok(())
}

#[event]
pub struct PositionLiquidated {
    pub borrower: Pubkey,
    pub position: Pubkey,
    pub debt_repaid: u64,
    pub collateral_seized: u64,
    pub surplus_collateral: u64,
}

// ─── ExternalLiquidate (anyone pays USDC when the SP is short) ──────────────

#[derive(Accounts)]
pub struct ExternalLiquidate<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,
    /// CHECK: original borrower, used as PDA seed only.
    pub borrower: UncheckedAccount<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [ORACLE_SEED, collateral_mint.key().as_ref()],
        bump = oracle.bump,
        constraint = oracle.mint == collateral_mint.key(),
    )]
    pub oracle: Box<Account<'info, OraclePrice>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, borrower.key().as_ref(), collateral_mint.key().as_ref()],
        bump = position.bump,
        constraint = position.borrower == borrower.key() @ PreLendError::Unauthorized,
        has_one = collateral_mint,
    )]
    pub position: Box<Account<'info, UserPosition>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = liquidator,
        associated_token::token_program = token_program,
    )]
    pub liquidator_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = liquidator,
        associated_token::mint = collateral_mint,
        associated_token::authority = liquidator,
        associated_token::token_program = token_program,
    )]
    pub liquidator_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [USDC_VAULT_SEED],
        bump = config.usdc_vault_bump,
        token::mint = usdc_mint,
        token::authority = config,
    )]
    pub usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [COLLATERAL_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = config,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_external_liquidate(ctx: Context<ExternalLiquidate>) -> Result<()> {
    require!(
        ctx.accounts.position.status == PositionStatus::Active,
        PreLendError::InvalidPositionStatus
    );

    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.config.accrue_interest(now)?;

    let price = crate::math::oracle_price_valid(
        ctx.accounts.oracle.mark_price_e6,
        ctx.accounts.oracle.twap_price_e6,
        ctx.accounts.oracle.mark_updated_at,
        ctx.accounts.oracle.twap_updated_at,
        now,
        ctx.accounts.config.risk_params.price_staleness_secs,
        ctx.accounts.config.test_mode_price_e6,
    )?;

    let debt = crate::math::actual_debt(
        ctx.accounts.position.scaled_debt,
        ctx.accounts.config.borrow_index_e18,
    )?;
    let collateral_value = crate::math::collateral_value_usdc(
        ctx.accounts.position.collateral_amount,
        ctx.accounts.collateral_mint.decimals,
        price,
    )?;
    let ltv = crate::math::ltv_bps(debt, collateral_value)?;
    require!(
        ltv >= ctx.accounts.config.risk_params.liquidation_ltv_bps as u64,
        PreLendError::PositionStillHealthy
    );

    let seize = std::cmp::min(
        crate::math::seize_amount(
            debt,
            ctx.accounts.config.risk_params.liquidation_bonus_bps,
            price,
            ctx.accounts.collateral_mint.decimals,
        )?,
        ctx.accounts.position.collateral_amount,
    );
    let surplus = ctx
        .accounts
        .position
        .collateral_amount
        .saturating_sub(seize);

    crate::token_utils::transfer_checked(
        ctx.accounts.token_program.key(),
        ctx.accounts.liquidator_usdc.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.usdc_vault.to_account_info(),
        ctx.accounts.liquidator.to_account_info(),
        debt,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.accounts.config.bump]];
    crate::token_utils::transfer_checked_signed(
        ctx.accounts.token_program.key(),
        ctx.accounts.collateral_vault.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(),
        ctx.accounts.liquidator_collateral.to_account_info(),
        ctx.accounts.config.to_account_info(),
        seize,
        ctx.accounts.collateral_mint.decimals,
        &[config_seeds],
    )?;

    ctx.accounts.config.total_borrowed = ctx
        .accounts
        .config
        .total_borrowed
        .saturating_sub(ctx.accounts.position.usdc_amount);

    let borrower_key = ctx.accounts.position.borrower;
    {
        let position = &mut ctx.accounts.position;
        position.scaled_debt = 0;
        position.usdc_amount = 0;
        position.collateral_amount = 0;
        position.borrower_claimable_collateral = surplus;
        position.status = PositionStatus::Liquidated;
    }

    emit!(PositionLiquidated {
        borrower: borrower_key,
        position: ctx.accounts.position.key(),
        debt_repaid: debt,
        collateral_seized: seize,
        surplus_collateral: surplus,
    });
    Ok(())
}

// ─── ClaimSurplusCollateral (borrower) ──────────────────────────────────────

#[derive(Accounts)]
pub struct ClaimSurplusCollateral<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, borrower.key().as_ref(), collateral_mint.key().as_ref()],
        bump = position.bump,
        has_one = borrower @ PreLendError::Unauthorized,
        has_one = collateral_mint,
        constraint = position.status == PositionStatus::Liquidated @ PreLendError::InvalidPositionStatus,
        close = borrower,
    )]
    pub position: Box<Account<'info, UserPosition>>,
    #[account(
        mut,
        seeds = [COLLATERAL_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = config,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
        associated_token::token_program = token_program,
    )]
    pub borrower_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_surplus_collateral(ctx: Context<ClaimSurplusCollateral>) -> Result<()> {
    let surplus = ctx.accounts.position.borrower_claimable_collateral;
    if surplus > 0 {
        let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.accounts.config.bump]];
        crate::token_utils::transfer_checked_signed(
            ctx.accounts.token_program.key(),
            ctx.accounts.collateral_vault.to_account_info(),
            ctx.accounts.collateral_mint.to_account_info(),
            ctx.accounts.borrower_collateral.to_account_info(),
            ctx.accounts.config.to_account_info(),
            surplus,
            ctx.accounts.collateral_mint.decimals,
            &[config_seeds],
        )?;
    }

    Ok(())
}

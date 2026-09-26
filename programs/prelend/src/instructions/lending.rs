use crate::constants::*;
use crate::error::PreLendError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

// ─── InitializePool ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: recipient of origination fees
    pub fee_recipient: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        init,
        payer = admin,
        seeds = [USDC_VAULT_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = config,
        token::token_program = token_program
    )]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_pool(
    ctx: Context<InitializePool>,
    protocol_fee_bps: u16,
    risk_params: RiskParams,
) -> Result<()> {
    require!(risk_params.max_borrow_ltv_bps > 0, PreLendError::ZeroAmount);
    require!(
        risk_params.liquidation_ltv_bps > risk_params.max_borrow_ltv_bps,
        PreLendError::LtvExceeded
    );
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.fee_recipient = ctx.accounts.fee_recipient.key();
    config.protocol_fee_bps = protocol_fee_bps;
    config.risk_params = risk_params;
    config.borrow_index_e18 = E18;
    config.last_accrual_ts = now;
    config.posted_depth = 0;
    config.test_mode_price_e6 = 0;
    config.paused = false;
    config.total_deposits = 0;
    config.total_borrowed = 0;
    config.bump = ctx.bumps.config;
    config.usdc_vault_bump = ctx.bumps.usdc_vault;
    Ok(())
}

// ─── DepositLiquidity ───────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct DepositLiquidity<'info> {
    #[account(mut)]
    pub lender: Signer<'info>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint
    )]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = lender,
        associated_token::token_program = token_program
    )]
    pub lender_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [USDC_VAULT_SEED],
        bump = config.usdc_vault_bump,
        token::mint = usdc_mint,
        token::authority = config
    )]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = lender,
        space = 8 + LenderAccount::INIT_SPACE,
        seeds = [LENDER_SEED, lender.key().as_ref()],
        bump
    )]
    pub lender_account: Account<'info, LenderAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_deposit_liquidity(ctx: Context<DepositLiquidity>, amount: u64) -> Result<()> {
    require!(amount > 0, PreLendError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.config.accrue_interest(now)?;

    let pool_value = ctx
        .accounts
        .usdc_vault
        .amount
        .checked_add(ctx.accounts.config.total_borrowed)
        .ok_or(PreLendError::MathOverflow)?;
    let new_shares = crate::math::shares_for_deposit(
        amount,
        ctx.accounts.config.total_deposits,
        pool_value,
    )?;
    require!(new_shares > 0, PreLendError::ZeroAmount);

    crate::token_utils::transfer_checked(
        ctx.accounts.token_program.key(),
        ctx.accounts.lender_usdc.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.usdc_vault.to_account_info(),
        ctx.accounts.lender.to_account_info(),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let lender_account = &mut ctx.accounts.lender_account;
    if lender_account.owner == Pubkey::default() {
        lender_account.owner = ctx.accounts.lender.key();
        lender_account.bump = ctx.bumps.lender_account;
    }
    lender_account.deposited = lender_account
        .deposited
        .checked_add(new_shares)
        .ok_or(PreLendError::MathOverflow)?;
    ctx.accounts.config.total_deposits = ctx
        .accounts
        .config
        .total_deposits
        .checked_add(new_shares)
        .ok_or(PreLendError::MathOverflow)?;
    Ok(())
}

// ─── WithdrawLiquidity ──────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    #[account(mut)]
    pub lender: Signer<'info>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint
    )]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = lender,
        associated_token::token_program = token_program
    )]
    pub lender_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [USDC_VAULT_SEED],
        bump = config.usdc_vault_bump,
        token::mint = usdc_mint,
        token::authority = config
    )]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [LENDER_SEED, lender.key().as_ref()],
        bump = lender_account.bump,
        constraint = lender_account.owner == lender.key() @ PreLendError::Unauthorized
    )]
    pub lender_account: Account<'info, LenderAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_withdraw_liquidity(ctx: Context<WithdrawLiquidity>, amount: u64) -> Result<()> {
    require!(amount > 0, PreLendError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.config.accrue_interest(now)?;

    let pool_value = ctx
        .accounts
        .usdc_vault
        .amount
        .checked_add(ctx.accounts.config.total_borrowed)
        .ok_or(PreLendError::MathOverflow)?;
    let max_assets = crate::math::assets_from_shares(
        ctx.accounts.lender_account.deposited,
        ctx.accounts.config.total_deposits,
        pool_value,
    )?;
    require!(amount <= max_assets, PreLendError::InsufficientDeposits);
    require!(
        ctx.accounts.usdc_vault.amount >= amount,
        PreLendError::InsufficientLiquidity
    );

    let shares_burned = if amount == max_assets {
        ctx.accounts.lender_account.deposited
    } else {
        crate::math::shares_for_withdraw(
            amount,
            ctx.accounts.config.total_deposits,
            pool_value,
        )?
    };
    require!(shares_burned > 0, PreLendError::ZeroAmount);
    require!(
        ctx.accounts.lender_account.deposited >= shares_burned,
        PreLendError::InsufficientDeposits
    );

    let seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.accounts.config.bump]];
    crate::token_utils::transfer_checked_signed(
        ctx.accounts.token_program.key(),
        ctx.accounts.usdc_vault.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.lender_usdc.to_account_info(),
        ctx.accounts.config.to_account_info(),
        amount,
        ctx.accounts.usdc_mint.decimals,
        &[seeds],
    )?;

    ctx.accounts.lender_account.deposited -= shares_burned;
    ctx.accounts.config.total_deposits = ctx
        .accounts
        .config
        .total_deposits
        .saturating_sub(shares_burned);
    Ok(())
}

// ─── BorrowUsdc ─────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct BorrowUsdc<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [ORACLE_SEED, collateral_mint.key().as_ref()],
        bump = oracle.bump,
        constraint = oracle.mint == collateral_mint.key()
    )]
    pub oracle: Box<Account<'info, OraclePrice>>,
    #[account(
        seeds = [STABILITY_POOL_SEED, collateral_mint.key().as_ref()],
        bump = stability_pool.bump,
        constraint = stability_pool.collateral_mint == collateral_mint.key()
    )]
    pub stability_pool: Box<Account<'info, StabilityPool>>,
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
        associated_token::token_program = token_program
    )]
    pub borrower_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = usdc_mint,
        associated_token::authority = borrower,
        associated_token::token_program = token_program
    )]
    pub borrower_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = borrower,
        seeds = [COLLATERAL_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = config,
        token::token_program = token_program
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [USDC_VAULT_SEED],
        bump = config.usdc_vault_bump,
        token::mint = usdc_mint,
        token::authority = config
    )]
    pub usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must match the configured fee recipient
    #[account(address = config.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = usdc_mint,
        associated_token::authority = fee_recipient,
        associated_token::token_program = token_program
    )]
    pub fee_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = borrower,
        space = 8 + UserPosition::INIT_SPACE,
        seeds = [POSITION_SEED, borrower.key().as_ref(), collateral_mint.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, UserPosition>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_borrow_usdc(
    ctx: Context<BorrowUsdc>,
    collateral_amount: u64,
    borrow_amount: u64,
) -> Result<()> {
    require!(collateral_amount > 0, PreLendError::ZeroAmount);
    require!(borrow_amount > 0, PreLendError::ZeroAmount);
    require!(!ctx.accounts.config.paused, PreLendError::PoolPaused);

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

    let collateral_value = crate::math::collateral_value_usdc(
        collateral_amount,
        ctx.accounts.collateral_mint.decimals,
        price,
    )?;
    let ltv = crate::math::ltv_bps(borrow_amount, collateral_value)?;
    require!(
        ltv <= ctx.accounts.config.risk_params.max_borrow_ltv_bps as u64,
        PreLendError::LtvExceeded
    );

    // Debt cap: total outstanding <= what the backstop can absorb (SP USDC + DEX depth).
    let cap = ctx
        .accounts
        .stability_pool
        .available_usdc()
        .saturating_add(ctx.accounts.config.posted_depth);
    require!(
        ctx.accounts
            .config
            .total_borrowed
            .saturating_add(borrow_amount)
            <= cap,
        PreLendError::DebtCapExceeded
    );

    let fee = crate::math::bps_of(borrow_amount, ctx.accounts.config.protocol_fee_bps)?;
    let to_borrower = borrow_amount
        .checked_sub(fee)
        .ok_or(PreLendError::MathOverflow)?;
    require!(
        ctx.accounts.usdc_vault.amount >= borrow_amount,
        PreLendError::InsufficientLiquidity
    );

    // Collateral in
    crate::token_utils::transfer_checked(
        ctx.accounts.token_program.key(),
        ctx.accounts.borrower_collateral.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(),
        ctx.accounts.collateral_vault.to_account_info(),
        ctx.accounts.borrower.to_account_info(),
        collateral_amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    // USDC to borrower
    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.accounts.config.bump]];
    crate::token_utils::transfer_checked_signed(
        ctx.accounts.token_program.key(),
        ctx.accounts.usdc_vault.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.borrower_usdc.to_account_info(),
        ctx.accounts.config.to_account_info(),
        to_borrower,
        ctx.accounts.usdc_mint.decimals,
        &[config_seeds],
    )?;
    if fee > 0 {
        crate::token_utils::transfer_checked_signed(
            ctx.accounts.token_program.key(),
            ctx.accounts.usdc_vault.to_account_info(),
            ctx.accounts.usdc_mint.to_account_info(),
            ctx.accounts.fee_usdc.to_account_info(),
            ctx.accounts.config.to_account_info(),
            fee,
            ctx.accounts.usdc_mint.decimals,
            &[config_seeds],
        )?;
    }

    let scaled_debt =
        crate::math::scaled_amount(borrow_amount, ctx.accounts.config.borrow_index_e18)?;

    {
        let position = &mut ctx.accounts.position;
        position.borrower = ctx.accounts.borrower.key();
        position.collateral_mint = ctx.accounts.collateral_mint.key();
        position.collateral_amount = collateral_amount;
        position.usdc_amount = borrow_amount;
        position.scaled_debt = scaled_debt;
        position.borrower_claimable_collateral = 0;
        position.last_accrued_ts = now;
        position.status = PositionStatus::Active;
        position.bump = ctx.bumps.position;
    }

    ctx.accounts.config.total_borrowed = ctx
        .accounts
        .config
        .total_borrowed
        .checked_add(borrow_amount)
        .ok_or(PreLendError::MathOverflow)?;

    emit!(LoanOpened {
        borrower: ctx.accounts.borrower.key(),
        position: ctx.accounts.position.key(),
        collateral_mint: ctx.accounts.collateral_mint.key(),
        collateral_amount,
        usdc_amount: borrow_amount,
        ltv_bps: ltv,
    });
    Ok(())
}

#[event]
pub struct LoanOpened {
    pub borrower: Pubkey,
    pub position: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_amount: u64,
    pub usdc_amount: u64,
    pub ltv_bps: u64,
}

// ─── RepayAndWithdraw ───────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct RepayAndWithdraw<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.usdc_mint == usdc_mint.key() @ PreLendError::InvalidUsdcMint
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, borrower.key().as_ref(), collateral_mint.key().as_ref()],
        bump = position.bump,
        has_one = borrower @ PreLendError::Unauthorized,
        has_one = collateral_mint,
        close = borrower
    )]
    pub position: Box<Account<'info, UserPosition>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = borrower,
        associated_token::token_program = token_program
    )]
    pub borrower_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
        associated_token::token_program = token_program
    )]
    pub borrower_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [USDC_VAULT_SEED],
        bump = config.usdc_vault_bump,
        token::mint = usdc_mint,
        token::authority = config
    )]
    pub usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [COLLATERAL_VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = config
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_repay_and_withdraw(ctx: Context<RepayAndWithdraw>) -> Result<()> {
    require!(
        ctx.accounts.position.status == PositionStatus::Active,
        PreLendError::InvalidPositionStatus
    );

    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.config.accrue_interest(now)?;

    let debt = crate::math::actual_debt(
        ctx.accounts.position.scaled_debt,
        ctx.accounts.config.borrow_index_e18,
    )?;
    let collateral_amount = ctx.accounts.position.collateral_amount;

    // Borrower repays actual debt (principal + accrued interest)
    crate::token_utils::transfer_checked(
        ctx.accounts.token_program.key(),
        ctx.accounts.borrower_usdc.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.usdc_vault.to_account_info(),
        ctx.accounts.borrower.to_account_info(),
        debt,
        ctx.accounts.usdc_mint.decimals,
    )?;

    // Return collateral
    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.accounts.config.bump]];
    crate::token_utils::transfer_checked_signed(
        ctx.accounts.token_program.key(),
        ctx.accounts.collateral_vault.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(),
        ctx.accounts.borrower_collateral.to_account_info(),
        ctx.accounts.config.to_account_info(),
        collateral_amount,
        ctx.accounts.collateral_mint.decimals,
        &[config_seeds],
    )?;

    ctx.accounts.config.total_borrowed = ctx
        .accounts
        .config
        .total_borrowed
        .saturating_sub(ctx.accounts.position.usdc_amount);

    emit!(LoanRepaid {
        borrower: ctx.accounts.borrower.key(),
        position: ctx.accounts.position.key(),
        repaid_usdc: debt,
    });
    Ok(())
}

#[event]
pub struct LoanRepaid {
    pub borrower: Pubkey,
    pub position: Pubkey,
    pub repaid_usdc: u64,
}

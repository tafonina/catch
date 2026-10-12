use crate::constants::*;
use crate::error::PreLendError;
use crate::state::*;
use crate::token_utils;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface};

// ─── UpdateDepth (admin) ────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpdateDepth<'info> {
    pub admin: Signer<'info>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, collateral_mint.key().as_ref()],
        bump = config.bump,
        has_one = admin @ PreLendError::Unauthorized,
        constraint = config.collateral_mint == collateral_mint.key() @ PreLendError::MintNotAdmitted,
    )]
    pub config: Account<'info, GlobalConfig>,
}

pub fn handle_update_depth(ctx: Context<UpdateDepth>, posted_depth: u64) -> Result<()> {
    ctx.accounts.config.posted_depth = posted_depth;
    Ok(())
}

// ─── SetPaused (admin) ──────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub admin: Signer<'info>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [CONFIG_SEED, collateral_mint.key().as_ref()],
        bump = config.bump,
        has_one = admin @ PreLendError::Unauthorized,
        constraint = config.collateral_mint == collateral_mint.key() @ PreLendError::MintNotAdmitted,
    )]
    pub config: Account<'info, GlobalConfig>,
}

pub fn handle_set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

/// Drain and close the existing pool PDAs so `initialize_pool` can run after an upgrade.
/// `config` is unchecked because the old account layout does not match `GlobalConfig`.
/// Admin is the 32 bytes after the Anchor discriminator. Extra leftover program
/// accounts (e.g. old lender PDAs) can be passed as remaining accounts.
#[derive(Accounts)]
pub struct ResetPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: PDA; admin verified from raw bytes in the handler.
    #[account(mut, seeds = [CONFIG_SEED, collateral_mint.key().as_ref()], bump)]
    pub config: UncheckedAccount<'info>,
    /// CHECK: vault token account PDA.
    #[account(mut, seeds = [USDC_VAULT_SEED, collateral_mint.key().as_ref()], bump)]
    pub usdc_vault: UncheckedAccount<'info>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = admin,
        token::token_program = token_program
    )]
    pub admin_usdc: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_reset_pool<'a>(ctx: Context<'a, ResetPool<'a>>) -> Result<()> {
    {
        let data = ctx.accounts.config.try_borrow_data()?;
        require!(data.len() >= 40, PreLendError::Unauthorized);
        let stored_admin = Pubkey::try_from(&data[8..40]).map_err(|_| PreLendError::Unauthorized)?;
        require_keys_eq!(stored_admin, ctx.accounts.admin.key(), PreLendError::Unauthorized);
    }

    let vault_amount = {
        let data = ctx.accounts.usdc_vault.try_borrow_data()?;
        require!(data.len() >= 72, PreLendError::InvalidUsdcMint);
        let mint = Pubkey::try_from(&data[0..32]).map_err(|_| PreLendError::InvalidUsdcMint)?;
        require_keys_eq!(mint, ctx.accounts.usdc_mint.key(), PreLendError::InvalidUsdcMint);
        u64::from_le_bytes(
            data[64..72]
                .try_into()
                .map_err(|_| PreLendError::MathOverflow)?,
        )
    };

    let bump = ctx.bumps.config;
    let mint = ctx.accounts.collateral_mint.key();
    let seeds: &[&[u8]] = &[CONFIG_SEED, mint.as_ref(), &[bump]];
    let signer = &[seeds];

    if vault_amount > 0 {
        token_utils::transfer_checked_signed(
            ctx.accounts.token_program.key(),
            ctx.accounts.usdc_vault.to_account_info(),
            ctx.accounts.usdc_mint.to_account_info(),
            ctx.accounts.admin_usdc.to_account_info(),
            ctx.accounts.config.to_account_info(),
            vault_amount,
            ctx.accounts.usdc_mint.decimals,
            signer,
        )?;
    }

    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.usdc_vault.to_account_info(),
            destination: ctx.accounts.admin.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        },
        signer,
    ))?;

    let admin_info = ctx.accounts.admin.to_account_info();
    for acc in ctx.remaining_accounts.iter() {
        require_keys_eq!(*acc.owner, crate::ID, PreLendError::Unauthorized);
        close_owned(acc, &admin_info)?;
    }

    close_owned(&ctx.accounts.config.to_account_info(), &admin_info)?;
    Ok(())
}

/// Drain leftover v1 global PDAs (`global-config` / `usdc-vault` without a market mint)
/// after the isolation upgrade. New markets use `[seed, collateral_mint]`.
#[derive(Accounts)]
pub struct CloseLegacyGlobal<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: old global config; admin verified from raw bytes.
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub legacy_config: UncheckedAccount<'info>,
    /// CHECK: old senior vault PDA.
    #[account(mut, seeds = [USDC_VAULT_SEED], bump)]
    pub legacy_usdc_vault: UncheckedAccount<'info>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = admin,
        token::token_program = token_program
    )]
    pub admin_usdc: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_close_legacy_global<'a>(ctx: Context<'a, CloseLegacyGlobal<'a>>) -> Result<()> {
    {
        let data = ctx.accounts.legacy_config.try_borrow_data()?;
        require!(data.len() >= 40, PreLendError::Unauthorized);
        let stored_admin = Pubkey::try_from(&data[8..40]).map_err(|_| PreLendError::Unauthorized)?;
        require_keys_eq!(stored_admin, ctx.accounts.admin.key(), PreLendError::Unauthorized);
    }

    let vault_amount = {
        let data = ctx.accounts.legacy_usdc_vault.try_borrow_data()?;
        require!(data.len() >= 72, PreLendError::InvalidUsdcMint);
        let mint = Pubkey::try_from(&data[0..32]).map_err(|_| PreLendError::InvalidUsdcMint)?;
        require_keys_eq!(mint, ctx.accounts.usdc_mint.key(), PreLendError::InvalidUsdcMint);
        u64::from_le_bytes(
            data[64..72]
                .try_into()
                .map_err(|_| PreLendError::MathOverflow)?,
        )
    };

    let bump = ctx.bumps.legacy_config;
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[bump]];
    let signer = &[seeds];

    if vault_amount > 0 {
        token_utils::transfer_checked_signed(
            ctx.accounts.token_program.key(),
            ctx.accounts.legacy_usdc_vault.to_account_info(),
            ctx.accounts.usdc_mint.to_account_info(),
            ctx.accounts.admin_usdc.to_account_info(),
            ctx.accounts.legacy_config.to_account_info(),
            vault_amount,
            ctx.accounts.usdc_mint.decimals,
            signer,
        )?;
    }

    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.legacy_usdc_vault.to_account_info(),
            destination: ctx.accounts.admin.to_account_info(),
            authority: ctx.accounts.legacy_config.to_account_info(),
        },
        signer,
    ))?;

    let admin_info = ctx.accounts.admin.to_account_info();
    for acc in ctx.remaining_accounts.iter() {
        require_keys_eq!(*acc.owner, crate::ID, PreLendError::Unauthorized);
        close_owned(acc, &admin_info)?;
    }

    close_owned(&ctx.accounts.legacy_config.to_account_info(), &admin_info)?;
    Ok(())
}

fn close_owned<'info>(account: &AccountInfo<'info>, dest: &AccountInfo<'info>) -> Result<()> {
    let dest_lamports = dest.lamports();
    **dest.try_borrow_mut_lamports()? = dest_lamports
        .checked_add(account.lamports())
        .ok_or(PreLendError::MathOverflow)?;
    **account.try_borrow_mut_lamports()? = 0;
    account.assign(&system_program::ID);
    account.resize(0)?;
    Ok(())
}

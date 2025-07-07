use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, TokenAccount, Token, transfer, mint_to};
use anchor_spl::dex::{self, Swap};
use spl_token::instruction::AuthorityType;
use crate::error::SubscribeError;
use crate::state::Subscription;

declare_id!("GcMint1111111111111111111111111111111111");

#[program]
pub mod subscribe {
    use super::*;
    const SUB_AMOUNT: u64 = 12 * 10u64.pow(6);
    const REFUND_FEE: u64 = 1 * 10u64.pow(5); // 0.1 GC
    const MAX_SUPPLY: u64 = 1_000_000_000 * 10u64.pow(6);

    pub fn subscribe(ctx: Context<Subscribe>) -> Result<()> {
        let user_amount = ctx.accounts.user_gc_account.amount;
        // enforce exact amount check
        if user_amount < SUB_AMOUNT {
            return err!(SubscribeError::InsufficientAmount);
        }
        // refund delta if overpay
        if user_amount > SUB_AMOUNT {
            let delta = user_amount - SUB_AMOUNT;
            let fee = REFUND_FEE;
            let refund_amount = delta.checked_sub(fee).unwrap_or(0);
            if refund_amount > 0 {
                // refund refund_amount to user
                transfer_tokens(
                    &ctx.accounts.token_program,
                    &ctx.accounts.user_gc_account,
                    &ctx.accounts.user_gc_account,
                    &ctx.accounts.payer,
                    refund_amount,
                )?;
            }
        }

        // 1) Move 12 GC from user to program vault
        transfer_tokens(
            &ctx.accounts.token_program,
            &ctx.accounts.user_gc_account,
            &ctx.accounts.treasury_vault,
            &ctx.accounts.payer,
            SUB_AMOUNT,
        )?;

        // split and swap via Jupiter CPI
        //   6 GC -> treasury (no swap)
        let six_gc = 6 * 10u64.pow(6);
        //   4 GC -> operations => swap to USDC
        let four_gc = 4 * 10u64.pow(6);
        dex::swap(
            CpiContext::new(
                ctx.accounts.dex_program.to_account_info(),
                dex::Swap {
                    user_source: ctx.accounts.treasury_vault.to_account_info(),
                    user_destination: ctx.accounts.operations_usdc.to_account_info(),
                    authority: ctx.accounts.program_authority.to_account_info(),
                    // other DEX accounts...
                },
            ),
            four_gc,
        )?;
        //   2 GC -> corridor vault => swap to USDC
        let two_gc = 2 * 10u64.pow(6);
        dex::swap(
            CpiContext::new(
                ctx.accounts.dex_program.to_account_info(),
                dex::Swap {
                    user_source: ctx.accounts.treasury_vault.to_account_info(),
                    user_destination: ctx.accounts.corridor_usdc.to_account_info(),
                    authority: ctx.accounts.program_authority.to_account_info(),
                },
            ),
            two_gc,
        )?;

        // create subscription state
        let now = Clock::get()?;
        let sub = &mut ctx.accounts.subscription;
        sub.user = ctx.accounts.payer.key();
        sub.start_slot = now.slot;
        // correct slot math: ~400ms per slot
        const SLOTS_PER_DAY: u64 = 216_000;
        sub.expiry_slot = now.slot.checked_add(365.checked_mul(SLOTS_PER_DAY).unwrap()).unwrap();

        // mint SBT
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::MintTo {
                    mint: ctx.accounts.sbt_mint.to_account_info(),
                    to: ctx.accounts.user_sbt_account.to_account_info(),
                    authority: ctx.accounts.program_authority.to_account_info(),
                },
                &[&[b"authority", &[*ctx.bumps.get("program_authority").unwrap()]]],
            ),
            1,
        ).map_err(|_| SubscribeError::MintFailed)?;

        emit!(Subscribed { user: sub.user, expiry_slot: sub.expiry_slot });
        Ok(())
    }

    pub fn renew(ctx: Context<Renew>) -> Result<()> {
        // identical logic
        subscribe(ctx.into())
    }
}

// common transfer helper
fn transfer_tokens<'a>(
    token_program: &Program<'a, Token>,
    from: &Account<'a, TokenAccount>,
    to: &Account<'a, TokenAccount>,
    authority: &Signer<'a>,
    amount: u64,
) -> Result<()> {
    token::transfer(
        CpiContext::new(
            token_program.to_account_info(),
            token::Transfer { from: from.to_account_info(), to: to.to_account_info(), authority: authority.to_account_info() },
        ),
        amount,
    ).map_err(|_| SubscribeError::TokenTransferFailed)?;
    Ok(())
}

#[derive(Accounts)]
pub struct Subscribe<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    #[account(mut)] pub user_gc_account: Account<'info, TokenAccount>,
    #[account(mut)] pub treasury_vault: Account<'info, TokenAccount>,
    #[account(mut)] pub operations_usdc: Account<'info, TokenAccount>,
    #[account(mut)] pub corridor_usdc: Account<'info, TokenAccount>,
    #[account(init, payer = payer, space = 8 + 32 + 8 + 8)] pub subscription: Account<'info, Subscription>,
    #[account(mut)] pub sbt_mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = payer, associated_token::mint = sbt_mint, associated_token::authority = payer)] pub user_sbt_account: Account<'info, TokenAccount>,
    /// CHECK: PDA authority
    #[account(seeds = [b"authority"], bump)] pub program_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub dex_program: Program<'info, Swap>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Renew<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    #[account(mut)] pub user_gc_account: Account<'info, TokenAccount>,
    #[account(mut)] pub subscription: Account<'info, Subscription>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct Subscribed {
    pub user: Pubkey,
    pub expiry_slot: u64,
}

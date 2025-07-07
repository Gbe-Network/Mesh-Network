use anchor_lang::prelude::*;

#[error_code]
pub enum SubscribeError {
    #[msg("Insufficient GC amount. Minimum of 12 GC required.")]
    InsufficientAmount,

    #[msg("Token transfer failed.")]
    TokenTransferFailed,

    #[msg("Minting subscription SBT failed.")]
    MintFailed,

    #[msg("Maximum GC supply cap exceeded.")]
    SupplyCapExceeded,

    #[msg("Refund processing failed.")]
    RefundFailed,

    #[msg("Unauthorized action.")]
    Unauthorized,
}

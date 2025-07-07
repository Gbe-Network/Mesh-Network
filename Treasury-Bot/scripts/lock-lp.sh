#!/usr/bin/env bash
# scripts/lock-lp.sh
# Disables mint authority on the Raydium LP mint to lock initial liquidity (no new LP tokens can be minted)

set -euo pipefail

# Load environment variables (requires LP_MINT defined)
source .env

if [[ -z "${LP_MINT:-}" ]]; then
  echo "Error: LP_MINT is not set in .env"
  exit 1
fi

# Disable mint authority (prevents any further minting of LP tokens)
spl-token authorize $LP_MINT mint --disable --url "$RPC_URL"

echo "Mint authority for LP mint $LP_MINT has been disabled. Initial liquidity is now locked."

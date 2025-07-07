#!/usr/bin/env bash
# scripts/setup-spl-token.sh
# Initializes the GC mint and associated token accounts for treasury, operations, and corridor vaults

set -euo pipefail

# Load environment variables
source .env

# Create the Guaso Coin mint (6 decimals)
GC_MINT_ADDRESS=$(spl-token create-token \
  --decimals 6 \
  --mint-authority "$MINT_AUTHORITY_KEYPAIR" \
  --url "$RPC_URL" \
  | awk '/Creating token/ { print $NF }')
echo "Created GC mint: $GC_MINT_ADDRESS"

# Create treasury GC vault
TREASURY_VAULT=$(spl-token create-account $GC_MINT_ADDRESS \
  --owner "$TREASURY_AUTHORITY_KEYPAIR" \
  --url "$RPC_URL" \
  | awk '/Creating account/ { print $NF }')
echo "Treasury GC vault: $TREASURY_VAULT"

# Create operations GC vault (for OpEx swaps)
OPERATIONS_VAULT=$(spl-token create-account $GC_MINT_ADDRESS \
  --owner "$OPERATIONS_AUTHORITY_KEYPAIR" \
  --url "$RPC_URL" \
  | awk '/Creating account/ { print $NF }')
echo "Operations GC vault: $OPERATIONS_VAULT"

# Create corridor USDC vault (assumes USDC mint exists)
CORRIDOR_USDC_VAULT=$(spl-token create-account $USDC_MINT \
  --owner "$CORRIDOR_AUTHORITY_KEYPAIR" \
  --url "$RPC_URL" \
  | awk '/Creating account/ { print $NF }')
echo "Corridor USDC vault: $CORRIDOR_USDC_VAULT"

# Update environment file with generated addresses
sed -i.bak \
  -e "s|^GC_MINT=.*|GC_MINT=$GC_MINT_ADDRESS|" \
  -e "s|^TREASURY_GC_VAULT=.*|TREASURY_GC_VAULT=$TREASURY_VAULT|" \
  -e "s|^OPERATIONS_GC_VAULT=.*|OPERATIONS_GC_VAULT=$OPERATIONS_VAULT|" \
  -e "s|^CORRIDOR_USDC_VAULT=.*|CORRIDOR_USDC_VAULT=$CORRIDOR_USDC_VAULT|" \
  .env

echo "Environment variables updated in .env (backup created as .env.bak)"

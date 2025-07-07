#!/usr/bin/env bash
# scripts/deploy-anchor.sh
# Compiles and deploys the Anchor subscribe program to Solana

set -euo pipefail

# Load environment variables
source .env

# Ensure Anchor CLI is installed
if ! command -v anchor &> /dev/null; then
  echo "Anchor CLI not found. Please install @project-serum/anchor-cli."
  exit 1
fi

# Build the program
echo "Building Anchor programs..."
anchor build

# Deploy to cluster
echo "Deploying Anchor program to $ANCHOR_CLUSTER..."
anchor deploy --provider.cluster $ANCHOR_CLUSTER

# Capture deployed program ID (parsed from Anchor.toml)
PROGRAM_ID=$(anchor keys list | grep subscribe | awk '{print $2}')
echo "Deployed program ID: $PROGRAM_ID"

# Update environment
sed -i.bak \
  -e "s|^SUBSCRIBE_PROGRAM=.*|SUBSCRIBE_PROGRAM=$PROGRAM_ID|" \
  .env

echo "Updated SUBSCRIBE_PROGRAM in .env (backup at .env.bak)"

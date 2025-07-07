README.md
# Guaso Coin Monorepo

This monorepo contains all production code for Guaso Coin (GC):

- `anchor-programs/subscribe`: Anchor program for subscription flow and SBT minting.
- `offchain-bots`: Corridor stabiliser and optional subscription helper bots.
- `api-indexer`: Node.js service indexing on-chain events.
- `dashboard`: React dashboard showing price bands and treasury.
- `telegram-bots`: Event notifier to Telegram.
- `governance`: Squads multisig configuration.
- `scripts`: Shell scripts for deployment and setup.

## Getting Started
1. Configure environment variables in `.env`.
2. Run `scripts/setup-spl-token.sh` to initialize on-chain accounts.
3. `anchor build && anchor deploy`
4. `npm install` in each JS/TS package.
5. Deploy bots and API.


##
# Anchor program already built/deployed
cd offchain-bots/corridor-stabiliser && npm install && npm start
cd offchain-bots/subscribe-bot    && npm install && npm start
cd api-indexer                    && npm install && npm start
cd dashboard                      && npm install && npm run dev
cd telegram-bots/public-channel-notifier && npm install && npm start

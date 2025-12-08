# 🚀 solo swap

## if you clone it, pls fork it

fr if you're making this better, i want in. let's build together.

**batch token liquidation for solana portfolios**

solo swap enables users to efficiently liquidate multiple solana tokens in a single operation while maintaining portfolio allocation percentages. built for traders, defi enthusiasts, and portfolio managers who need to quickly convert diverse token holdings into preferred stablecoins or sol without disrupting their investment strategy.

**never miss your moon shot** - liquidate profits while keeping your core positions intact.

## ✨ features

### 🎯 current features
- **portfolio-preserving liquidation**: liquidate tokens without impacting your allocation percentages through intelligent pro-rata calculations
- **batch token selection**: select multiple tokens from your wallet for simultaneous liquidation
- **pro-rata calculations**: automatically calculates proportional amounts based on token values to maintain portfolio balance
- **multi-rpc load balancing**: intelligent rpc endpoint management with failover support
- **real-time price feeds**: live pricing via jupiter api for accurate value calculations
- **customizable liquidation**: set liquidation percentages from 0-100% with precision controls
- **wallet integration**: full support for phantom, solflare, and ledger hardware wallets
- **transaction tracking**: real-time swap progress with detailed success/failure reporting
- **slippage control**: configurable slippage tolerance (0.5% - 10%)
- **output token selection**: convert to usdc, usdt, or sol
- **swap history tracking**: automatically logs each liquidation and draws sell indicators on the history chart (firebase required)
- **multi-route quote comparison**: automatically fetches and compares multiple swap routes to ensure the best price

### 🔄 advanced rpc management
- **load balancing**: automatic distribution across multiple rpc endpoints
- **rate limiting**: smart request throttling to avoid api limits
- **failover recovery**: seamless switching between endpoints during failures
- **health monitoring**: real-time rpc endpoint status tracking

### 👛 wallet support
- **phantom wallet**
- **solflare wallet** 
- **ledger hardware wallet** (with physical confirmation support)
- **auto-connect** capabilities
- **secure transaction signing**

## 🚧 planned features

#### transaction history
- **jito bundler** to wrap swap instructions in bundles of 5 swaps per signature
- **token safety indicators** on search mechanisms (green, yellow, red warning levels)
- **customizable columns** to allow users to organize how they wish
- **mobile optimization** for text size and touch operability
- **re-apply cron job** for periodic auto-fetch of portfolio values

### 🔥 transaction bundling (coming soon)
- **atomic multi-token swaps**: bundle multiple token swaps into single transactions
- **gas optimization**: reduced network fees through transaction compression
- **partial failover protection**: individual token swap failure doesn't block entire operation
- **batch confirmation**: single confirmation for multiple swaps

### 🔐 ledger enhancements (coming soon)
- **enhanced error handling**: better user feedback for ledger-specific issues
- **transaction previews**: preview transaction details on ledger device
- **multi-signature support**: advanced transaction signing workflows
- **device compatibility**: expanded support for ledger nano models

### 📈 advanced features (roadmap)
- **portfolio analytics**: historical performance tracking and insights
- **limit orders**: time-based and price-triggered liquidation orders
- **cross-chain support**: ethereum and other chain integrations
- **api access**: developer api for programmatic portfolio management
- **mobile optimization**: dedicated mobile experience

## 🛠️ local development

### prerequisites
- node.js 18+ 
- npm, yarn, pnpm, or bun
- solana wallet (phantom recommended)

### installation

1. **clone the repository**
   
   ```bash
   git clone https://github.com/ilovespectra/solo-swap-v2.git
   cd solana-token-swapper
   ```

2. install dependencies

    ```bash
    npm install
    # or
    yarn install
    # or
    pnpm install
    ```

environment configuration

3. create a .env.local file in the root directory:
    ```bash
    NEXT_PUBLIC_HELIUS_API_KEY=heliusapikey
    NEXT_PUBLIC_RPC_ENDPOINT_1="quicknode-rpc-url-with-api-key"
    NEXT_PUBLIC_RPC_ENDPOINT_2="helius-rpc-url-with-api-key"

    NEXT_PUBLIC_FIREBASE_API_KEY=""
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=""
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=""
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=""
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=""
    NEXT_PUBLIC_FIREBASE_APP_ID=""
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=""

    NEXT_PUBLIC_ENCRYPTION_SECRET=""
    NEXT_PUBLIC_HASH_SALT=""
    NEXT_PUBLIC_ENABLE_HISTORY="false" // change to "true"!
    ```

### transaction history setup

swap history + sell indicators require firebase firestore:

1. enable firestore in your firebase project (rules can stay in test mode for local work)
2. fill in every `NEXT_PUBLIC_FIREBASE_*` variable plus `NEXT_PUBLIC_ENCRYPTION_SECRET` and `NEXT_PUBLIC_HASH_SALT`
3. set `NEXT_PUBLIC_ENABLE_HISTORY=true` to activate logging
4. firestore automatically creates a `swapHistory` collection after your first liquidation; no manual indexes are required for the default queries, but if prompted, create the wallet+timestamp composite index suggested in the firebase console

4. run development server

    ```bash
    npm run dev
    # or
    yarn dev
    # or
    pnpm dev
    # or
    bun dev
    ```

5. open application

    navigate to http://localhost:3000 in your browser
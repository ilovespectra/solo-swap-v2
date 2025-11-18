# 🚀 Solo Swap

**Batch Token Liquidation for Solana Portfolios**

Solo Swap enables users to efficiently liquidate multiple Solana tokens in a single operation while maintaining portfolio allocation percentages. Built for traders, DeFi enthusiasts, and portfolio managers who need to quickly convert diverse token holdings into preferred stablecoins or SOL without disrupting their investment strategy.

**Never miss your moon shot** - Liquidate profits while keeping your core positions intact.

## ✨ Features

### 🎯 Current Features
- **Portfolio-Preserving Liquidation**: Liquidate tokens without impacting your allocation percentages through intelligent pro-rata calculations
- **Batch Token Selection**: Select multiple tokens from your wallet for simultaneous liquidation
- **Pro-Rata Calculations**: Automatically calculates proportional amounts based on token values to maintain portfolio balance
- **Multi-RPC Load Balancing**: Intelligent RPC endpoint management with failover support
- **Real-Time Price Feeds**: Live pricing via Jupiter API for accurate value calculations
- **Customizable Liquidation**: Set liquidation percentages from 0-100% with precision controls
- **Wallet Integration**: Full support for Phantom, Solflare, and Ledger hardware wallets
- **Transaction Tracking**: Real-time swap progress with detailed success/failure reporting
- **Slippage Control**: Configurable slippage tolerance (0.5% - 10%)
- **Output Token Selection**: Convert to USDC, USDT, or SOL

### 🔄 Advanced RPC Management
- **Load Balancing**: Automatic distribution across multiple RPC endpoints
- **Rate Limiting**: Smart request throttling to avoid API limits
- **Failover Recovery**: Seamless switching between endpoints during failures
- **Health Monitoring**: Real-time RPC endpoint status tracking

### 👛 Wallet Support
- **Phantom Wallet**
- **Solflare Wallet** 
- **Ledger Hardware Wallet** (with physical confirmation support)
- **Auto-Connect** capabilities
- **Secure Transaction Signing**

## 🚧 Planned Features

### 🔥 Transaction Bundling (Coming Soon)
- **Atomic Multi-Token Swaps**: Bundle multiple token swaps into single transactions
- **Gas Optimization**: Reduced network fees through transaction compression
- **Partial Failover Protection**: Individual token swap failure doesn't block entire operation
- **Batch Confirmation**: Single confirmation for multiple swaps

### 🔐 Ledger Enhancements (Coming Soon)
- **Enhanced Error Handling**: Better user feedback for Ledger-specific issues
- **Transaction Previews**: Preview transaction details on Ledger device
- **Multi-Signature Support**: Advanced transaction signing workflows
- **Device Compatibility**: Expanded support for Ledger Nano models

### 📈 Advanced Features (Roadmap)
- **Portfolio Analytics**: Historical performance tracking and insights
- **Limit Orders**: Time-based and price-triggered liquidation orders
- **Cross-Chain Support**: Ethereum and other chain integrations
- **API Access**: Developer API for programmatic portfolio management
- **Mobile Optimization**: Dedicated mobile experience

## 🛠️ Local Development

### Prerequisites
- Node.js 18+ 
- npm, yarn, pnpm, or bun
- Solana wallet (Phantom recommended)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/ilovespectra/solo-swap-v2.git
   cd solana-token-swapper
   ```

2. Install dependencies

    ```bash
    npm install
    # or
    yarn install
    # or
    pnpm install
    ```

Environment Configuration

3. Create a .env.local file in the root directory:
    ```bash
    NEXT_PUBLIC_RPC_ENDPOINT_1=https://your-quiknode-endpoint.com/your-api-key
    NEXT_PUBLIC_RPC_ENDPOINT_2=https://your-helius-endpoint.com/your-api-key
    ```

4. Run Development Server

    ```bash
    npm run dev
    # or
    yarn dev
    # or
    pnpm dev
    # or
    bun dev
    ```

5. Open Application

    Navigate to http://localhost:3000 in your browser
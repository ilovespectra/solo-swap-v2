export interface TokenBalance {
  changePercent24h?: number | null;
  mint: string;
  symbol: string;
  name: string;
  balance?: number;
  decimals: number;
  uiAmount: number;
  price?: number;
  value: number;
  selected: boolean;
  logoURI?: string | null;
  lastUpdated?: number;
}

export interface TokenInfo {
  address: string;
  chainId: number;
  decimals: number;
  name: string;
  symbol: string;
  logoURI?: string;
  tags?: string[];
  extensions?: {
    coingeckoId?: string;
  };
}

export interface PlatformFee {
  amount: string;
  feeBps: number;
}

export interface RoutePlanStep {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: PlatformFee;
  priceImpactPct: string;
  routePlan: RoutePlanStep[];
}

export interface ProRataSwap {
  selectedTokens: TokenBalance[];
  totalValue: number;
  outputToken: string;
  quotes: SwapQuote[];
}

export interface PriceProgress {
  current: number;
  total: number;
  currentToken?: string;
}
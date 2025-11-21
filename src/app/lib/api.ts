import { Connection, PublicKey } from '@solana/web3.js';
import { TokenBalance, TokenInfo } from '../types/token';

const JUPITER_API = 'https://lite-api.jup.ag';
const RPC_ENDPOINTS = [
  process.env.NEXT_PUBLIC_RPC_ENDPOINT_1,
  process.env.NEXT_PUBLIC_RPC_ENDPOINT_2,
].filter(Boolean) as string[]; 

const FALLBACK_RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com'
];

class RateLimiter {
  private lastRequestTime = 0;
  private minInterval = 1100;

  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minInterval) {
      await new Promise(resolve => 
        setTimeout(resolve, this.minInterval - timeSinceLastRequest)
      );
    }
    
    this.lastRequestTime = Date.now();
  }
}

class LoadBalancer {
  private rpcLimiters: Map<string, RateLimiter> = new Map();
  private currentIndex = 0;

  constructor(private endpoints: string[]) {
    if (endpoints.length === 0) {
      this.endpoints = FALLBACK_RPC_ENDPOINTS;
      console.warn('using fallback rpc endpoints. please configure RPC_ENDPOINT environment variables for better performance.');
    }
    
    this.endpoints.forEach(endpoint => {
      this.rpcLimiters.set(endpoint, new RateLimiter());
    });
    
    console.log(`loadbalancer initialized with ${this.endpoints.length} endpoints`);
  }

  async getNextEndpoint(): Promise<{ endpoint: string; limiter: RateLimiter }> {
    const endpoint = this.endpoints[this.currentIndex];
    const limiter = this.rpcLimiters.get(endpoint)!;
    
    this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
    await limiter.wait();
    
    return { endpoint, limiter };
  }

  async executeWithRetry<T>(
    operation: (endpoint: string) => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { endpoint } = await this.getNextEndpoint();
      
      try {
        console.log(`attempt ${attempt + 1} with ${this.getEndpointName(endpoint)}`);
        const result = await operation(endpoint);
        console.log(`success with ${this.getEndpointName(endpoint)}`);
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'unknown error occurred';
        lastError = new Error(errorMessage);
        console.warn(`attempt ${attempt + 1} failed with ${this.getEndpointName(endpoint)}:`, errorMessage);
        
        if (errorMessage.includes('403') || errorMessage.includes('429') || errorMessage.includes('401')) {
          console.log(`skipping ${this.getEndpointName(endpoint)} due to auth/rate limit`);
          continue;
        }
      }
    }
    
    throw new Error(`all rpc endpoints failed after ${maxRetries} attempts. last error: ${lastError?.message}`);
  }

  public getEndpointName(endpoint: string): string {
    if (endpoint.includes('quiknode')) return 'quicknode';
    if (endpoint.includes('helius')) return 'helius';
    if (endpoint.includes('alchemy')) return 'alchemy';
    if (endpoint.includes('serum')) return 'serum';
    if (endpoint.includes('mainnet-beta')) return 'solana mainnet';
    return 'custom rpc';
  }

  getEndpoints(): string[] {
    return this.endpoints;
  }
}

const rpcLoadBalancer = new LoadBalancer(RPC_ENDPOINTS);
const jupiterRateLimiter = new RateLimiter();

interface JupiterQuoteResponse {
  outAmount: string;
  [key: string]: unknown;
}

interface JupiterSwapResponse {
  swapTransaction: string;
  [key: string]: unknown;
}

export class TokenService {
  private tokenMap: Map<string, TokenInfo> = new Map();
  private tokenListLoaded: boolean = false;

  constructor() {
    this.loadTokenList();
    this.createConnection = this.createConnection.bind(this);
    this.getTokenBalances = this.getTokenBalances.bind(this);
  }

  private createConnection(endpoint: string): Connection {
    return new Connection(endpoint, 'confirmed');
  }

  private async loadTokenList(): Promise<void> {
    if (this.tokenListLoaded) return;

    const tokenListSources = [
      'https://cache.jup.ag/tokens',
      'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json',
      'https://cdn.jsdelivr.net/gh/solana-labs/token-list@main/src/tokens/solana.tokenlist.json',
    ];

    for (const source of tokenListSources) {
      try {
        console.log(`loading token list from: ${source}`);
        const response = await fetch(source, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          
          let tokens: TokenInfo[] = [];
          if (Array.isArray(data)) {
            tokens = data;
          } else if (data.tokens && Array.isArray(data.tokens)) {
            tokens = data.tokens;
          } else {
            tokens = data;
          }

          tokens.forEach((token: TokenInfo) => {
            const mintAddress = token.address;
            if (mintAddress) {
              this.tokenMap.set(mintAddress, token);
            }
          });
          
          console.log(`loaded ${tokens.length} tokens from ${source}`);
          this.tokenListLoaded = true;
          return;
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'unknown error';
        console.warn(`failed to load from ${source}:`, errorMessage);
        continue;
      }
    }

    console.warn('using minimal fallback token list');
    this.loadFallbackTokenList();
    this.tokenListLoaded = true;
  }

  private loadFallbackTokenList(): void {
    const fallbackTokens: TokenInfo[] = [
      {
        address: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
        chainId: 101
      },
      {
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
        chainId: 101
      },
      {
        address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        symbol: 'USDT',
        name: 'USDT',
        decimals: 6,
        logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png',
        chainId: 101
      }
    ];

    fallbackTokens.forEach(token => {
      this.tokenMap.set(token.address, token);
    });
  }

  async ensureTokenListLoaded(): Promise<void> {
    if (!this.tokenListLoaded) {
      await this.loadTokenList();
    }
  }

  async getTokenBalances(walletAddress: string): Promise<TokenBalance[]> {
    await this.ensureTokenListLoaded();
    
    console.log('fetching token balances for:', walletAddress);

    return await rpcLoadBalancer.executeWithRetry(async (endpoint) => {
      const connection = this.createConnection(endpoint);
      const publicKey = new PublicKey(walletAddress);
      
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        publicKey,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      console.log(`found ${tokenAccounts.value.length} token accounts`);

      const tokens: TokenBalance[] = [];

      for (const account of tokenAccounts.value) {
        try {
          const accountInfo = account.account.data.parsed.info;
          const mint = accountInfo.mint;
          const tokenAmount = accountInfo.tokenAmount;
          
          if (tokenAmount.uiAmount > 0) {
            const tokenInfo = this.tokenMap.get(mint);
            
            tokens.push({
              mint: mint,
              symbol: tokenInfo?.symbol || 'UNKNOWN',
              name: tokenInfo?.name || 'unknown token',
              balance: Number(tokenAmount.amount),
              decimals: tokenAmount.decimals,
              uiAmount: tokenAmount.uiAmount,
              price: 0,
              value: 0,
              selected: false,
              logoURI: tokenInfo?.logoURI || null
            });
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'unknown error';
          console.warn('error processing token account:', errorMessage);
        }
      }

      console.log(`processed ${tokens.length} tokens with balance`);
      return tokens;
    });
  }

  async getTokenPrices(tokens: TokenBalance[]): Promise<TokenBalance[]> {
  console.log(`fetching prices for ${tokens.length} tokens...`);
  
  const results = await Promise.allSettled(
    tokens.map(async (token) => {
      try {
        // Skip tokens with very small amounts that might cause API errors
        if (token.uiAmount < 0.000001) {
          console.log(`skipping tiny amount for ${token.symbol}: ${token.uiAmount}`);
          return { ...token, value: 0, price: 0 };
        }

        const MIN_AMOUNT = 1090; 
        const amount = Math.max(token.uiAmount, MIN_AMOUNT);

        const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${token.mint}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${amount}`;
        
        console.log(`🔍 Getting quote for ${token.symbol}: ${url}`);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          if (response.status === 400) {
            console.log(`🔍 Skipping untradable token: ${token.symbol}`);
            return { ...token, value: 0, price: 0 };
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const quoteData = await response.json();
        
        if (!quoteData || !quoteData.outAmount) {
          console.log(`🔍 No quote data for ${token.symbol}`);
          return { ...token, value: 0, price: 0 };
        }

        const usdcValue = parseInt(quoteData.outAmount) / 1_000_000; // USDC has 6 decimals
        const price = usdcValue / token.uiAmount;
        const value = usdcValue;

        console.log(`✅ ${token.symbol}: ${token.uiAmount} → $${value} ($${price}/token)`);
        
        return {
          ...token,
          value,
          price,
        };
      } catch (error) {
        console.error(`❌ Failed to get price for ${token.symbol}:`, error);
        return { ...token, value: 0, price: 0 };
      }
    })
  );

  // Fix: Properly handle the type filtering
  const successfulTokens: TokenBalance[] = [];
  
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const token = result.value;
      // Check if value exists and is greater than 0
      if (token.value !== undefined && token.value > 0) {
        successfulTokens.push(token);
      }
    }
  }

  const failedTokens = results.filter(result => result.status === 'rejected');
  
  if (failedTokens.length > 0) {
    console.log(`⚠️ ${failedTokens.length} tokens failed price fetching`);
  }

  console.log(`🎯 Final list: ${successfulTokens.length} tradable tokens with prices`);
  return successfulTokens;
}

  async getSwapQuote(inputMint: string, outputMint: string, amount: number): Promise<JupiterQuoteResponse> {
    await jupiterRateLimiter.wait();
    
    try {
      const response = await fetch(
        `${JUPITER_API}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}`
      );
      
      if (!response.ok) {
        throw new Error(`jupiter api error: ${response.status}`);
      }
      
      return await response.json();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'unknown error';
      console.error('error getting swap quote:', errorMessage);
      throw error;
    }
  }

  getTokenInfo(mintAddress: string): TokenInfo | undefined {
    return this.tokenMap.get(mintAddress);
  }

  async refreshTokenList(): Promise<void> {
    this.tokenListLoaded = false;
    this.tokenMap.clear();
    await this.loadTokenList();
  }

  async testRpcEndpoints(): Promise<{ [key: string]: boolean }> {
    const results: { [key: string]: boolean } = {};
    
    for (const endpoint of rpcLoadBalancer.getEndpoints()) {
      try {
        const connection = this.createConnection(endpoint);
        const version = await connection.getVersion();
        results[rpcLoadBalancer.getEndpointName(endpoint)] = true;
        console.log(`✅ ${rpcLoadBalancer.getEndpointName(endpoint)}: working - version ${version['solana-core']}`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'unknown error';
        results[rpcLoadBalancer.getEndpointName(endpoint)] = false;
        console.error(`❌ ${rpcLoadBalancer.getEndpointName(endpoint)}: failed -`, errorMessage);
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return results;
  }
}
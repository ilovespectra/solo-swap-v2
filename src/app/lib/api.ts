import { Connection, PublicKey } from '@solana/web3.js';
import { TokenBalance, TokenInfo, PriceProgress } from '../types/token';

const HELIUS_RPC_URL = process.env.NEXT_PUBLIC_HELIUS_API_KEY 
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
  : 'https://mainnet.helius-rpc.com/';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

interface ParsedTokenAccountInfo {
  mint: string;
  tokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number;
  };
}

interface ParsedTokenAccount {
  account: {
    data: {
      parsed: {
        info: ParsedTokenAccountInfo;
      };
    };
  };
}

interface HeliusAssetContent {
  metadata?: {
    symbol?: string;
    name?: string;
  };
  links?: {
    image?: string;
  };
  files?: Array<{
    uri?: string;
  }>;
}

interface HeliusAsset {
  id: string;
  content?: HeliusAssetContent;
  token_info?: {
    price_info?: {
      price_per_token?: number;
      total_price?: number;
      price_change_24h?: {
        percentage?: number;
        absolute?: number;
      };

      price_change_percentage_24h?: number;
    };
  };
}

interface JupiterPriceResponse {
  data: {
    [mint: string]: {
      price: number;
      priceChange24h?: number;
      priceChangePercent24h?: number;
    };
  };
}

const RPC_ENDPOINTS = [
  process.env.NEXT_PUBLIC_RPC_ENDPOINT_1,
  process.env.NEXT_PUBLIC_RPC_ENDPOINT_2,
].filter(Boolean) as string[]; 

const FALLBACK_RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com'
];

class LoadBalancer {
  private currentIndex = 0;

  constructor(private endpoints: string[]) {
    if (endpoints.length === 0) {
      this.endpoints = FALLBACK_RPC_ENDPOINTS;
    }
  }

  async getNextEndpoint(): Promise<string> {
    const endpoint = this.endpoints[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
    return endpoint;
  }

  async executeWithRetry<T>(
    operation: (endpoint: string) => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const endpoint = await this.getNextEndpoint();
      
      try {
        const result = await operation(endpoint);
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'unknown error occurred';
        lastError = new Error(errorMessage);
        
        if (errorMessage.includes('403') || errorMessage.includes('429') || errorMessage.includes('401')) {
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

export class TokenService {
  private static instance: TokenService | null = null;
  private tokenMap: Map<string, TokenInfo> = new Map();
  private tokenListLoaded: boolean = false;
  private priceCache: Map<string, { price: number; changePercent24h?: number; timestamp: number }> = new Map();
  private metadataCache: Map<string, { symbol: string; name: string; logoURI: string | null; timestamp: number }> = new Map();
  private readonly PRICE_CACHE_DURATION = 4000;
  private readonly PERFORMANCE_CACHE_DURATION = 300000;
  private readonly METADATA_CACHE_DURATION = 3600000; // metadata rarely changes
  private priceUpdateCallbacks: Map<string, Array<(token: TokenBalance) => void>> = new Map();
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
  private batchUpdateInterval: NodeJS.Timeout | null = null;
  private pendingPriceRequests: Map<string, Promise<{ price: number; changePercent24h?: number } | null>> = new Map();

  private constructor() {
    this.loadTokenList();
  }

  public static getInstance(): TokenService {
    if (!TokenService.instance) {
      TokenService.instance = new TokenService();
    }
    return TokenService.instance;
  }

  private createConnection(endpoint: string): Connection {
    return new Connection(endpoint, 'confirmed');
  }

  private async loadTokenList(): Promise<void> {
    if (this.tokenListLoaded) return;

    try {
      console.log('[TokenService] Loading Jupiter token list...');
      const response = await fetch('https://cache.jup.ag/tokens');
      
      if (response.ok) {
        const tokens = await response.json();
        console.log('[TokenService] Loaded', tokens.length, 'tokens from Jupiter');
        
        tokens.forEach((token: TokenInfo) => {
          if (token.address) {
            this.tokenMap.set(token.address, token);
          }
        });
        
        this.tokenListLoaded = true;
        return;
      } else {
        console.warn('[TokenService] Failed to load token list:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('[TokenService] Error loading token list:', error);
    }

    const fallbackTokens = [
      {
        address: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        name: 'Wrapped Solana',
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

    console.log('[TokenService] Using fallback token list with', fallbackTokens.length, 'tokens');
    fallbackTokens.forEach(token => {
      this.tokenMap.set(token.address, token);
    });
    
    this.tokenListLoaded = true;
  }

  async ensureTokenListLoaded(): Promise<void> {
    if (!this.tokenListLoaded) {
      await this.loadTokenList();
    }
  }

  subscribeToPriceUpdates(mint: string, callback: (token: TokenBalance) => void): () => void {
    if (!this.priceUpdateCallbacks.has(mint)) {
      this.priceUpdateCallbacks.set(mint, []);
    }
    const callbacks = this.priceUpdateCallbacks.get(mint)!;
    if (callbacks.includes(callback)) {
      return () => {};
    }
    callbacks.push(callback);

    if (!this.batchUpdateInterval) {
      console.log('Starting batch price update interval (5s)');
      this.batchUpdateInterval = setInterval(async () => {
        await this.batchUpdatePrices();
      }, 5000);
    }

    return () => {
      const cb = this.priceUpdateCallbacks.get(mint);
      if (cb) {
        const index = cb.indexOf(callback);
        if (index > -1) {
          cb.splice(index, 1);
        }
        if (cb.length === 0) {
          this.priceUpdateCallbacks.delete(mint);
        }
      }

      if (this.priceUpdateCallbacks.size === 0 && this.batchUpdateInterval) {
        console.log('Stopping batch price update interval (no more subscriptions)');
        clearInterval(this.batchUpdateInterval);
        this.batchUpdateInterval = null;
      }
    };
  }

  private async batchUpdatePrices(): Promise<void> {
    const mints = Array.from(this.priceUpdateCallbacks.keys());
    if (mints.length === 0) return;

    try {
      const jupiterIds = mints.join(',');
      const response = await fetch(`https://api.jup.ag/price/v2?ids=${jupiterIds}`);

      if (response.ok) {
        const data: JupiterPriceResponse = await response.json();
        mints.forEach(mint => {
          const tokenData = data.data[mint];
          if (tokenData) {
            this.priceCache.set(mint, {
              price: tokenData.price,
              changePercent24h: tokenData.priceChangePercent24h,
              timestamp: Date.now()
            });

            const callbacks = this.priceUpdateCallbacks.get(mint);
            if (callbacks) {
              const cachedMetadata = this.metadataCache.get(mint);
              const tokenInfo = this.tokenMap.get(mint);

              const priceUpdate: TokenBalance = {
                mint,
                symbol: cachedMetadata?.symbol || tokenInfo?.symbol || 'UNKNOWN',
                name: cachedMetadata?.name || tokenInfo?.name || 'unknown token',
                balance: 0,
                decimals: tokenInfo?.decimals || 9,
                uiAmount: 0,
                price: tokenData.price,
                value: 0,
                selected: false,
                logoURI: cachedMetadata?.logoURI || tokenInfo?.logoURI || null,
                changePercent24h: tokenData.priceChangePercent24h,
                lastUpdated: Date.now()
              };

              callbacks.forEach(cb => cb(priceUpdate));
            }
          }
        });
      }
    } catch (error) {
      console.error('Batch price update failed:', error);
    }
  }

  private async fetchPriceFromDexScreener(mint: string): Promise<{ price: number; changePercent24h?: number } | null> {
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      if (response.ok) {
        const data = await response.json();
        const pair = data.pairs?.[0];
        if (pair) {
          return {
            price: parseFloat(pair.priceUsd) || 0,
            changePercent24h: pair.priceChange?.h24 ? parseFloat(pair.priceChange.h24) : undefined
          };
        }
      }
    } catch (error) {
    }
    return null;
  }

  // Manual refresh only; subscriptions use batch updates
  private async fetchSingleTokenPrice(mint: string): Promise<{ price: number; changePercent24h?: number } | null> {
    const cached = this.priceCache.get(mint);
    const cacheAge = cached ? Date.now() - cached.timestamp : Infinity;

    if (cached && cacheAge < this.PRICE_CACHE_DURATION) {
      return { price: cached.price, changePercent24h: cached.changePercent24h };
    }

    try {
      const jupiterResponse = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
      if (jupiterResponse.ok) {
        const data: JupiterPriceResponse = await jupiterResponse.json();
        const tokenData = data.data[mint];
        if (tokenData) {
          return {
            price: tokenData.price,
            changePercent24h: tokenData.priceChangePercent24h
          };
        }
      }
    } catch (error) {
    }

    return null;
  }

  async getTokenBalances(walletAddress: string): Promise<TokenBalance[]> {
    await this.ensureTokenListLoaded();

    return await rpcLoadBalancer.executeWithRetry(async (endpoint) => {
      const connection = this.createConnection(endpoint);
      const publicKey = new PublicKey(walletAddress);
      try {
        const [tokenAccounts, solBalance] = await Promise.all([
          connection.getParsedTokenAccountsByOwner(
            publicKey,
            { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
          ),
          connection.getBalance(publicKey)
        ]);

        const tokens: TokenBalance[] = [];

        if (solBalance > 0) {
          const solAmount = solBalance / 1e9;
          const solMint = 'So11111111111111111111111111111111111111112';
          const solLogoURI = 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png';
          if (!this.metadataCache.has(solMint)) {
            this.metadataCache.set(solMint, {
              symbol: 'SOL',
              name: 'Solana',
              logoURI: solLogoURI,
              timestamp: Date.now()
            });
          }
          tokens.push({
            mint: solMint,
            symbol: 'SOL',
            name: 'Solana',
            balance: solBalance,
            decimals: 9,
            uiAmount: solAmount,
            price: 0,
            value: 0,
            selected: false,
            logoURI: solLogoURI,
            changePercent24h: null,
            lastUpdated: Date.now()
          });
        }

        const mintAddresses = tokenAccounts.value
          .map((account: ParsedTokenAccount) => {
            try {
              const accountInfo = account.account.data.parsed.info;
              const tokenAmount = accountInfo.tokenAmount;
              if (tokenAmount.uiAmount > 0) {
                return accountInfo.mint;
              }
            } catch (error) {
              console.warn('error processing token account:', error);
            }
            return null;
          })
          .filter((mint: string | null): mint is string => mint !== null);

        const tokenMetadataMap = await this.fetchTokenMetadataBatch(mintAddresses);

        for (const account of tokenAccounts.value as ParsedTokenAccount[]) {
          try {
            const accountInfo = account.account.data.parsed.info;
            const mint = accountInfo.mint;
            const tokenAmount = accountInfo.tokenAmount;

            if (tokenAmount.uiAmount > 0) {
              const heliusMetadata = tokenMetadataMap.get(mint);
              const tokenInfo = this.tokenMap.get(mint);

              const symbol = heliusMetadata?.symbol || tokenInfo?.symbol || 'UNKNOWN';
              const name = heliusMetadata?.name || tokenInfo?.name || 'Unknown Token';
              const logoURI = heliusMetadata?.logoURI || tokenInfo?.logoURI || null;

              if (!this.metadataCache.has(mint)) {
                this.metadataCache.set(mint, {
                  symbol,
                  name,
                  logoURI,
                  timestamp: Date.now()
                });
              }

              tokens.push({
                mint,
                symbol,
                name,
                balance: Number(tokenAmount.amount),
                decimals: tokenAmount.decimals,
                uiAmount: tokenAmount.uiAmount,
                price: 0,
                value: 0,
                selected: false,
                logoURI,
                changePercent24h: null,
                lastUpdated: Date.now()
              });
            }
          } catch (error) {
          }
        }
        return tokens;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[TokenService] Error in getTokenBalances:', msg, error);
        throw error;
      }
    });
  }

  private async fetchTokenMetadataBatch(mintAddresses: string[]): Promise<Map<string, { symbol: string; name: string; logoURI: string | null }>> {
    const metadataMap = new Map<string, { symbol: string; name: string; logoURI: string | null }>();
    
    if (mintAddresses.length === 0) return metadataMap;

    console.log('[TokenService] Fetching metadata for', mintAddresses.length, 'tokens');
    const now = Date.now();
    const mintsToFetch: string[] = [];

    mintAddresses.forEach(mint => {
      const cached = this.metadataCache.get(mint);
      if (cached && (now - cached.timestamp) < this.METADATA_CACHE_DURATION) {
        metadataMap.set(mint, {
          symbol: cached.symbol,
          name: cached.name,
          logoURI: cached.logoURI
        });
      } else {
        mintsToFetch.push(mint);
      }
    });

    console.log('[TokenService] Cache hit for', metadataMap.size, 'tokens, need to fetch', mintsToFetch.length);

    mintsToFetch.forEach(mint => {
      const tokenInfo = this.tokenMap.get(mint);
      if (tokenInfo) {
        const metadata = {
          symbol: tokenInfo.symbol,
          name: tokenInfo.name,
          logoURI: tokenInfo.logoURI || null
        };
        metadataMap.set(mint, metadata);
        this.metadataCache.set(mint, { ...metadata, timestamp: Date.now() });
      }
    });

    console.log('[TokenService] Got', metadataMap.size, 'from Jupiter token list');

    const stillNeedFetch = mintsToFetch.filter(mint => !metadataMap.has(mint));
    console.log('[TokenService] Still need to fetch from Helius:', stillNeedFetch.length);
    if (stillNeedFetch.length === 0) return metadataMap;

    try {
      console.log('[TokenService] Calling Helius for', stillNeedFetch.length, 'tokens');
      const response = await fetch(HELIUS_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'getAssetBatch',
          params: {
            ids: stillNeedFetch
          }
        })
      });

      if (response.ok) {
        const data: { result?: HeliusAsset[] } = await response.json();
        console.log('[TokenService] Helius returned', data.result?.length || 0, 'assets');
        if (Array.isArray(data.result)) {
          data.result.forEach(asset => {
            if (asset && asset.id) {
              const symbol = asset.content?.metadata?.symbol || asset.content?.metadata?.name?.split(' ')[0] || 'UNKNOWN';
              const name = asset.content?.metadata?.name || 'Unknown Token';
              let logoURI = asset.content?.links?.image || asset.content?.files?.[0]?.uri || null;

              if (!logoURI) {
                const tokenInfo = this.tokenMap.get(asset.id);
                logoURI = tokenInfo?.logoURI || null;
              }

              const metadata = { symbol, name, logoURI };
              metadataMap.set(asset.id, metadata);
              this.metadataCache.set(asset.id, { ...metadata, timestamp: Date.now() });
            }
          });
        }
      } else {
        console.warn('[TokenService] Helius returned status', response.status, response.statusText);
      }
    } catch (error) {
      console.error('[TokenService] Error calling Helius:', error instanceof Error ? error.message : String(error));
    }

    console.log('[TokenService] Final metadata map has', metadataMap.size, 'entries');
    return metadataMap;
  }

  async getTokenPrices(
    tokens: TokenBalance[], 
    onProgress?: (progress: PriceProgress) => void
  ): Promise<TokenBalance[]> {
    
    if (tokens.length === 0) {
      return [];
    }

    const now = Date.now();
    const cachedResults: TokenBalance[] = [];
    const tokensToFetch: TokenBalance[] = [];

    for (const token of tokens) {
      const cached = this.priceCache.get(token.mint);
      if (cached && (now - cached.timestamp) < this.PRICE_CACHE_DURATION) {
        const value = cached.price * token.uiAmount;
        cachedResults.push({
          ...token,
          price: cached.price,
          value,
          changePercent24h: cached.changePercent24h,
          lastUpdated: now
        });
      } else {
        tokensToFetch.push(token);
      }
    }
    try {
      const mintAddresses = tokensToFetch.map(t => t.mint);

      await new Promise(resolve => setTimeout(resolve, 500));

      const jupiterIds = mintAddresses.join(',');
      const priceMap = new Map<string, { price: number; changePercent24h?: number }>();
      const jupiterResponse = await fetch(`https://api.jup.ag/price/v2?ids=${jupiterIds}`);
      if (jupiterResponse.ok) {
        const data: JupiterPriceResponse = await jupiterResponse.json();
        mintAddresses.forEach(mint => {
          const tokenData = data.data[mint];
          if (tokenData) {
            priceMap.set(mint, {
              price: tokenData.price,
              changePercent24h: tokenData.priceChangePercent24h
            });
          }
        });
      } else {
        console.error(`[TokenService] Jupiter API error: ${jupiterResponse.status} ${jupiterResponse.statusText}`);
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      const missingMints = mintAddresses.filter(mint => !priceMap.has(mint));
      if (missingMints.length > 0) {
        const heliusResponse = await fetch(HELIUS_RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            method: 'getAssetBatch',
            params: {
              ids: missingMints
            }
          })
        });

        if (heliusResponse.ok) {
          const data: { result?: HeliusAsset[] } = await heliusResponse.json();
          if (Array.isArray(data.result)) {
            data.result.forEach(asset => {
              if (asset && asset.id) {
                const priceInfo = asset.token_info?.price_info;
                let changePercent24h: number | undefined;
                if (priceInfo?.price_change_24h?.percentage !== undefined) {
                  changePercent24h = priceInfo.price_change_24h.percentage;
                } else if (priceInfo?.price_change_percentage_24h !== undefined) {
                  changePercent24h = priceInfo.price_change_percentage_24h;
                }
                priceMap.set(asset.id, {
                  price: priceInfo?.price_per_token || 0,
                  changePercent24h
                });
              }
            });
          }
        }
      }

      tokensToFetch.forEach(token => {
        if (token.mint === USDC_MINT && !priceMap.has(token.mint)) {
          priceMap.set(token.mint, { price: 1, changePercent24h: 0 });
        }
      });

      const heliusMetadata = await this.fetchTokenMetadataBatch(mintAddresses);

      const fetchedResults = tokensToFetch.map(token => {
        const priceData = priceMap.get(token.mint) || { price: 0 };
        const price = priceData.price;
        const value = price * token.uiAmount;
        const metadata = heliusMetadata.get(token.mint);

        if (price > 0) {
          this.priceCache.set(token.mint, {
            price,
            changePercent24h: priceData.changePercent24h,
            timestamp: now
          });
        }

        if (onProgress) {
          onProgress({
            current: cachedResults.length + priceMap.size,
            total: tokens.length,
            currentToken: token.symbol
          });
        }

        return {
          ...token,
          symbol: metadata?.symbol || token.symbol,
          name: metadata?.name || token.name,
          logoURI: metadata?.logoURI || token.logoURI,
          price,
          value,
          changePercent24h: priceData.changePercent24h || null,
          lastUpdated: now
        };
      });

      const allResults = [...cachedResults, ...fetchedResults];

      if (onProgress) {
        onProgress({
          current: tokens.length,
          total: tokens.length,
          currentToken: 'complete'
        });
      }

      return allResults;
    } catch (error) {
      console.error('[TokenService] Error in getTokenPrices:', error instanceof Error ? error.message : String(error));
      return tokens.map(token => ({
        ...token,
        price: 0,
        value: 0,
        changePercent24h: null,
        lastUpdated: Date.now()
      }));
    }
            result.name = name;
            result.logoURI = logoURI;
          }
        }

        if (onProgress) {
          onProgress({
            current: tokens.length,
            total: tokens.length,
            currentToken: 'complete'
          });
        }
        
        return allResults;
      } else {
        throw new Error('Invalid response from Helius API');
      }
    } catch (error) {
      console.error('failed to fetch prices from Helius:', error);
      return tokens.map(token => ({
        ...token,
        price: 0,
        value: 0
      }));
    }
  }

  async retryFailedTokens(
    failedTokens: TokenBalance[], 
    onProgress?: (progress: PriceProgress) => void
  ): Promise<TokenBalance[]> {
    if (failedTokens.length === 0) {
      return [];
    }
    return await this.getTokenPrices(failedTokens, onProgress);
  }

  getTokenInfo(mintAddress: string): TokenInfo | undefined {
    return this.tokenMap.get(mintAddress);
  }

  destroy(): void {
    this.updateIntervals.forEach(interval => clearInterval(interval));
    this.updateIntervals.clear();
    this.priceUpdateCallbacks.clear();
  }
}
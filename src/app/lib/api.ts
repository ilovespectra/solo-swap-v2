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
  private readonly PRICE_CACHE_DURATION = 3000; // 3 seconds cache for prices (less than 4s update interval to ensure fresh data)
  private readonly PERFORMANCE_CACHE_DURATION = 300000; // 5 minutes cache for performance data
  private priceUpdateCallbacks: Map<string, Array<(token: TokenBalance) => void>> = new Map();
  // private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
  private batchUpdateInterval: NodeJS.Timeout | null = null;
  // private pendingPriceRequests: Map<string, Promise<{ price: number; changePercent24h?: number } | null>> = new Map();

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
      const response = await fetch('https://cache.jup.ag/tokens');
      
      if (response.ok) {
        const tokens = await response.json();
        
        tokens.forEach((token: TokenInfo) => {
          if (token.address) {
            this.tokenMap.set(token.address, token);
          }
        });
        
        this.tokenListLoaded = true;
        return;
      }
    } catch (error) {
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
      console.log('[TokenService] Starting batch price update interval (5s) - FIRST subscriber');
      this.batchUpdateInterval = setInterval(async () => {
        await this.batchUpdatePrices();
      }, 5000);
    }


    return () => {
      const callbacks = this.priceUpdateCallbacks.get(mint);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
        

        if (callbacks.length === 0) {
          this.priceUpdateCallbacks.delete(mint);
        }
      }


      if (this.priceUpdateCallbacks.size === 0 && this.batchUpdateInterval) {
        console.log('[TokenService] Stopping batch price update interval - LAST subscriber unsubscribed');
        clearInterval(this.batchUpdateInterval);
        this.batchUpdateInterval = null;
      }
    };
  }


 private async batchUpdatePrices(): Promise<void> {
  const mints = Array.from(this.priceUpdateCallbacks.keys());
  if (mints.length === 0) return;

  console.log(`[TokenService] Batch updating ${mints.length} token prices (single Helius call)`);

  try {
    // SINGLE call to Helius - gets ALL prices at once
    const response = await fetch(HELIUS_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'getAssetBatch',
        params: {
          ids: mints
        }
      })
    });

    if (!response.ok) {
      console.error(`Helius batch price fetch failed: ${response.status}`);
      return;
    }

    const data: { result?: HeliusAsset[] } = await response.json();
    
    if (!Array.isArray(data.result)) {
      console.error('Invalid Helius response');
      return;
    }

    // Process all prices and emit callbacks
    data.result.forEach((asset) => {
      if (!asset || !asset.id) return;

      const priceInfo = asset.token_info?.price_info;
      const price = priceInfo?.price_per_token || 0;
      let changePercent24h: number | undefined;
      
      if (priceInfo?.price_change_24h?.percentage !== undefined) {
        changePercent24h = priceInfo.price_change_24h.percentage;
      } else if (priceInfo?.price_change_percentage_24h !== undefined) {
        changePercent24h = priceInfo.price_change_percentage_24h;
      }

      // Update cache
      this.priceCache.set(asset.id, {
        price,
        changePercent24h,
        timestamp: Date.now()
      });

      // Emit callbacks for this mint
      const callbacks = this.priceUpdateCallbacks.get(asset.id);
      if (callbacks && price > 0) {
        const tokenInfo = this.tokenMap.get(asset.id);
        const priceUpdate: TokenBalance = {
          mint: asset.id,
          symbol: tokenInfo?.symbol || 'UNKNOWN',
          name: tokenInfo?.name || '',
          balance: 0,
          decimals: tokenInfo?.decimals || 0,
          uiAmount: 0,
          price,
          value: 0,
          selected: false,
          logoURI: tokenInfo?.logoURI || null,
          changePercent24h,
          lastUpdated: Date.now()
        };
        callbacks.forEach(cb => cb(priceUpdate));
      }
    });
  } catch (error) {
    console.error('batchUpdatePrices error:', error);
  }
}


  // private async updateSingleTokenPrice(mint: string): Promise<void> {
  //   try {
  //     const priceData = await this.fetchSingleTokenPrice(mint);
  //     if (priceData) {

  //       this.priceCache.set(mint, {
  //         price: priceData.price,
  //         changePercent24h: priceData.changePercent24h,
  //         timestamp: Date.now()
  //       });


  //       const callbacks = this.priceUpdateCallbacks.get(mint);
  //       if (callbacks) {
  //         const tokenInfo = this.tokenMap.get(mint);
  //         const priceUpdate: TokenBalance = {
  //           mint,
  //           symbol: tokenInfo?.symbol || 'UNKNOWN',
  //           name: tokenInfo?.name || 'unknown token',
  //           balance: 0,
  //           decimals: tokenInfo?.decimals || 9,
  //           uiAmount: 0,
  //           price: priceData.price,
  //           value: 0,
  //           selected: false,
  //           logoURI: tokenInfo?.logoURI || null,
  //           changePercent24h: priceData.changePercent24h,
  //           lastUpdated: Date.now()
  //         };

  //         callbacks.forEach(callback => callback(priceUpdate));
  //       }
  //     }
  //   } catch (error) {
  //   }
  // }

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

  //   private async fetchSingleTokenPrice(mint: string): Promise<{ price: number; changePercent24h?: number } | null> {

  //   const cached = this.priceCache.get(mint);
  //   const cacheAge = cached ? Date.now() - cached.timestamp : Infinity;
    
  //   if (cached && cacheAge < this.PRICE_CACHE_DURATION) {
  //     console.log(`⚡ using cached price for ${this.tokenMap.get(mint)?.symbol || mint} (${(cacheAge / 1000).toFixed(1)}s old): $${cached.price}`);
  //     return { price: cached.price, changePercent24h: cached.changePercent24h };
  //   }


  //   if (this.pendingPriceRequests.has(mint)) {
  //     return this.pendingPriceRequests.get(mint)!;
  //   }


  //   const request = (async () => {
  //     try {
  //       console.log(`🌐 fetching fresh price for ${this.tokenMap.get(mint)?.symbol || mint} from jupiter...`);
  //       const jupiterResponse = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
  //       if (jupiterResponse.ok) {
  //         const data: JupiterPriceResponse = await jupiterResponse.json();
  //         const tokenData = data.data[mint];
  //         if (tokenData) {
  //           console.log(`✅ jupiter price for ${this.tokenMap.get(mint)?.symbol || mint}: $${tokenData.price}`);
  //           return {
  //             price: tokenData.price,
  //             changePercent24h: tokenData.priceChangePercent24h
  //           };
  //         }
  //       }
  //     } catch (error) {
  //     }


  //     try {
  //       const response = await fetch(HELIUS_RPC_URL, {
  //         method: 'POST',
  //         headers: { 'Content-Type': 'application/json' },
  //         body: JSON.stringify({
  //           jsonrpc: '2.0',
  //           id: '1',
  //           method: 'getAsset',
  //           params: {
  //             id: mint
  //           }
  //         })
  //       });

  //       if (response.ok) {
  //         const data: { result?: HeliusAsset } = await response.json();
  //         const asset = data.result;
          
  //         if (asset?.token_info?.price_info) {
  //           const priceInfo = asset.token_info.price_info;
  //           let changePercent24h: number | undefined;
            
  //           if (priceInfo.price_change_24h?.percentage !== undefined) {
  //             changePercent24h = priceInfo.price_change_24h.percentage;
  //           } else if (priceInfo.price_change_percentage_24h !== undefined) {
  //             changePercent24h = priceInfo.price_change_percentage_24h;
  //           }

  //           console.log(`Helius data for ${mint}:`, {
  //             price: priceInfo.price_per_token,
  //             change24h: changePercent24h
  //           });

  //           return {
  //             price: priceInfo.price_per_token || 0,
  //             changePercent24h
  //           };
  //         }
  //       }
  //     } catch (error) {
  //     }


  //     const dexscreenerData = await this.fetchPriceFromDexScreener(mint);
  //     if (dexscreenerData) {
  //       return dexscreenerData;
  //     }


  //     if (mint === USDC_MINT) {
  //       return { price: 1, changePercent24h: 0 };
  //     }

  //     return null;
  //   })();


  //   this.pendingPriceRequests.set(mint, request);

  //   try {
  //     const result = await request;
  //     return result;
  //   } finally {

  //     this.pendingPriceRequests.delete(mint);
  //   }
  // }

  async getTokenBalances(walletAddress: string): Promise<TokenBalance[]> {
    await this.ensureTokenListLoaded();

    return await rpcLoadBalancer.executeWithRetry(async (endpoint) => {
      const connection = this.createConnection(endpoint);
      const publicKey = new PublicKey(walletAddress);
      
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
        tokens.push({
            mint: 'So11111111111111111111111111111111111111112',
            symbol: 'SOL',
            name: 'Solana',
            balance: solBalance,
            decimals: 9,
            uiAmount: solAmount,
            price: 0,
            value: 0,
            selected: false,
            logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
            changePercent24h: null,
            lastUpdated: Date.now()
        });
      }

      // const mintAddresses = tokenAccounts.value
      //   .map((account: ParsedTokenAccount) => {
      //     try {
      //       const accountInfo = account.account.data.parsed.info;
      //       const tokenAmount = accountInfo.tokenAmount;
      //       if (tokenAmount.uiAmount > 0) {
      //         return accountInfo.mint;
      //       }
      //     } catch (error) {
      //     }
      //     return null;
      //   })
      //   .filter((mint: string | null): mint is string => mint !== null);

      // const tokenMetadataMap = await this.fetchTokenMetadataBatch(mintAddresses);

      for (const account of tokenAccounts.value as ParsedTokenAccount[]) {
      try {
        const accountInfo = account.account.data.parsed.info;
        const mint = accountInfo.mint;
        const tokenAmount = accountInfo.tokenAmount;
        
        if (tokenAmount.uiAmount > 0) {
          const tokenInfo = this.tokenMap.get(mint);  // ONLY use tokenMap now
          
          tokens.push({
            mint: mint,
            symbol: tokenInfo?.symbol || 'UNKNOWN',
            name: tokenInfo?.name || 'Unknown Token',
            balance: Number(tokenAmount.amount),
            decimals: tokenAmount.decimals,
            uiAmount: tokenAmount.uiAmount,
            price: 0,
            value: 0,
            selected: false,
            logoURI: tokenInfo?.logoURI || null,
            changePercent24h: null,
            lastUpdated: Date.now()
          });
        }
      } catch (error) {
      }
    }
    return tokens;
  });
}

  // private async fetchTokenMetadataBatch(mintAddresses: string[]): Promise<Map<string, { symbol: string; name: string; logoURI: string | null }>> {
  //   const metadataMap = new Map<string, { symbol: string; name: string; logoURI: string | null }>();
    
  //   if (mintAddresses.length === 0) return metadataMap;

  //   try {
  //     const response = await fetch(HELIUS_RPC_URL, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({
  //         jsonrpc: '2.0',
  //         id: '1',
  //         method: 'getAssetBatch',
  //         params: {
  //           ids: mintAddresses
  //         }
  //       })
  //     });

  //     if (response.ok) {
  //       const data: { result?: HeliusAsset[] } = await response.json();
  //       if (Array.isArray(data.result)) {
  //         data.result.forEach((asset) => {
  //           if (asset && asset.id) {
  //             const symbol = asset.content?.metadata?.symbol || asset.content?.metadata?.name?.split(' ')[0] || 'UNKNOWN';
  //             const name = asset.content?.metadata?.name || 'Unknown Token';
  //             const logoURI = asset.content?.links?.image || asset.content?.files?.[0]?.uri || null;
              
  //             metadataMap.set(asset.id, { symbol, name, logoURI });
  //           }
  //         });
  //       }
  //     }
  //   } catch (error) {
  //   }

  //   return metadataMap;
  // }

  async getTokenPrices(
  tokens: TokenBalance[], 
  onProgress?: (progress: PriceProgress) => void
): Promise<TokenBalance[]> {
  
  if (tokens.length === 0) {
    return [];
  }

  const now = Date.now();
  const mintAddresses = tokens.map(t => t.mint);

  try {
    // SINGLE Helius call for ALL prices at once
    const heliusResponse = await fetch(HELIUS_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'getAssetBatch',
        params: {
          ids: mintAddresses
        }
      })
    });

    if (!heliusResponse.ok) {
      console.error(`Helius price fetch failed: ${heliusResponse.status}`);
      return tokens.map(token => ({
        ...token,
        price: 0,
        value: 0,
        changePercent24h: null,
        lastUpdated: now
      }));
    }

    const data: { result?: HeliusAsset[] } = await heliusResponse.json();
    const priceMap = new Map<string, { price: number; changePercent24h?: number }>();

    if (Array.isArray(data.result)) {
      data.result.forEach((asset) => {
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

    // Hardcode USDC if missing
    if (!priceMap.has(USDC_MINT)) {
      priceMap.set(USDC_MINT, { price: 1, changePercent24h: 0 });
    }

    // Map prices back to tokens
    const resultsWithPrices = tokens.map(token => {
      const priceData = priceMap.get(token.mint) || { price: 0 };
      const price = priceData.price;
      const value = price * token.uiAmount;

      if (price > 0) {
        this.priceCache.set(token.mint, {
          price,
          changePercent24h: priceData.changePercent24h,
          timestamp: now
        });
      }

      if (onProgress) {
        onProgress({
          current: priceMap.size,
          total: tokens.length,
          currentToken: token.symbol
        });
      }

      return {
        ...token,
        price,
        value,
        changePercent24h: priceData.changePercent24h || null,
        lastUpdated: now
      };
    });

    if (onProgress) {
      onProgress({
        current: tokens.length,
        total: tokens.length,
        currentToken: 'complete'
      });
    }

    return resultsWithPrices;
  } catch (error) {
    console.error('getTokenPrices error:', error);
    return tokens.map(token => ({
      ...token,
      price: 0,
      value: 0,
      changePercent24h: null,
      lastUpdated: Date.now()
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
    // this.updateIntervals.forEach(interval => clearInterval(interval));
    // this.updateIntervals.clear();
    this.priceUpdateCallbacks.clear();
  }
}
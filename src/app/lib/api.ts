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



export class TokenService {
  private static instance: TokenService | null = null;
  private tokenMap: Map<string, TokenInfo> = new Map();
  private tokenListLoaded: boolean = false;
  private priceCache: Map<string, { price: number; changePercent24h?: number; timestamp: number }> = new Map();
  private readonly PRICE_CACHE_DURATION = 30000;
  private readonly PERFORMANCE_CACHE_DURATION = 300000;
  private priceUpdateCallbacks: Map<string, Array<(token: TokenBalance) => void>> = new Map();
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
  private batchUpdateInterval: NodeJS.Timeout | null = null;
  private animationInterval: NodeJS.Timeout | null = null;
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

  private createConnection(): Connection {
    return new Connection(HELIUS_RPC_URL, 'confirmed');
  }

  public getConnection(): Connection {
    return this.createConnection();
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

      this.batchUpdatePrices();
      
      this.batchUpdateInterval = setInterval(async () => {
        await this.batchUpdatePrices();
      }, 60000);
      
      const scheduleNextAnimation = () => {
        const delay = 5000 + Math.random() * 5000;
        this.animationInterval = setTimeout(() => {
          this.triggerVisualRefresh();
          scheduleNextAnimation();
        }, delay);
      };
      scheduleNextAnimation();
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

      if (this.priceUpdateCallbacks.size === 0) {
        if (this.batchUpdateInterval) {
          clearInterval(this.batchUpdateInterval);
          this.batchUpdateInterval = null;
        }
        if (this.animationInterval) {
          clearTimeout(this.animationInterval);
          this.animationInterval = null;
        }
      }
    };
  }

  private triggerVisualRefresh(): void {
    const mints = Array.from(this.priceUpdateCallbacks.keys());
    
    mints.forEach(mint => {
      const cached = this.priceCache.get(mint);
      const callbacks = this.priceUpdateCallbacks.get(mint);
      
      if (cached && callbacks && callbacks.length > 0) {
        const tokenInfo = this.tokenMap.get(mint);
        const updatedToken: TokenBalance = {
          mint,
          symbol: tokenInfo?.symbol || 'UNKNOWN',
          name: tokenInfo?.name || 'Unknown Token',
          balance: 0,
          decimals: tokenInfo?.decimals || 9,
          uiAmount: 0,
          price: cached.price,
          value: 0,
          selected: false,
          logoURI: tokenInfo?.logoURI || null,
          changePercent24h: cached.changePercent24h,
          lastUpdated: Date.now()
        };
        
        callbacks.forEach(callback => callback(updatedToken));
      }
    });
  }

  private async batchUpdatePrices(): Promise<void> {
    const mints = Array.from(this.priceUpdateCallbacks.keys());
    if (mints.length === 0) return;
    
    try {
      const priceMap = await this.fetchPricesBatch(mints);
      const now = Date.now();
      
      mints.forEach(mint => {
        const priceData = priceMap.get(mint);
        if (priceData && priceData.price > 0) {
          const cached = this.priceCache.get(mint);
          const priceChanged = !cached || cached.price !== priceData.price;
          
          this.priceCache.set(mint, {
            price: priceData.price,
            changePercent24h: priceData.changePercent24h,
            timestamp: now
          });
          
          if (priceChanged) {
            const callbacks = this.priceUpdateCallbacks.get(mint);
            if (callbacks && callbacks.length > 0) {
              const tokenInfo = this.tokenMap.get(mint);
              const updatedToken: TokenBalance = {
                mint,
                symbol: tokenInfo?.symbol || 'UNKNOWN',
                name: tokenInfo?.name || 'Unknown Token',
                balance: 0,
                decimals: tokenInfo?.decimals || 9,
                uiAmount: 0,
                price: priceData.price,
                value: 0,
                selected: false,
                logoURI: tokenInfo?.logoURI || null,
                changePercent24h: priceData.changePercent24h,
                lastUpdated: now
              };
              
              callbacks.forEach(callback => callback(updatedToken));
            }
          }
        }
      });
    } catch (error) {
      console.error('Price update failed:', error);
    }
  }

  private async fetchPricesBatch(mints: string[]): Promise<Map<string, { price: number; changePercent24h?: number }>> {
    const priceMap = new Map<string, { price: number; changePercent24h?: number }>();
    
    if (mints.length === 0) return priceMap;

    try {
      const jupiterIds = mints.join(',');
      const jupiterResponse = await fetch(`https://api.jup.ag/price/v2?ids=${jupiterIds}`);
      
      if (jupiterResponse.ok) {
        const data: JupiterPriceResponse = await jupiterResponse.json();
        
        mints.forEach(mint => {
          const tokenData = data.data[mint];
          if (tokenData) {
            priceMap.set(mint, {
              price: tokenData.price,
              changePercent24h: tokenData.priceChangePercent24h
            });
          }
        });
      }

      const missingMints = mints.filter(mint => !priceMap.has(mint));
      
      if (missingMints.length > 0) {
        const heliusResponse = await fetch(HELIUS_RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            method: 'getAssetBatch',
            params: { ids: missingMints }
          })
        });

        if (heliusResponse.ok) {
          const data: { result?: HeliusAsset[] } = await heliusResponse.json();
          if (Array.isArray(data.result)) {
            data.result.forEach((asset) => {
              if (asset && asset.id && asset.token_info?.price_info) {
                const priceInfo = asset.token_info.price_info;
                const price = priceInfo.price_per_token || 0;
                const changePercent = priceInfo.price_change_24h?.percentage || 
                                     priceInfo.price_change_percentage_24h;
                
                if (price > 0) {
                  priceMap.set(asset.id, {
                    price,
                    changePercent24h: changePercent
                  });
                }
              }
            });
          }
        }
      }

      if (mints.includes(USDC_MINT) && !priceMap.has(USDC_MINT)) {
        priceMap.set(USDC_MINT, { price: 1, changePercent24h: 0 });
      }

    } catch {
    }

    return priceMap;
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

    private async fetchSingleTokenPrice(mint: string): Promise<{ price: number; changePercent24h?: number } | null> {

    const cached = this.priceCache.get(mint);
    if (cached && Date.now() - cached.timestamp < this.PRICE_CACHE_DURATION) {
      return { price: cached.price, changePercent24h: cached.changePercent24h };
    }

    if (this.pendingPriceRequests.has(mint)) {
      return this.pendingPriceRequests.get(mint)!;
    }

    const request = (async () => {
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

      try {
        const response = await fetch(HELIUS_RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            method: 'getAsset',
            params: {
              id: mint
            }
          })
        });

        if (response.ok) {
          const data: { result?: HeliusAsset } = await response.json();
          const asset = data.result;
          
          if (asset?.token_info?.price_info) {
            const priceInfo = asset.token_info.price_info;
            let changePercent24h: number | undefined;
            
            if (priceInfo.price_change_24h?.percentage !== undefined) {
              changePercent24h = priceInfo.price_change_24h.percentage;
            } else if (priceInfo.price_change_percentage_24h !== undefined) {
              changePercent24h = priceInfo.price_change_percentage_24h;
            }

            return {
              price: priceInfo.price_per_token || 0,
              changePercent24h
            };
          }
        }
      } catch (error) {

      }

      const dexscreenerData = await this.fetchPriceFromDexScreener(mint);
      if (dexscreenerData) {
        return dexscreenerData;
      }

      if (mint === USDC_MINT) {
        return { price: 1, changePercent24h: 0 };
      }

      return null;
    })();

    this.pendingPriceRequests.set(mint, request);

    try {
      const result = await request;
      return result;
    } finally {
      this.pendingPriceRequests.delete(mint);
    }
  }

  async getTokenBalances(walletAddress: string): Promise<TokenBalance[]> {
    await this.ensureTokenListLoaded();

    const connection = this.createConnection();
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

    const mintAddresses = tokenAccounts.value
      .map((account: ParsedTokenAccount) => {
        try {
          const accountInfo = account.account.data.parsed.info;
          const tokenAmount = accountInfo.tokenAmount;
            if (tokenAmount.uiAmount > 0) {
              return accountInfo.mint;
            }
          } catch (error) {

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
            
            tokens.push({
                mint: mint,
                symbol: heliusMetadata?.symbol || tokenInfo?.symbol || 'UNKNOWN',
                name: heliusMetadata?.name || tokenInfo?.name || 'Unknown Token',
                balance: Number(tokenAmount.amount),
                decimals: tokenAmount.decimals,
                uiAmount: tokenAmount.uiAmount,
                price: 0,
                value: 0,
                selected: false,
                logoURI: heliusMetadata?.logoURI || tokenInfo?.logoURI || null,
                changePercent24h: null,
                lastUpdated: Date.now()
            });
          }
        } catch (error) {

        }
      }
    return tokens;
  }

  private async fetchTokenMetadataBatch(mintAddresses: string[]): Promise<Map<string, { symbol: string; name: string; logoURI: string | null }>> {
    const metadataMap = new Map<string, { symbol: string; name: string; logoURI: string | null }>();
    
    if (mintAddresses.length === 0) return metadataMap;

    try {
      const response = await fetch(HELIUS_RPC_URL, {
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

      if (response.ok) {
        const data: { result?: HeliusAsset[] } = await response.json();
        if (Array.isArray(data.result)) {
          data.result.forEach((asset) => {
            if (asset && asset.id) {
              const symbol = asset.content?.metadata?.symbol || asset.content?.metadata?.name?.split(' ')[0] || 'UNKNOWN';
              const name = asset.content?.metadata?.name || 'Unknown Token';
              const logoURI = asset.content?.links?.image || asset.content?.files?.[0]?.uri || null;
              
              metadataMap.set(asset.id, { symbol, name, logoURI });
            }
          });
        }
      }
    } catch (error) {

    }

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

    if (tokensToFetch.length === 0) {
      if (onProgress) {
        onProgress({
          current: tokens.length,
          total: tokens.length,
          currentToken: 'complete'
        });
      }
      return cachedResults;
    }

    try {
      const mintAddresses = tokensToFetch.map(t => t.mint);
      const jupiterIds = mintAddresses.join(',');
      
      const jupiterResponse = await fetch(`https://api.jup.ag/price/v2?ids=${jupiterIds}`);
      
      const priceMap = new Map<string, { price: number; changePercent24h?: number }>();
      
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
      }

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
        }
      }

      tokensToFetch.forEach(token => {
        if (token.mint === USDC_MINT && !priceMap.has(token.mint)) {
          priceMap.set(token.mint, { price: 1, changePercent24h: 0 });
        }
      });

      const fetchedResults = tokensToFetch.map(token => {
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
            current: cachedResults.length + priceMap.size,
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
      console.error('failed to fetch prices:', error);
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
    this.updateIntervals.forEach(interval => clearInterval(interval));
    this.updateIntervals.clear();
    this.priceUpdateCallbacks.clear();
  }
}
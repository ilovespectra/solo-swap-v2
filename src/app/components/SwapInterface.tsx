'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction, SystemProgram, TransactionMessage, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TokenBalance } from '../types/token';
import { TokenService } from '../lib/api';
import { SwapBatchRecord, SwapTokenInput } from '../types/history';
import { encryptionService } from '../lib/encryption';
import { triggerSwapHistoryRefresh } from './SwapHistoryPanel';
import bs58 from 'bs58';
import { Calculator, AlertCircle, ExternalLink, RefreshCw, DollarSign, ShoppingCart, Shield, ChevronDown, Search, X, Copy, Info } from 'lucide-react';

interface SwapInterfaceProps {
  selectedTokens: TokenBalance[];
  totalSelectedValue: number;
  allTokens: TokenBalance[];
  onSwapComplete: () => void;
  onOutputTokenChange?: (mint: string) => void;
}

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const HISTORY_ENABLED = process.env.NEXT_PUBLIC_ENABLE_HISTORY === 'true';

const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'
];

interface SwapResult {
  symbol: string;
  mint: string;
  decimals: number;
  signature?: string;
  amount: number;
  error?: string;
  inputAmount: number;
  outputAmount?: number;
  retryCount?: number;
  priceUsd?: number;
  outputUsd?: number;
  quoteImprovementPct?: number;
}

interface ProRataToken extends TokenBalance {
  swapAmount: number;
  percentage: number;
  liquidationAmount: number;
  originalAmount: number;
}

interface JupiterQuoteResponse {
  outAmount: string;
  priceImpactPct?: string;
  routePlan?: unknown[];
  [key: string]: unknown;
}

interface QuoteComparison {
  quote: JupiterQuoteResponse;
  outAmount: number;
  index: number;
}

interface QuoteSelectionResult {
  quote: JupiterQuoteResponse;
  improvementPct?: number;
}

interface JupiterSwapResponse {
  swapTransaction: string;
  [key: string]: unknown;
}

export function SwapInterface({ 
  selectedTokens, 
  totalSelectedValue,
  allTokens,
  onSwapComplete,
  onOutputTokenChange
}: SwapInterfaceProps) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction, wallet } = useWallet();

  const [outputToken, setOutputToken] = useState(USDC_MINT);
  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const tokenSelectorRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TokenBalance[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showTokenSearch, setShowTokenSearch] = useState(false);
  const [popularTokens, setPopularTokens] = useState<TokenBalance[]>([]);
  const isLiquidation = useMemo(() => outputToken === USDC_MINT, [outputToken]);
  const getActionVerb = useMemo(() => isLiquidation ? 'liquidate' : 'swap pro-rata', [isLiquidation]);
  const getProcessName = useMemo(() => isLiquidation ? 'liquidation' : 'swap', [isLiquidation]);

  const fetchPopularTokens = useCallback(async () => {
    const cached = sessionStorage.getItem('popular-tokens-cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 3600000) {
          setPopularTokens(parsed.tokens);
          return;
        }
      } catch {
      }
    }

    try {
      const response = await fetch('https://cdn.jsdelivr.net/gh/solana-labs/token-list@main/src/tokens/solana.tokenlist.json');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const data = await response.json();
      const tokens = data.tokens;
      
      const popularSymbols = ['SOL', 'USDC', 'USDT', 'BONK', 'JUP', 'RAY', 'ORCA', 'SRM', 'MSOL', 'JITO'];
      const topTokens = popularSymbols
        .map(symbol => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const token = tokens.find((t: any) => t.symbol === symbol);
          if (!token) return null;
          return {
            mint: token.address,
            symbol: token.symbol,
            name: token.name,
            logoURI: token.logoURI,
            decimals: token.decimals,
            uiAmount: 0,
            value: 0,
            price: 0
          };
        })
        .filter(Boolean)
        .slice(0, 10) as TokenBalance[];
      
      setPopularTokens(topTokens);
      sessionStorage.setItem('popular-tokens-cache', JSON.stringify({ tokens: topTokens, timestamp: Date.now() }));
    } catch (error) {
      console.error('Failed to fetch popular tokens:', error);
      setPopularTokens([
        {
          mint: USDC_MINT,
          symbol: 'USDC',
          name: 'USD Coin',
          logoURI: '',
          decimals: 6,
          uiAmount: 0,
          value: 0,
          price: 0,
          selected: false,
          changePercent24h: null
        },
        {
          mint: SOL_MINT,
          symbol: 'SOL',
          name: 'Solana',
          logoURI: '',
          decimals: 9,
          uiAmount: 0,
          value: 0,
          price: 0,
          selected: false,
          changePercent24h: null
        }
      ]);
    }
  }, []);

  useEffect(() => {
    fetchPopularTokens();
  }, [fetchPopularTokens]);

  useEffect(() => {
    if (prevTotalSelectedValue.current !== totalSelectedValue && totalSelectedValue > 0) {
      setValueUpdated(true);
      const timer = setTimeout(() => setValueUpdated(false), 800);
      prevTotalSelectedValue.current = totalSelectedValue;
      return () => clearTimeout(timer);
    }
  }, [totalSelectedValue]);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tokenSelectorRef.current && !tokenSelectorRef.current.contains(event.target as Node)) {
        setShowTokenSelector(false);
      }
    };
    
    if (showTokenSelector) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTokenSelector]);

  const [slippage, setSlippage] = useState(1.0);
  const [liquidationPercentage, setLiquidationPercentage] = useState<number>(100);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string>('');
  const [currentStep, setCurrentStep] = useState<string>('');
  const [swapResults, setSwapResults] = useState<SwapResult[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useJitoBundling, setUseJitoBundling] = useState(false);
  const [jitoTipLamports, setJitoTipLamports] = useState<number>(100000);
  const [valueUpdated, setValueUpdated] = useState(false);
  const [failedTokens, setFailedTokens] = useState<ProRataToken[]>([]);
  const prevTotalSelectedValue = useRef(totalSelectedValue);

  const isLedgerConnected = useMemo(() => {
    return wallet?.adapter?.name?.toLowerCase().includes('ledger');
  }, [wallet]);

  const tokenService = TokenService.getInstance();

  const liquidationValue = (totalSelectedValue * liquidationPercentage) / 100;

  const sortedOutputTokens = useMemo(() => {
    const stickyTokens: TokenBalance[] = [];
    const otherTokens: TokenBalance[] = [];
    
    allTokens.forEach(token => {
      if (token.mint === USDC_MINT || token.mint === SOL_MINT) {
        stickyTokens.push(token);
      } else {
        otherTokens.push(token);
      }
    });
    
    stickyTokens.sort((a, b) => {
      if (a.mint === USDC_MINT) return -1;
      if (b.mint === USDC_MINT) return 1;
      if (a.mint === SOL_MINT) return -1;
      return 1;
    });
    
    otherTokens.sort((a, b) => a.symbol.localeCompare(b.symbol));
    
    return [...stickyTokens, ...otherTokens];
  }, [allTokens]);

  const outputTokenInfo = useMemo(() => {
  const fromSearch = searchResults.find(t => t.mint === outputToken);
  if (fromSearch) return fromSearch;

  const fromWallet = sortedOutputTokens.find(t => t.mint === outputToken);
  if (fromWallet) return fromWallet;

  const fromPopular = popularTokens.find(t => t.mint === outputToken);
  if (fromPopular) return fromPopular;

  return sortedOutputTokens.find(t => t.mint === USDC_MINT) || popularTokens.find(t => t.mint === USDC_MINT);
}, [outputToken, sortedOutputTokens, searchResults, popularTokens]);


  const outputTokenSymbol = outputTokenInfo?.symbol || 'USDC';

  const searchTokens = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(query)}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const tokens = await response.json();
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formattedResults = tokens.slice(0, 20).map((token: any) => ({
        mint: token.id,
        symbol: token.symbol,
        name: token.name,
        logoURI: token.icon,
        decimals: token.decimals,
        uiAmount: 0,
        value: 0,
        price: 0
      }));
      
      setSearchResults(formattedResults);
      
    } catch (error) {
      console.error('Token search failed:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const signTransactionUniversal = useCallback(async (transaction: VersionedTransaction, tokenSymbol: string): Promise<VersionedTransaction> => {
    if (!signTransaction) {
      throw new Error('no signtransaction function available');
    }

    try {
      setCurrentStep(isLedgerConnected 
        ? `please confirm ${tokenSymbol} transaction on your ledger device...` 
        : `confirm ${tokenSymbol} swap...`
      );
      
      const signedTransaction = await signTransaction(transaction);
      return signedTransaction;
      
    } catch (error: unknown) {
      console.error('transaction signing failed:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'unknown error occurred';
      
      if (isLedgerConnected) {
        if (errorMessage.includes('denied') || errorMessage.includes('rejected')) {
          throw new Error('transaction was rejected on your ledger device.');
        } else if (errorMessage.includes('timeout')) {
          throw new Error('ledger signing timeout. please try again.');
        } else if (errorMessage.includes('disconnected') || errorMessage.includes('not found')) {
          throw new Error('ledger device not found. please ensure your device is connected and the solana app is open.');
        } else {
          throw new Error('ledger signing failed. please check your device and try again.');
        }
      } else {
        throw new Error(`transaction signing failed: ${errorMessage}`);
      }
    }
  }, [signTransaction, isLedgerConnected]);

  const calculateProRataAmounts = (): ProRataToken[] => {
    const tokensToLiquidate = selectedTokens.filter(token => token.mint !== outputToken);
    
    const totalValueExcludingOutput = tokensToLiquidate.reduce((sum, token) => sum + (token.value || 0), 0);
    
    return tokensToLiquidate.map(token => {
      const tokenValue = token.value || 0;
      const tokenPercentageOfTotal = totalValueExcludingOutput > 0 ? tokenValue / totalValueExcludingOutput : 0;
      
      const adjustedLiquidationValue = (totalValueExcludingOutput * liquidationPercentage) / 100;
      const tokenLiquidationValue = adjustedLiquidationValue * tokenPercentageOfTotal;
      
      const tokenPrice = token.price || 1;
      const tokenAmountToSwap = tokenPrice > 0 ? tokenLiquidationValue / tokenPrice : 0;
      
      const finalSwapAmount = Math.min(tokenAmountToSwap, token.uiAmount);

      return {
        ...token,
        swapAmount: finalSwapAmount,
        percentage: tokenPercentageOfTotal * 100,
        liquidationAmount: tokenLiquidationValue,
        originalAmount: token.uiAmount
      };
    });
  };

  const TokenLogo = ({ token, size = 8 }: { token?: TokenBalance; size?: number }) => {
  if (!token) {
    const logoClasses = size === 6 
      ? "w-6 h-6 sm:w-6 sm:h-6" 
      : "w-6 h-6 sm:w-8 sm:h-8";
    
    return (
      <div className={`bg-gradient-to-br from-gray-500 to-gray-600  ${logoClasses} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
        ???
      </div>
    );
  }

  const logoClasses = size === 6 
    ? "w-6 h-6 sm:w-6 sm:h-6" 
    : "w-6 h-6 sm:w-8 sm:w-8";
  
  if (token.logoURI) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={token.logoURI}
        alt={token.symbol}
        className={` ${logoClasses} flex-shrink-0 object-cover`}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
          (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
        }}
      />
    );
  }
  
  return (
    <div className={`bg-gradient-to-br from-gray-500 to-gray-400  ${logoClasses} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
      {token.symbol.slice(0, 3)}
    </div>
  );
};

  const getFreshBlockhash = async () => {
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      return { blockhash, lastValidBlockHeight };
    } catch (err) {
      console.error('failed to get fresh blockhash:', err);
      throw new Error('unable to get fresh blockhash');
    }
  };

  const fetchSingleQuote = async (
    token: ProRataToken, 
    attemptNumber: number = 0
  ): Promise<JupiterQuoteResponse | null> => {
    try {
      const slippageBps = Math.floor(slippage * 100);
      const rawAmount = Math.floor(token.swapAmount * Math.pow(10, token.decimals));

      if (rawAmount <= 0) {
        return null;
      }

      if (attemptNumber > 0) {
        await new Promise(resolve => setTimeout(resolve, 100 * attemptNumber));
      }

      const inputMint = token.mint;
      
      const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?` + new URLSearchParams({
        inputMint,
        outputMint: outputToken,
        amount: rawAmount.toString(),
        slippageBps: slippageBps.toString(),
        swapMode: 'ExactIn'
      }).toString();

      const response = await fetch(quoteUrl);
      
      if (!response.ok) {
        if (response.status === 429) {
          return null;
        } else if (response.status === 400) {
          return null;
        } else {
          return null;
        }
      }

      const quoteData: JupiterQuoteResponse = await response.json();
      
      if (!quoteData || !quoteData.outAmount) {
        return null;
      }

      return quoteData;

    } catch {
      return null;
    }
  };

  const getBestSwapQuote = async (token: ProRataToken): Promise<QuoteSelectionResult> => {
    try {
      setCurrentStep(`fetching best quote for ${token.symbol}...`);
      
      const quotePromises = Array.from({ length: 3 }, (_, i) => 
        fetchSingleQuote(token, i)
      );

      const quotes = await Promise.all(quotePromises);
      
      const validQuotes: QuoteComparison[] = quotes
        .filter((quote): quote is JupiterQuoteResponse => quote !== null)
        .map((quote, index) => ({
          quote,
          outAmount: parseInt(quote.outAmount),
          index
        }));

      if (validQuotes.length === 0) {
        if (token.symbol === 'SOL' || token.mint === SOL_MINT) {
          throw new Error(`no quotes available for SOL. consider using a different output token`);
        }
        throw new Error(`no valid quotes found for ${token.symbol}`);
      }

      validQuotes.sort((a, b) => b.outAmount - a.outAmount);
      const bestQuote = validQuotes[0];
      const worstQuote = validQuotes[validQuotes.length - 1];
      const improvementPct =
        validQuotes.length > 1 && worstQuote.outAmount > 0
          ? ((bestQuote.outAmount - worstQuote.outAmount) / worstQuote.outAmount) * 100
          : undefined;
      
      if (validQuotes.length > 1) {
}

      return { quote: bestQuote.quote, improvementPct };

    } catch (err) {
      console.error(`quote comparison failed for ${token.symbol}:`, err);
      const fallbackQuote = await fetchSingleQuote(token, 0);
      if (!fallbackQuote) {
        const errorMsg = err instanceof Error ? err.message : 'unknown error';
        if (token.symbol === 'SOL' || token.mint === SOL_MINT) {
          throw new Error(`sol swap failed - try liquidating without sol, or select usdc/usdt as output`);
        }
        throw new Error(`failed to fetch quote for ${token.symbol}: ${errorMsg}`);
      }
      return { quote: fallbackQuote };
    }
  };

  const buildHistoryRecord = (
  successfulSwaps: SwapResult[],
  status: 'success' | 'partial',
): SwapBatchRecord | null => {
  if (!publicKey || successfulSwaps.length === 0 || !HISTORY_ENABLED) {
    return null;
  }

  const wallet = publicKey.toBase58();
  const timestamp = Date.now();
  const hashedWallet = encryptionService.anonymizePublicKey(wallet);

  const tokensIn: SwapTokenInput[] = successfulSwaps.map((swap) => {
    const priceUsd =
      swap.priceUsd ??
      (swap.inputAmount > 0 ? swap.amount / swap.inputAmount : 0);

    return {
      mint: swap.mint,
      symbol: swap.symbol,
      decimals: swap.decimals,
      uiAmount: swap.inputAmount,
      valueUsd: swap.amount,
      priceUsd,
      signature: swap.signature,
      outputAmount: swap.outputAmount,
      outputUsd: swap.outputUsd ?? swap.amount,
      quoteImprovementPct: swap.quoteImprovementPct,
    };
  });

  const totals = tokensIn.reduce(
    (acc, token) => {
      acc.valueUsdIn += token.valueUsd;
      acc.valueUsdOut += token.outputUsd ?? token.valueUsd;
      return acc;
    },
    { valueUsdIn: 0, valueUsdOut: 0 },
  );

  const improvementValues = successfulSwaps
    .map((swap) => swap.quoteImprovementPct)
    .filter(
      (value): value is number =>
        typeof value === 'number' && !Number.isNaN(value),
    );

  const averageImprovement =
    improvementValues.length > 0
      ? improvementValues.reduce((sum, value) => sum + value, 0) /
        improvementValues.length
      : undefined;

  return {
    batchId:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${timestamp}`,
    wallet,
    hashedWallet,
    timestamp,
    outputToken: {
      mint: outputToken,
      symbol: outputTokenInfo?.symbol || outputTokenSymbol,
    },
    liquidationPct: liquidationPercentage,
    slippage,
    totals,
    tokensIn,
    status,
    quoteImprovementPct: averageImprovement,
    chartIndicators: successfulSwaps
      .filter((swap) => Boolean(swap.signature))
      .map((swap) => ({
        mint: swap.mint,
        symbol: swap.symbol,
        amount: swap.inputAmount,
        valueUsd: swap.amount,
        timestamp,
        signature: swap.signature as string,
        outputToken: outputToken,
        type: isLiquidation ? 'liquidation' as const : 'swap' as const,
      })),
  } as SwapBatchRecord;
};

  const submitSwapHistory = async (record: SwapBatchRecord | null) => {
    if (!record || !HISTORY_ENABLED) return;

    try {
      await fetch('/api/history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet': record.wallet,
        },
        body: JSON.stringify(record),
      });
    } catch (error) {
      console.error('swap history submission failed:', error);
    }
  };

  const executeJitoBundledSwaps = async (tokens: ProRataToken[]): Promise<SwapResult[]> => {
    const results: SwapResult[] = [];
    const swapTransactions: { token: ProRataToken; transaction: VersionedTransaction; quote: JupiterQuoteResponse }[] = [];
    let signedTransactions: VersionedTransaction[] = [];
    
    try {
      setCurrentStep('preparing bundle for jito...');
      
      const { blockhash } = await getFreshBlockhash();
      
      setCurrentStep(`building ${tokens.length} swap transaction${tokens.length > 1 ? 's' : ''}...`);
      
      for (const token of tokens) {
        try {
          const quoteSelection = await getBestSwapQuote(token);
          const quoteData = quoteSelection.quote;
          
          const swapResponse = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quoteResponse: quoteData,
              userPublicKey: publicKey!.toString(),
              dynamicComputeUnitLimit: true,
              dynamicSlippage: true,
              prioritizationFeeLamports: {
                priorityLevelWithMaxLamports: {
                  maxLamports: 1000000,
                  priorityLevel: "veryHigh"
                }
              },
              wrapAndUnwrapSol: true,
              asLegacyTransaction: false,
              useSharedAccounts: true,
              configs: {
                recentBlockhash: blockhash
              }
            })
          });
          
          if (!swapResponse.ok) {
            throw new Error(`swap build failed for ${token.symbol}`);
          }
          
          const swapData: JupiterSwapResponse = await swapResponse.json();
          if (!swapData.swapTransaction) {
            throw new Error(`no transaction returned for ${token.symbol}`);
          }
          
          const transaction = VersionedTransaction.deserialize(
            Buffer.from(swapData.swapTransaction, 'base64')
          );
          
          swapTransactions.push({ token, transaction, quote: quoteData });
        } catch (err) {
          console.error(`failed to build transaction for ${token.symbol}:`, err instanceof Error ? err.message : String(err));
          results.push({
            symbol: token.symbol,
            mint: token.mint,
            decimals: token.decimals,
            amount: token.liquidationAmount,
            inputAmount: token.swapAmount,
            error: (err instanceof Error ? err.message : 'transaction build failed').toLowerCase(),
            retryCount: 0
          });
        }
      }
      
      if (swapTransactions.length === 0) {
        throw new Error('failed to build any transactions for bundle');
      }
      
      setCurrentStep(`please sign bundle of ${swapTransactions.length} swaps...`);
      
      if (!wallet?.adapter) {
        throw new Error('wallet adapter not available');
      }
      
      const adapter = wallet.adapter as unknown as { signAllTransactions?: (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]> };
      const supportsSignAll = typeof adapter.signAllTransactions === 'function';
      
      if (supportsSignAll && swapTransactions.length > 1 && adapter.signAllTransactions) {
        try {
          signedTransactions = await adapter.signAllTransactions(
            swapTransactions.map(st => st.transaction)
          );
        } catch {
          signedTransactions = [];
          for (const st of swapTransactions) {
            const signed = await signTransactionUniversal(st.transaction, st.token.symbol);
            signedTransactions.push(signed);
          }
        }
      } else {
        signedTransactions = [];
        for (const st of swapTransactions) {
          const signed = await signTransactionUniversal(st.transaction, st.token.symbol);
          signedTransactions.push(signed);
        }
      }
      
      setCurrentStep('adding jito tip to bundle...');
      const { blockhash: tipBlockhash } = await getFreshBlockhash();
      const tipAccount = new PublicKey(
        JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]
      );
      
      const tipInstruction = SystemProgram.transfer({
        fromPubkey: publicKey!,
        toPubkey: tipAccount,
        lamports: jitoTipLamports,
      });
      
      const tipMessage = new TransactionMessage({
        payerKey: publicKey!,
        recentBlockhash: tipBlockhash,
        instructions: [tipInstruction],
      }).compileToV0Message();
      
      const tipTransaction = new VersionedTransaction(tipMessage);
      const signedTipTransaction = await signTransactionUniversal(
        tipTransaction, 
        `tip (${(jitoTipLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL)`
      );
      
      signedTransactions.push(signedTipTransaction);
      
      setCurrentStep('submitting bundle to jito...');
      
      const serializedTransactions = signedTransactions.map(tx => 
        Buffer.from(tx.serialize()).toString('base64')
      );
      
      let jitoResult: { result?: string; error?: { message: string } } | null = null;
      let submitAttempts = 0;
      const maxSubmitAttempts = 5;
      
      const jitoEndpoints = [
        'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
        'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
        'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
        'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles'
      ];
      
      while (submitAttempts < maxSubmitAttempts) {
        const endpoint = jitoEndpoints[submitAttempts % jitoEndpoints.length];
        submitAttempts++;
        
        try {
          const jitoResponse = await fetch(endpoint, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'sendBundle',
              params: [serializedTransactions]
            })
          });
          
          if (!jitoResponse.ok) {
            if (jitoResponse.status === 429 && submitAttempts < maxSubmitAttempts) {
              setCurrentStep(`endpoint busy, trying next (${submitAttempts}/${maxSubmitAttempts})...`);
              await new Promise(resolve => setTimeout(resolve, 500));
              continue;
            }
            
            throw new Error(`jito error (${jitoResponse.status})`);
          }
          
          jitoResult = await jitoResponse.json();
          
          if (jitoResult && jitoResult.error) {
            throw new Error(`jito: ${jitoResult.error.message}`);
          }
          
          if (!jitoResult || !jitoResult.result) {
            throw new Error('no bundle id returned');
          }
          
          break;
          
        } catch (err) {
          if (submitAttempts >= maxSubmitAttempts) {
            throw err;
          }
          setCurrentStep(`retry ${submitAttempts}/${maxSubmitAttempts}...`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      if (!jitoResult || jitoResult.error) {
        throw new Error(jitoResult?.error?.message || 'bundle submission failed after retries');
      }
      
      setCurrentStep('waiting for bundle confirmation...');

      let confirmed = false;
      let attempts = 0;
      const maxAttempts = 60;
      
      const connection = tokenService.getConnection();
      
      while (!confirmed && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
        
        try {
          const firstSig = bs58.encode(signedTransactions[0].signatures[0]);
          const status = await connection.getSignatureStatus(firstSig);
          
          if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
            confirmed = true;
          }
        } catch {
        }
      }
      
      if (!confirmed) {
        throw new Error('bundle confirmation timeout');
      }
      
      for (let i = 0; i < swapTransactions.length; i++) {
        const { token, quote } = swapTransactions[i];
        const signedTx = signedTransactions[i];
        const signature = bs58.encode(signedTx.signatures[0]);
        
        const outputDecimals = outputTokenInfo?.decimals || (outputToken === SOL_MINT ? 9 : 6);
        const outputAmount = parseInt(quote.outAmount) / Math.pow(10, outputDecimals);
        const outputUsd = outputAmount * (outputTokenInfo?.price || (outputToken === USDC_MINT ? 1 : token.price || 0));
        
        results.push({
          symbol: token.symbol,
          mint: token.mint,
          decimals: token.decimals,
          signature,
          amount: token.liquidationAmount,
          inputAmount: token.swapAmount,
          outputAmount,
          outputUsd,
          priceUsd: token.price,
          retryCount: 0
        });
      }
      
      setCurrentStep(`bundle confirmed! ${results.length} swaps executed`);
      
    } catch (err) {
      console.error('jito bundle execution failed:', err);
      setError(err instanceof Error ? err.message.toLowerCase() : 'bundle execution failed');
      
      setFailedTokens(tokens);
    }
    
    return results;
  };

  const executeSequentialSwaps = async (tokens: ProRataToken[]): Promise<SwapResult[]> => {
    const results: SwapResult[] = [];
    
    for (const [index, token] of tokens.entries()) {
      let retryCount = 0;
      const maxRetries = 3;
      let success = false;

      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      while (retryCount <= maxRetries && !success) {
        try {
          setCurrentStep(`swapping ${token.symbol} (${token.swapAmount.toFixed(6)})...`);

          if (retryCount > 0) {
            const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
          }

          const quoteSelection = await getBestSwapQuote(token);
          const quoteData = quoteSelection.quote;
          const { blockhash, lastValidBlockHeight } = await getFreshBlockhash();

          const swapResponse = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              quoteResponse: quoteData,
              userPublicKey: publicKey!.toString(),
              dynamicComputeUnitLimit: true,
              dynamicSlippage: true,
              prioritizationFeeLamports: {
                priorityLevelWithMaxLamports: {
                  maxLamports: 1000000,
                  priorityLevel: "veryHigh"
                }
              },
              wrapAndUnwrapSol: true,
              asLegacyTransaction: false,
              useSharedAccounts: true,
              configs: {
                recentBlockhash: blockhash
              }
            })
          });

          if (!swapResponse.ok) {
            const errorData = await swapResponse.json().catch(() => ({}));
            throw new Error(`swap build failed: ${errorData.error || swapResponse.statusText}`);
          }

          const swapData: JupiterSwapResponse = await swapResponse.json();

          if (!swapData.swapTransaction) {
            throw new Error('no swap transaction returned from jupiter');
          }

          const transaction = VersionedTransaction.deserialize(
            Buffer.from(swapData.swapTransaction, 'base64')
          );

          const signedTransaction = await signTransactionUniversal(transaction, token.symbol);
          
          setCurrentStep(`sending ${token.symbol} transaction...`);
          
          const signature = await connection.sendRawTransaction(
            signedTransaction.serialize(),
            {
              skipPreflight: true,
              preflightCommitment: 'confirmed',
              maxRetries: 3
            }
          );

          if (!signature) {
            throw new Error('failed to send transaction - no signature returned');
          }

          setCurrentStep(`confirming ${token.symbol} transaction...`);
          const confirmation = await connection.confirmTransaction({
            signature,
            blockhash: blockhash,
            lastValidBlockHeight: lastValidBlockHeight
          }, 'confirmed');

          if (confirmation.value.err) {
            throw new Error(`transaction failed: ${confirmation.value.err}`);
          }

          const outputDecimals = outputTokenInfo?.decimals || (outputToken === SOL_MINT ? 9 : 6);
          
          const outputAmount =
            parseInt(quoteData.outAmount) / Math.pow(10, outputDecimals);
          const outputUsd =
            outputAmount *
            (outputTokenInfo?.price || (outputToken === USDC_MINT ? 1 : token.price || 0));

          const result: SwapResult = {
            symbol: token.symbol,
            mint: token.mint,
            decimals: token.decimals,
            signature,
            amount: token.liquidationAmount,
            inputAmount: token.swapAmount,
            outputAmount,
            outputUsd,
            retryCount,
            priceUsd: token.price,
            quoteImprovementPct: quoteSelection.improvementPct,
          };

          results.push(result);
          success = true;
          setSwapResults(prev => [...prev, result]);

        } catch (err) {
          retryCount++;
          
          if (retryCount > maxRetries) {
          console.error(`failed to swap ${token.symbol} after ${maxRetries} attempts:`, err);
          const errorResult: SwapResult = {
            symbol: token.symbol,
            mint: token.mint,
            decimals: token.decimals,
            amount: token.liquidationAmount,
            inputAmount: token.swapAmount,
            error: (err instanceof Error ? err.message : 'unknown error').toLowerCase(),
            retryCount
          };
          results.push(errorResult);
          setSwapResults(prev => [...prev, errorResult]);
        }
        }
      }
    }
    
    return results;
  };

  const executeLiquidation = async () => {
    if (!publicKey || !signTransaction || !sendTransaction || selectedTokens.length === 0) {
      setError('please connect wallet and select tokens');
      return;
    }

    if (liquidationPercentage === 0) {
      setError('please select a liquidation percentage greater than 0%');
      return;
    }

    setSwapping(true);
    setError('');
    setCurrentStep('starting liquidation...');
    setSwapResults([]);

    try {
      const proRataTokens = calculateProRataAmounts();
      
      const validTokens = proRataTokens.filter(token => 
        token.mint !== outputToken && 
        token.swapAmount > 0.000001 && 
        token.liquidationAmount > 0.01
      );

      if (validTokens.length === 0) {
        throw new Error('no valid tokens with sufficient balance to liquidate');
      }

      let results: SwapResult[] = [];
      
      if (useJitoBundling) {
        const batchSize = 5;
        const numBatches = Math.ceil(validTokens.length / batchSize);
        
        setCurrentStep(`processing ${numBatches} jito bundle${numBatches > 1 ? 's' : ''}...`);
        
        for (let i = 0; i < numBatches; i++) {
          const start = i * batchSize;
          const end = Math.min(start + batchSize, validTokens.length);
          const batchTokens = validTokens.slice(start, end);
          
          setCurrentStep(`bundle ${i + 1}/${numBatches}: ${batchTokens.length} swaps...`);
          
          const batchResults = await executeJitoBundledSwaps(batchTokens);
          results.push(...batchResults);
          
          if (i < numBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } else {
        results = await executeSequentialSwaps(validTokens);
      }

      const successfulSwaps = results.filter(result => !result.error);
      const failedSwaps = results.filter(result => result.error);

      if (HISTORY_ENABLED && successfulSwaps.length > 0) {
        const statusLabel: 'success' | 'partial' =
          failedSwaps.length === 0 ? 'success' : 'partial';
        const record = buildHistoryRecord(successfulSwaps, statusLabel);
        void submitSwapHistory(record);
      }

      if (successfulSwaps.length > 0) {
        const totalSwapped = successfulSwaps.reduce((sum, swap) => sum + (swap.amount || 0), 0);
        const totalSwappedPercentage = totalSelectedValue > 0 ? (totalSwapped / totalSelectedValue * 100).toFixed(1) : '0';
        
        setCurrentStep(`successfully liquidated ${successfulSwaps.length} tokens (${totalSwappedPercentage}% of selection)`);
        
        triggerSwapHistoryRefresh();
        if (failedSwaps.length === 0) {
          setTimeout(() => {
            setCurrentStep('');
            onSwapComplete();
          }, 8000);
        }
      }
      
      if (failedSwaps.length > 0) {
        const errorMsg = `${failedSwaps.length} liquidations failed. ${successfulSwaps.length > 0 ? 'partial success. view results above.' : 'view errors above.'}`;
        console.error('failed liquidations:', failedSwaps);
        setError(errorMsg);
      }

    } catch (err) {
      const errorMsg = (err instanceof Error ? err.message : 'liquidation failed').toLowerCase();
      setError(errorMsg);
      console.error('liquidation execution error:', err);
    } finally {
      setSwapping(false);
    }
  };

  const retryBundled = async () => {
    if (failedTokens.length === 0) return;
    
    setError('');
    setSwapResults([]);
    setSwapping(true);
    
    try {
      const results = await executeJitoBundledSwaps(failedTokens);
      setSwapResults(results);
      
      const successfulSwaps = results.filter(r => !r.error && r.signature);
      const failedSwaps = results.filter(r => r.error);
      
      if (successfulSwaps.length > 0) {
        if (failedSwaps.length === 0) {
          setFailedTokens([]);
        }
        setCurrentStep(`bundle successful! ${successfulSwaps.length} swaps completed`);
        triggerSwapHistoryRefresh();
        
        if (failedSwaps.length === 0) {
          setTimeout(() => {
            setCurrentStep('');
            onSwapComplete();
          }, 8000);
        }
      }
      
      if (failedSwaps.length > 0) {
        setError(`${failedSwaps.length} swaps still failed. view results above.`);
      }
    } catch (err) {
      const errorMsg = (err instanceof Error ? err.message : 'retry failed').toLowerCase();
      setError(errorMsg);
    } finally {
      setSwapping(false);
    }
  };

  const retryIndividually = async () => {
    if (failedTokens.length === 0) return;
    
    setError('');
    setSwapResults([]);
    setSwapping(true);
    
    try {
      const results = await executeSequentialSwaps(failedTokens);
      setSwapResults(results);
      
      const successfulSwaps = results.filter(r => !r.error && r.signature);
      const failedSwaps = results.filter(r => r.error);
      
      if (successfulSwaps.length > 0) {
        if (failedSwaps.length === 0) {
          setFailedTokens([]);
        }
        setCurrentStep(`${successfulSwaps.length} swaps completed individually`);
        triggerSwapHistoryRefresh();
        
        if (failedSwaps.length === 0) {
          setTimeout(() => {
            setCurrentStep('');
            onSwapComplete();
          }, 8000);
        }
      }
      
      if (failedSwaps.length > 0) {
        setError(`${failedSwaps.length} swaps still failed. view results above.`);
        setFailedTokens(failedTokens.filter(t => results.find(r => r.mint === t.mint && r.error)));
      }
    } catch (err) {
      const errorMsg = (err instanceof Error ? err.message : 'retry failed').toLowerCase();
      setError(errorMsg);
    } finally {
      setSwapping(false);
    }
  };

  const proRataTokens = calculateProRataAmounts();
  
  const hasFailedSwaps = swapResults.some(result => result.error);

  const TokenSearchResult = ({ 
  token, 
  onSelect, 
  isSelected 
}: { 
  token: TokenBalance; 
  onSelect: (token: TokenBalance) => void;
  isSelected: boolean;
}) => {
  const [showFullAddress, setShowFullAddress] = useState(false);

  return (
    <div className="border-b border-primary last:border-b-0">
      <button
        type="button"
        onClick={() => onSelect(token)}
        className={`w-full px-4 py-3 text-left hover:bg-tertiary transition-all duration-300 flex items-center space-x-3 mobile-optimized group ${
          isSelected ? 'bg-tertiary border-r-2 border-green-primary' : ''
        }`}
      >
        <TokenLogo token={token} size={8} />
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center space-x-2 mb-1">
            <span className="font-semibold text-m text-primary truncate">{token.symbol}</span>
            {isSelected && (
              <div className="w-2 h-2 bg-green-primary  animate-pulse"></div>
            )}
          </div>
          <div className="text-xs text-secondary truncate">{token.name}</div>
          <div className="text-xs text-tertiary font-mono truncate mt-1">
            {showFullAddress ? token.mint : `${token.mint.slice(0, 8)}...${token.mint.slice(-8)}`}
          </div>
        </div>
        <div className="flex-shrink-0">
          {isSelected ? (
            <div className="w-6 h-6 bg-green-primary  flex items-center justify-center">
              <div className="w-2 h-2 bg-primary "></div>
            </div>
          ) : (
            <div className="w-6 h-6 border-2 border-primary  group-hover:border-secondary transition-colors"></div>
          )}
        </div>
      </button>
      
      {/* Token Actions Row */}
      <div className="px-4 pb-3 pt-1 flex items-center justify-between">
        <button
          onClick={() => setShowFullAddress(!showFullAddress)}
          className="text-xs text-tertiary hover:text-secondary transition-colors mobile-optimized"
        >
          {showFullAddress ? 'show less' : 'show full address'}
        </button>
        <div className="flex items-center space-x-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(token.mint);
            }}
            className="p-1.5 hover:bg-tertiary  transition-colors mobile-optimized"
            title="Copy mint address"
          >
            <Copy className="h-3 w-3 text-secondary hover:text-primary" />
          </button>
          <a
            href={`https://orb.helius.dev/address/${token.mint}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 hover:bg-tertiary  transition-colors mobile-optimized"
            title="view on orb explorer"
          >
            <ExternalLink className="h-3 w-3 text-secondary hover:text-primary" />
          </a>
        </div>
      </div>
    </div>
  );
};

  const handleOutputTokenChange = (token: TokenBalance) => {
    setOutputToken(token.mint);
    setShowTokenSearch(false);
    setSearchQuery('');
    setSearchResults([]);
    if (onOutputTokenChange) {
      onOutputTokenChange(token.mint);
    }
  };

  return (
  <div className="bg-secondary p-4 sm:p-6 backdrop-blur-sm border border-primary h-fit mobile-optimized relative z-10 overflow-x-hidden">
    
    <h2 className="text-m sm:text-l font-semibold mb-4 sm:mb-6 flex items-center space-x-2">
      <ShoppingCart className="h-4 w-4 sm:h-5 sm:w-5 ml-2" />
      <span>cart</span>
    </h2>

    <div className="max-h-[calc(100vh-200px)] lg:max-h-none overflow-y-auto lg:overflow-y-visible overflow-x-hidden mobile-scroll lg:pr-0 pr-2 -mr-2 lg:mr-0">
      {selectedTokens.length === 0 ? (
      <div className="text-center py-6 sm:py-8 text-tertiary justify-items-center">
        <Calculator className="h-8 w-8 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 opacity-50" />
        <p className="text-m sm:text-base">select tokens to enable {isLiquidation ? 'liquidation' : 'pro-rata swap'}</p>
      </div>
      ) : (
        <>
          {/* Summary Section */}
          <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6">
            <div className="flex justify-between text-xs sm:text-m ml-3 mr-3">
              <span>tokens selected:</span>
              <span>{selectedTokens.length}</span>
            </div>
            <div className="flex justify-between text-xs sm:text-m ml-3 mr-3">
              <span>value:</span>
              <span className={`transition-all ${valueUpdated ? 'price-updated' : ''}`}>
                ${totalSelectedValue.toFixed(2)}
              </span>
            </div>

            {/* Percentage Selector */}
            <div className="space-y-2 sm:space-y-3">
              <div className="flex justify-between text-xs sm:text-m ml-3 mr-3">
                <span className="text-secondary">percentage:</span>
                <span className="text-secondary font-medium">
                  {liquidationPercentage}%
                </span>
              </div>
              
              <div className="space-y-2 ml-2 mr-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={liquidationPercentage}
                  onChange={(e) => setLiquidationPercentage(Number(e.target.value))}
                  className="w-full h-2 appearance-none cursor-pointer slider mobile-optimized"
                  style={{ background: 'var(--bg-tertiary)' }}
                />
                <div className="flex justify-between text-xs text-tertiary mobile-button-group">
                  {[0, 25, 50, 75, 100].map((percent) => (
                    <button
                      key={percent}
                      onClick={() => setLiquidationPercentage(percent)}
                      className={`px-1 sm:px-2 py-1  text-xs transition-colors ${
                        liquidationPercentage === percent 
                          ? 'text-primary' 
                          : 'hover:bg-tertiary'
                      }`}
                      style={{
                        background: liquidationPercentage === percent ? 'var(--bg-tertiary)' : 'transparent'
                      }}
                    >
                      {percent}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-tertiary  p-3 sm:p-4 space-y-2 ml-2 mr-2">
            <div className="flex justify-between text-xs sm:text-m">
              <span className="text-secondary">to {getActionVerb}</span>
              <span className={`text-orange-primary font-medium transition-all ${
                valueUpdated ? 'price-updated' : ''
              }`}>
                ${liquidationValue.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-xs sm:text-m">
              <span className="text-secondary lowercase">receive in {outputTokenSymbol}</span>
              <span className={`text-green-primary font-medium transition-all ${
                valueUpdated ? 'price-updated' : ''
              }`}>
                ~${liquidationValue.toFixed(2)}
              </span>
            </div>
          </div>
            
            {/* Advanced Settings Toggle */}
            <div className="border-t border-primary pt-3">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center space-x-2 text-xs sm:text-m text-secondary hover:text-primary transition-colors w-full mobile-optimized ml-3"
              >
                <span>advanced settings</span>
                <ChevronDown className={`h-3 w-3 sm:h-4 sm:w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {/* Advanced Settings */}
            {showAdvanced && (
              <div className="space-y-3 sm:space-y-4 animate-slideDown ml-3 mr-3">
                {/* Jito Bundling Toggle */}
                <div className={`border p-3 sm:p-4 transition-all duration-300 ${
                  useJitoBundling 
                    ? 'bg-green-primary/5 border-green-primary shadow-lg shadow-green-primary/20' 
                    : 'bg-tertiary border-primary'
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <label className="flex items-center space-x-2 cursor-pointer mobile-optimized">
                        <input
                          type="checkbox"
                          checked={useJitoBundling}
                          onChange={(e) => setUseJitoBundling(e.target.checked)}
                          className="border-primary text-orange-primary focus:ring-2 focus:ring-orange-primary w-4 h-4"
                        />
                        <div className="flex-1 flex items-center space-x-2">
                          <div className="text-xs sm:text-sm font-medium text-primary">
                            jito bundle
                          </div>
                          <div className="group/tooltip relative inline-block">
                            <Info className="h-3 w-3 text-secondary hover:text-green-primary cursor-help transition-colors" />
                            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 hidden group-hover/tooltip:block w-64 p-3 bg-secondary border border-green-primary text-xs text-primary z-50 shadow-xl shadow-green-primary/30 pointer-events-none">
                              bundle up to 5 swaps into one transaction requiring only 1 signature. faster and more efficient.
                            </div>
                          </div>
                        </div>
                      </label>
                    </div>
                    <Shield className={`h-5 w-5 ml-2 flex-shrink-0 transition-all duration-300 ${
                      useJitoBundling ? 'text-green-primary drop-shadow-[0_0_8px_rgba(0,255,136,0.5)]' : 'text-secondary'
                    }`} />
                  </div>
                  {useJitoBundling && selectedTokens.length > 5 && (
                    <div className="mt-2 text-xs text-green-primary bg-green-primary/10 p-2 border border-green-primary/30">
                      ✓ {selectedTokens.length} tokens will be batched into {Math.ceil(selectedTokens.length / 5)} bundles of up to 5 swaps each
                    </div>
                  )}
                  
                  {/* Jito Tip Amount */}
                  {useJitoBundling && (
                    <div className="mt-3 space-y-2">
                      <label className="block text-xs font-medium text-secondary">
                        jito tip (optional, recommended)
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="number"
                          value={(jitoTipLamports / LAMPORTS_PER_SOL).toFixed(4)}
                          onChange={(e) => {
                            const sol = parseFloat(e.target.value);
                            if (!isNaN(sol) && sol >= 0) {
                              setJitoTipLamports(Math.floor(sol * LAMPORTS_PER_SOL));
                            }
                          }}
                          step="0.0001"
                          min="0"
                          className="flex-1 bg-secondary border border-primary px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-orange-primary"
                        />
                        <span className="text-xs text-secondary whitespace-nowrap">SOL</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {[0.0001, 0.0005, 0.001, 0.005].map(amount => (
                          <button
                            key={amount}
                            type="button"
                            onClick={() => setJitoTipLamports(Math.floor(amount * LAMPORTS_PER_SOL))}
                            className={`text-xs px-2 py-1 border transition-colors ${
                              jitoTipLamports === Math.floor(amount * LAMPORTS_PER_SOL)
                                ? 'bg-orange-primary border-orange-primary text-primary'
                                : 'bg-tertiary border-primary text-secondary hover:border-orange-primary'
                            }`}
                          >
                            {amount} SOL
                          </button>
                        ))}
                      </div>
                      <div className="text-xs text-tertiary">
                        recommended: 0.0001-0.001 SOL. higher tips may improve bundle landing success rate.
                      </div>
                    </div>
                  )}
                </div>

                {/* Output Token Selection with Search */}
                <div className="relative" ref={tokenSelectorRef}>
                  <label className="block text-xs sm:text-m font-medium mb-2">output token</label>
                  <button
                    type="button"
                    onClick={() => setShowTokenSearch(!showTokenSearch)}
                    className="w-full bg-tertiary border border-primary  px-4 py-3 text-m focus:outline-none focus:ring-2 focus:ring-orange-primary focus:border-transparent mobile-optimized flex items-center justify-between hover:bg-secondary transition-all duration-300"
                  >
                    <div className="flex items-center space-x-3">
                      <TokenLogo token={outputTokenInfo} size={6} />
                      <div className="text-left">
                        <div className="font-medium text-m text-primary">{outputTokenSymbol}</div>
                        <div className="text-xs text-secondary">click to search tokens</div>
                      </div>
                    </div>
                    <ChevronDown className={`h-4 w-4 transition-transform ${showTokenSearch ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {showTokenSearch && (
                    <div className="absolute z-50 w-full mt-2 bg-secondary backdrop-blur-xl border border-primary  shadow-2xl max-h-80 overflow-hidden">
                      {/* Search Header */}
                      <div className="p-4 border-b border-primary">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-secondary h-4 w-4" />
                          <input
                            type="text"
                            placeholder="search for any token on solana..."
                            value={searchQuery}
                            onChange={(e) => {
                              setSearchQuery(e.target.value);
                              searchTokens(e.target.value);
                            }}
                            className="w-full pl-10 pr-4 py-3 bg-tertiary border border-primary  focus:outline-none focus:ring-2 focus:ring-orange-primary focus:border-transparent text-m placeholder-secondary"
                          />
                          {searchQuery && (
                            <button
                              onClick={() => {
                                setSearchQuery('');
                                setSearchResults([]);
                              }}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2"
                            >
                              <X className="h-4 w-4 text-secondary hover:text-primary" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="max-h-60 overflow-y-auto mobile-scroll">
                        {/* Popular Tokens */}
                        {!searchQuery && (
                          <div className="p-2">
                            <div className="px-3 py-2 text-xs font-semibold text-secondary lowercase tracking-wide">
                              Popular Tokens
                            </div>
                            {popularTokens.map(token => (
                              <TokenSearchResult 
                                key={token.mint} 
                                token={token} 
                                onSelect={handleOutputTokenChange}
                                isSelected={token.mint === outputToken}
                              />
                            ))}
                          </div>
                        )}

                        {/* Search Results */}
                        {searchQuery && (
                          <div className="p-2">
                            <div className="px-3 py-2 text-xs font-semibold text-secondary uppercase tracking-wide">
                              search results
                            </div>
                            {isSearching ? (
                              <div className="flex justify-center items-center py-8">
                                <div className="h-6 w-6" style={{ color: 'var(--orange-primary)' }}>
                                  <div className="circular-dot-spinner"></div>
                                </div>
                                <span className="ml-2 text-m text-secondary">searching...</span>
                              </div>
                            ) : searchResults.length > 0 ? (
                              searchResults.map(token => (
                                <TokenSearchResult 
                                  key={token.mint} 
                                  token={token} 
                                  onSelect={handleOutputTokenChange}
                                  isSelected={token.mint === outputToken}
                                />
                              ))
                            ) : (
                              <div className="text-center py-8 text-secondary text-m">
                                no tokens found matching {searchQuery}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Wallet Tokens */}
                        {!searchQuery && sortedOutputTokens.length > 0 && (
                          <div className="p-2 border-t border-primary">
                            <div className="px-3 py-2 text-xs font-semibold text-secondary uppercase tracking-wide">
                              your Tokens
                            </div>
                            {sortedOutputTokens.map(token => (
                              <TokenSearchResult 
                                key={token.mint} 
                                token={token} 
                                onSelect={handleOutputTokenChange}
                                isSelected={token.mint === outputToken}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Selected Token Details */}
                {outputTokenInfo && (
                  <div className="bg-tertiary border border-primary  p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-secondary">selected token</span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(outputTokenInfo.mint);
                          }}
                          className="p-1.5 hover:bg-secondary  transition-colors mobile-optimized"
                          title="Copy mint address"
                        >
                          <Copy className="h-3 w-3 text-secondary hover:text-primary" />
                        </button>
                        <a
                          href={`https://orb.helius.dev/address/${outputTokenInfo.mint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 hover:bg-secondary  transition-colors mobile-optimized"
                          title="view on orb explorer"
                        >
                          <ExternalLink className="h-3 w-3 text-secondary hover:text-primary" />
                        </a>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <TokenLogo token={outputTokenInfo} size={6} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-primary truncate">
                          {outputTokenInfo.symbol}
                        </div>
                        <div className="text-xs text-secondary truncate font-mono">
                          {outputTokenInfo.mint.slice(0, 8)}...{outputTokenInfo.mint.slice(-8)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Slippage Tolerance */}
                <div>
                  <label className="block text-xs sm:text-m font-medium mb-2">
                    slippage tolerance: {slippage}%
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="5"
                    step="0.1"
                    value={slippage}
                    onChange={(e) => setSlippage(parseFloat(e.target.value))}
                    className="w-full accent-orange-primary mobile-optimized"
                  />
                  <div className="flex justify-between text-xs text-secondary mt-1">
                    <span>0.5%</span>
                    <span>5%</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Token Breakdown */}
          <div className="mb-4 sm:mb-6 ml-3 mr-3">
          <h3 className="font-medium text-m sm:text-base mb-2 sm:mb-3">{getProcessName} breakdown</h3>
            <div className="space-y-2 max-h-32 sm:max-h-48 overflow-y-auto mobile-scroll">
              {proRataTokens
                .sort((a, b) => b.liquidationAmount - a.liquidationAmount)
                .map((token) => (
                  <div key={token.mint} className="flex justify-between items-center text-xs sm:text-m bg-tertiary p-2 ">
                    <div className="flex items-center space-x-2 min-w-0 flex-1">
                      <TokenLogo token={token} size={6} />
                      <span className="truncate lowercase">{token.symbol}</span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-green-primary">
                        {token.swapAmount > 0.0001 ? token.swapAmount.toFixed(4) : token.swapAmount.toFixed(6)}
                      </div>
                      <div className="text-secondary text-xs">
                        ${token.liquidationAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
         
          {/* Swap Results */}
          {swapResults.length > 0 && (
            <div className="ml-3 mr-3 mb-4 p-3 bg-tertiary border border-primary ">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-medium text-m sm:text-base">liquidation results</h4>
                {hasFailedSwaps && (
                  <button
                    onClick={() => {/* Add retry logic */}}
                    disabled={swapping}
                    className="text-xs bg-yellow-600 hover:bg-yellow-700 px-2 py-1  flex items-center space-x-1 mobile-optimized"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>failed</span>
                  </button>
                )}
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto mobile-scroll">
                {swapResults.map((result, index) => (
                  <div key={index} className="flex justify-between items-center text-xs sm:text-m">
                    <div className="flex items-center space-x-2 min-w-0 flex-1">
                      <span className={`truncate ${result.error ? 'text-orange-dark' : 'text-green-primary'}`}>
                        {result.symbol}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {result.error ? (
                        <span className="text-orange-dark text-xs">failed</span>
                      ) : result.signature ? (
                        <div className="flex flex-col items-end">
                          <a 
                            href={`https://solscan.io/tx/${result.signature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-400 hover:text-green-300 text-xs flex items-center space-x-1 mobile-optimized"
                          >
                            <span>success</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <div className="text-secondary text-xs">
                            {result.inputAmount > 0.0001 ? result.inputAmount.toFixed(4) : result.inputAmount.toFixed(6)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-yellow-400 text-xs">pending</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Current Step Indicator */}
          {swapping && currentStep && (
            <div className="ml-3 mr-3 mb-4 p-3 bg-tertiary border border-primary ">
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-m text-primary">{currentStep}</span>
                <div className="h-3 w-3 sm:h-4 sm:w-4" style={{ color: 'var(--orange-primary)' }}>
                  <div className="circular-dot-spinner"></div>
                </div>
              </div>
            </div>
          )}

          {error && (
          <div className="mb-4 p-3 border " style={{
            background: 'rgba(217, 79, 31, 0.1)',
            borderColor: 'var(--border-error)',
            color: 'var(--orange-dark)'
          }}>
            <div className="flex items-center space-x-2 mb-2">
              <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="text-xs sm:text-m font-medium">{getProcessName} error</span>
            </div>
            <span className="text-xs sm:text-m block mb-3">{error}</span>
            
            {/* Retry buttons when bundle fails */}
            {failedTokens.length > 0 && !swapping && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={retryBundled}
                  className="flex-1 py-2 px-3 rounded text-xs sm:text-sm font-medium transition-all flex items-center justify-center space-x-1 mobile-optimized"
                  style={{
                    background: 'var(--orange-primary)',
                    color: 'white',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--orange-dark)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'var(--orange-primary)'}
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>retry bundled</span>
                </button>
                <button
                  onClick={retryIndividually}
                  className="flex-1 py-2 px-3 rounded text-xs sm:text-sm font-medium transition-all flex items-center justify-center space-x-1 mobile-optimized"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-primary)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-secondary)';
                    e.currentTarget.style.borderColor = 'var(--orange-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                    e.currentTarget.style.borderColor = 'var(--border-primary)';
                  }}
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>retry individually</span>
                </button>
              </div>
            )}
          </div>
        )}

          {/* Action Buttons */}
          <div className="space-y-3 ml-2 mr-2">
            <button
            onClick={executeLiquidation}
            disabled={swapping || selectedTokens.length === 0 || !publicKey || liquidationPercentage === 0}
            className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed py-3 px-4  font-medium transition-all duration-300 transform flex items-center justify-center space-x-2 mobile-optimized text-m sm:text-base min-h-[44px]"
          >
            {swapping ? (
              <>
                <div className="h-4 w-4 text-white" style={{ color: 'white' }}>
                  <div className="circular-dot-spinner"></div>
                </div>
                <span className="text-xs sm:text-m">{isLiquidation ? 'liquidating' : 'swapping pro rata'}... ({swapResults.filter(r => !r.error).length}/{selectedTokens.length})</span>
              </>
            ) : (
              <>
                <DollarSign className="h-4 w-4" />
                <span className="text-xs sm:text-m">
                  {isLiquidation ? 'liquidate' : `swap pro-rata to ${outputTokenSymbol}`} {liquidationPercentage}%
                </span>
                {isLedgerConnected && <Shield className="h-4 w-4 ml-1" />}
              </>
            )}
          </button>
          </div>

          {!publicKey && (
          <div className="mt-3 p-2 bg-yellow-500/20 border border-yellow-500 ">
            <p className="text-xs text-yellow-200 text-center">
              connect your wallet to enable {isLiquidation ? 'liquidation' : 'pro-rata swap'}
            </p>
          </div>
        )}
        </>
      )}
    </div>
  </div>
);
}

'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { TokenBalance, PriceProgress } from './types/token';
import { TokenService } from './lib/api';
import { TokenTable } from './components/TokenTable';
import { SwapInterface } from './components/SwapInterface';
import { MultisigAnalyzer } from './components/enterWallet';
import { Settings2, Wallet, Menu, X, Calculator, Search, RefreshCw } from 'lucide-react';
import Image from 'next/image';
import { collection, doc, setDoc, getDocs, query, orderBy, limit, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from './lib/firebase';
import { encryptionService } from './lib/encryption';
import { HistoricalPortfolio } from './components/ViewHistory';
import { SwapHistoryPanel } from './components/SwapHistoryPanel';
import { useColumnState } from './hooks/useColumnState';
import { ThemeToggle } from './components/ThemeToggle';

import '@solana/wallet-adapter-react-ui/styles.css';

interface PortfolioHistory {
  timestamp: Date;
  totalValue: number;
  walletCount: number;
  tokenCount: number;
}

export default function Home() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [currentView, setCurrentView] = useState<'main' | 'multisig'>('main');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [currentPortfolioData, setCurrentPortfolioData] = useState<PortfolioHistory[]>([]);
  const [updatedTokens, setUpdatedTokens] = useState<Set<string>>(new Set());
  const lastHistoryUiUpdate = useRef<number>(0);
  const lastFirestoreWrite = useRef<number>(0);
  const lastCleanupRun = useRef<number>(0);
  const isInitialLoad = useRef(true);
  const subscriptionsSetup = useRef(false);

  const {
    columns,
    updateColumnWidth,
    toggleColumnVisibility,
    reorderColumns,
    resetColumns,
  } = useColumnState();
  
  const tokenService = TokenService.getInstance();

  type SafeLogData = Record<string, unknown>;

  const secureLog = {
  info: (message: string, data?: SafeLogData) => {
    if (process.env.NODE_ENV === 'development') {
    }
  },
  
  error: (message: string, error?: unknown) => {
    console.error(`[ERROR] ${message}`, error);
  },
  
  wallet: (message: string, publicKey?: string, data?: SafeLogData & { tokens?: unknown[] }) => {
    if (process.env.NODE_ENV === 'development') {
      const safeData = data ? {
        ...data,
        balances: data.balances ? '[******]' : undefined,
        values: data.values ? '[******]' : undefined,
        tokens: data.tokens ? `[${Array.isArray(data.tokens) ? data.tokens.length : '?'} tokens]` : undefined
      } : {};
    }
  }
};

const columnSettingsTriggerRef = useRef<HTMLButtonElement>(null);

const loadPortfolioHistory = useCallback(async () => {
  if (!publicKey) return;

  try {
    const anonymizedKey = encryptionService.anonymizePublicKey(publicKey.toString());
    const historyQuery = query(
      collection(db, 'wallet-history', anonymizedKey, 'records'),
      orderBy('timestamp', 'asc')
    );
    const querySnapshot = await getDocs(historyQuery);
    
    const history = querySnapshot.docs
      .map(doc => {
        const data = doc.data() as {
          encryptedData?: {
            totalValue: string;
            walletCount: string;
            tokenCount: string;
          };
          timestamp?: Timestamp;
        };
        
        if (!data.encryptedData) {
          return null;
        }

        try {
          const decryptedTotalValue = encryptionService.decryptData<number>(data.encryptedData.totalValue, publicKey.toString());
          const decryptedWalletCount = encryptionService.decryptData<number>(data.encryptedData.walletCount, publicKey.toString());
          const decryptedTokenCount = encryptionService.decryptData<number>(data.encryptedData.tokenCount, publicKey.toString());

          if (decryptedTotalValue === null || decryptedWalletCount === null || decryptedTokenCount === null) {
            return null;
          }

          const ts = data.timestamp instanceof Timestamp
            ? data.timestamp.toDate()
            : data.timestamp
              ? new Date(data.timestamp)
              : new Date();

          return {
            timestamp: ts,
            totalValue: decryptedTotalValue,
            walletCount: decryptedWalletCount,
            tokenCount: decryptedTokenCount
          };
        } catch (decryptError) {
          console.error('decryption error for record:', doc.id, decryptError);
          return null;
        }
      })
      .filter(record => record !== null && record.totalValue > 0) as PortfolioHistory[];
    const sortedHistory = [...history].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    setCurrentPortfolioData(sortedHistory);
  } catch (err) {
    console.error('failed to load encrypted wallet history:', err);
  }
}, [publicKey]);

const bucketizeRecords = useCallback(
  (records: PortfolioHistory[], bucketMs: number, startTime: number, endTime: number): PortfolioHistory[] => {
    const buckets = new Map<number, { totalValue: number; walletCount: number; tokenCount: number; count: number }>();

    records.forEach((record) => {
      const ts = record.timestamp.getTime();
      if (ts < startTime || ts >= endTime) return;
      const bucketStart = Math.floor(ts / bucketMs) * bucketMs;
      const existing = buckets.get(bucketStart) || { totalValue: 0, walletCount: 0, tokenCount: 0, count: 0 };
      buckets.set(bucketStart, {
        totalValue: existing.totalValue + record.totalValue,
        walletCount: existing.walletCount + record.walletCount,
        tokenCount: existing.tokenCount + record.tokenCount,
        count: existing.count + 1,
      });
    });

    return Array.from(buckets.entries()).map(([bucketStart, agg]) => ({
      timestamp: new Date(bucketStart),
      totalValue: agg.totalValue / agg.count,
      walletCount: Math.round(agg.walletCount / agg.count),
      tokenCount: Math.round(agg.tokenCount / agg.count),
    }));
  },
  [],
);

const cleanupPortfolioHistory = useCallback(async () => {
  if (!publicKey) return;

  const nowMs = Date.now();
  const throttleMs = 60000; // avoid hammering Firestore on rapid consecutive writes
  if (nowMs - lastCleanupRun.current < throttleMs) {
    return;
  }

  const anonymizedKey = encryptionService.anonymizePublicKey(publicKey.toString());
  const recordsRef = collection(db, 'wallet-history', anonymizedKey, 'records');
  const snapshot = await getDocs(query(recordsRef, orderBy('timestamp', 'asc')));

  if (snapshot.empty) {
    lastCleanupRun.current = nowMs;
    return;
  }

  const decryptedRecords: PortfolioHistory[] = [];

  snapshot.forEach((docSnap) => {
    const data = docSnap.data() as {
      encryptedData?: {
        totalValue: string;
        walletCount: string;
        tokenCount: string;
      };
      timestamp?: Timestamp;
    };

    if (!data.encryptedData) return;

    try {
      const totalValue = encryptionService.decryptData<number>(data.encryptedData.totalValue, publicKey.toString());
      const walletCount = encryptionService.decryptData<number>(data.encryptedData.walletCount, publicKey.toString());
      const tokenCount = encryptionService.decryptData<number>(data.encryptedData.tokenCount, publicKey.toString());

      if (totalValue === null || walletCount === null || tokenCount === null) return;

      const ts = data.timestamp instanceof Timestamp
        ? data.timestamp.toDate()
        : data.timestamp
          ? new Date(data.timestamp)
          : new Date();

      decryptedRecords.push({
        timestamp: ts,
        totalValue,
        walletCount,
        tokenCount,
      });
    } catch (err) {
      console.error('cleanup decrypt error:', err);
    }
  });

  if (decryptedRecords.length === 0) {
    lastCleanupRun.current = nowMs;
    return;
  }

  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;

  const recentCutoff = nowMs - hourMs; // keep 30-second granularity within the last hour
  const weekCutoff = nowMs - weekMs;
  const monthCutoff = nowMs - monthMs;

  const recentRecords = decryptedRecords.filter((r) => r.timestamp.getTime() >= recentCutoff);
  const minuteReduced = bucketizeRecords(decryptedRecords, 60_000, weekCutoff, recentCutoff); // 1 per minute for >1h to 1w
  const hourlyReduced = bucketizeRecords(decryptedRecords, 60 * 60 * 1000, monthCutoff, weekCutoff); // 1 per hour for >1w to 1m
  const multiDayReduced = bucketizeRecords(decryptedRecords, 4 * dayMs, 0, monthCutoff); // 1 per 4 days for >1m

  const finalRecords = [...multiDayReduced, ...hourlyReduced, ...minuteReduced, ...recentRecords]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const batch = writeBatch(db);
  snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));

  finalRecords.forEach((record) => {
    const encryptedData = {
      totalValue: encryptionService.encryptData(record.totalValue, publicKey.toString()),
      walletCount: encryptionService.encryptData(record.walletCount, publicKey.toString()),
      tokenCount: encryptionService.encryptData(record.tokenCount, publicKey.toString()),
      randomField1: encryptionService.generateRandomEncrypted(publicKey.toString()),
      randomField2: encryptionService.generateRandomEncrypted(publicKey.toString()),
    };

    const docRef = doc(collection(db, 'wallet-history', anonymizedKey, 'records'));
    const bucketSizeMs = record.timestamp.getTime() < monthCutoff
      ? 4 * dayMs
      : record.timestamp.getTime() < weekCutoff
        ? 60 * 60 * 1000
        : record.timestamp.getTime() < recentCutoff
          ? 60_000
          : 30_000;

    batch.set(docRef, {
      timestamp: Timestamp.fromDate(record.timestamp),
      publicKey: publicKey.toString(),
      encryptedData,
      metadata: {
        hasData: true,
        recordCount: 1,
        version: '1.1',
        bucketSizeMs,
      },
    });
  });

  await batch.commit();
  lastCleanupRun.current = Date.now();
}, [publicKey, bucketizeRecords]);

const savePortfolioHistory = useCallback(async (totalValue: number, walletCount: number, tokenCount: number) => {
  if (!publicKey) {
    console.error('no public key - cannot save wallet history');
    return;
  }

  if (totalValue <= 0) {
    return;
  }

  try {
    const anonymizedKey = encryptionService.anonymizePublicKey(publicKey.toString());
    const encryptedData = {
      totalValue: encryptionService.encryptData(totalValue, publicKey.toString()),
      walletCount: encryptionService.encryptData(walletCount, publicKey.toString()),
      tokenCount: encryptionService.encryptData(tokenCount, publicKey.toString()),
      randomField1: encryptionService.generateRandomEncrypted(publicKey.toString()),
      randomField2: encryptionService.generateRandomEncrypted(publicKey.toString()),
    };

    const historyData = {
      timestamp: Timestamp.fromDate(new Date()),
      publicKey: publicKey.toString(),
      encryptedData: encryptedData,
      metadata: {
        hasData: true,
        recordCount: tokenCount > 0 ? 1 : 0,
        version: '1.1'
      }
    };

    const historyRef = doc(collection(db, 'wallet-history', anonymizedKey, 'records'));
    await setDoc(historyRef, historyData);

    const now = Date.now();
    if (now - lastHistoryUiUpdate.current > 30000) {
      setCurrentPortfolioData(prev => [
        ...prev,
        {
          timestamp: historyData.timestamp.toDate(),
          totalValue: totalValue,
          walletCount: walletCount,
          tokenCount: tokenCount
        }
      ]);
      lastHistoryUiUpdate.current = now;
    }

    await cleanupPortfolioHistory();

  } catch (error) {
    console.error('failed to save encrypted wallet history:', error);
  }
}, [publicKey, cleanupPortfolioHistory]);

  useEffect(() => {
    if (connected && publicKey) {
      loadPortfolioHistory();
    } else {
      setCurrentPortfolioData([]);
    }
  }, [connected, publicKey, loadPortfolioHistory]);

  const fetchTokenBalances = useCallback(async () => {
  if (!publicKey) return;
  
  setLoading(true);
  setError('');
  setProcessingProgress(0);
  setTotalToProcess(0);
  
  try {
    const tokenBalances = await tokenService.getTokenBalances(publicKey.toString());

    const tokensWithBalance = tokenBalances.filter(token => token.uiAmount > 0);
    setTotalToProcess(tokensWithBalance.length);
    
    const tokensWithPrices = await tokenService.getTokenPrices(
      tokensWithBalance,
      (progress: PriceProgress) => {
        setProcessingProgress(progress.current);
        setTotalToProcess(progress.total);
      }
    );

    setTokens(tokensWithPrices);
    isInitialLoad.current = false;
    
    const totalValue = tokensWithPrices.reduce((sum, token) => sum + (token.value || 0), 0);
    if (totalValue > 0) {
      await savePortfolioHistory(totalValue, 1, tokensWithPrices.length);
    }
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Page] Error fetching tokens:', errorMsg);
    setError(errorMsg);
  } finally {
    setLoading(false);
  }
}, [publicKey, tokenService, savePortfolioHistory]);

  const handleRefreshPrices = useCallback(async () => {
  if (!publicKey || tokens.length === 0) return;
  
  setLoading(true);
  setProcessingProgress(0);
  setError('');
  
  try {
    const tokensWithPositiveBalance = tokens.filter(token => token.uiAmount > 0);
    setTotalToProcess(tokensWithPositiveBalance.length);
    
    const refreshedTokens = await tokenService.getTokenPrices(
      tokensWithPositiveBalance,
      (progress: PriceProgress) => {
        setProcessingProgress(progress.current);
      }
    );
    
    const newTokens = tokens.map(token => {
      const refreshedToken = refreshedTokens.find(t => t.mint === token.mint);
      return refreshedToken || token;
    });
    
    const mints = new Set<string>();
    refreshedTokens.forEach(token => {
      const oldToken = tokens.find(t => t.mint === token.mint);
      if (oldToken && oldToken.price !== token.price) {
        mints.add(token.mint);
      }
    });
    
    setTokens(newTokens);
    setUpdatedTokens(mints);
    
    setTimeout(() => {
      setUpdatedTokens(new Set());
    }, 800);
    
    const totalValue = newTokens.reduce((sum, token) => sum + (token.value || 0), 0);
    
    if (totalValue > 0) {
      await savePortfolioHistory(totalValue, 1, newTokens.length);
    }
    
  } catch (err) {
    console.error('error refreshing prices:', err);
    setError('failed to refresh prices');
  } finally {
    setLoading(false);
  }
}, [publicKey, tokens, tokenService, savePortfolioHistory]);

  useEffect(() => {
    if (connected) {
      fetchTokenBalances();
    } else {
      setTokens([]);
      setLoading(false);
      setProcessingProgress(0);
      setTotalToProcess(0);
    }
  }, [connected, fetchTokenBalances]);

  const tokenMints = useMemo(() => {
    return tokens
      .filter(token => token.uiAmount > 0)
      .map(token => token.mint)
      .sort();
  }, [tokens]);

  const tokenMintsKey = tokenMints.join(',');

  useEffect(() => {
    if (!publicKey || tokenMints.length === 0 || subscriptionsSetup.current) {
      return;
    }

    subscriptionsSetup.current = true;

    const unsubscribeCallbacks: (() => void)[] = [];

    tokenMints.forEach(mint => {
      const unsubscribe = tokenService.subscribeToPriceUpdates(mint, (priceUpdate) => {
        setTokens(prev => {
          return prev.map(token =>
            token.mint === priceUpdate.mint
              ? {
                  ...token,
                  price: priceUpdate.price || 0,
                  value: (priceUpdate.price || 0) * token.uiAmount,
                  changePercent24h: priceUpdate.changePercent24h,
                  lastUpdated: priceUpdate.lastUpdated
                }
              : token
          );
        });

        setUpdatedTokens(prev => {
          const newSet = new Set(prev);
          newSet.add(priceUpdate.mint);
          return newSet;
        });

        setTimeout(() => {
          setUpdatedTokens(prev => {
            const next = new Set(prev);
            next.delete(priceUpdate.mint);
            return next;
          });
        }, 800);

        const now = Date.now();
        if (now - lastFirestoreWrite.current > 30000) {
          lastFirestoreWrite.current = now;
          setTokens(currentTokens => {
            const totalValue = currentTokens.reduce((sum, token) => sum + (token.value || 0), 0);
            if (totalValue > 0) {
              savePortfolioHistory(totalValue, 1, currentTokens.length).catch(err =>
                console.error('Failed to save portfolio history:', err)
              );
            }
            return currentTokens;
          });
        }
      });

      unsubscribeCallbacks.push(unsubscribe);
    });

    return () => {
      unsubscribeCallbacks.forEach(unsub => unsub());
      subscriptionsSetup.current = false;
    };
  }, [publicKey, tokenMintsKey, tokenMints.length, tokenService, savePortfolioHistory]);

  const handleTokenSelect = (mint: string, selected: boolean) => {
    setTokens(prev => prev.map(token => 
      token.mint === mint ? { ...token, selected } : token
    ));
  };

  const handleSelectAll = (selected: boolean) => {
    setTokens(prev => prev.map(token => ({ ...token, selected })));
  };

  const selectedTokens = tokens.filter(token => token.selected);
  const totalSelectedValue = selectedTokens.reduce((sum, token) => sum + (token.value || 0), 0);
  const [selectedOutputToken, setSelectedOutputToken] = useState<string>('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

  const handleSwapComplete = async () => {
    if (!publicKey) return;
    
    try {
      const tokenBalances = await tokenService.getTokenBalances(publicKey.toString());
      const tokensWithBalance = tokenBalances.filter(token => token.uiAmount > 0);
      
      const tokensWithPrices = await tokenService.getTokenPrices(
        tokensWithBalance,
        () => {}
      );

      setTokens(tokensWithPrices);
      
      const totalValue = tokensWithPrices.reduce((sum, token) => sum + (token.value || 0), 0);
      if (totalValue > 0) {
        await savePortfolioHistory(totalValue, 1, tokensWithPrices.length);
      }
    } catch (err) {
      console.error('silent token refresh failed:', err);
    }
  };

  const handleOutputTokenChange = (mint: string) => {
    setSelectedOutputToken(mint);
  };

  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const memoPortfolioHistory = useMemo(() => currentPortfolioData, [currentPortfolioData]);

  const livePortfolioValue = useMemo(() => {
    return tokens.reduce((sum, token) => sum + (token.value || 0), 0);
  }, [tokens]);

  const renderMainView = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 sm:gap-4 md:gap-8 relative z-10">
      <div className="lg:col-span-2 order-2 lg:order-1 mb-0 sm:mb-0">
        <div className="card p-4 sm:p-6 relative z-10">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 sm:mb-6 space-y-3 sm:space-y-0">
            <h2 className="text-l sm:text-xl font-semibold flex items-center space-x-2 text-orange-primary">
              <Wallet className="h-4 w-4 sm:h-5 sm:w-5 ml-3" />
              <span>portfolio</span>
            </h2>
            
            <div className="flex items-center justify-between sm:justify-end space-x-2 sm:space-x-4">
              <div className="flex space-x-2">
                <button
                  onClick={() => handleSelectAll(true)}
                  className="text-s sm:text-l text-secondary hover:text-primary transition-colors px-2 py-1 cursor-pointer"
                >
                  select all
                </button>
                <button
                  onClick={() => handleSelectAll(false)}
                  className="text-s sm:text-l text-secondary hover:text-primary transition-colors px-2 py-1 cursor-pointer"
                >
                  clear all
                </button>
              </div>
              <button
                onClick={fetchTokenBalances}
                disabled={loading}
                className="btn-primary text-xs sm:text-l px-2 sm:px-3 py-1  disabled:opacity-50 whitespace-nowrap mr-2"
              >
                {loading ? (
                  <div className="flex items-center space-x-2">
                    <span className="loading-dot-spinner" />
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <RefreshCw className="h-4 w-4" />
                  </div>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3  text-l" style={{ background: 'var(--orange-glow)', border: '1px solid var(--border-error)', color: 'var(--text-primary)' }}>
              {error}
            </div>
          )}

          <TokenTable
          tokens={tokens}
          loading={loading}
          onTokenSelect={handleTokenSelect}
          onSelectAll={handleSelectAll}
          selectedTokens={selectedTokens}
          totalSelectedValue={totalSelectedValue}
          onRefreshPrices={handleRefreshPrices}
          processingProgress={processingProgress}
          totalToProcess={totalToProcess}
          portfolioHistory={memoPortfolioHistory}
          excludeTokenMint={selectedOutputToken}
          updatedTokens={updatedTokens}
        />
        </div>
      </div>

      <div className="lg:col-span-1 order-1 lg:order-2 mb-0 sm:mb-0">
        <SwapInterface
          selectedTokens={selectedTokens}
          totalSelectedValue={totalSelectedValue}
          allTokens={tokens}
          onSwapComplete={handleSwapComplete}
          onOutputTokenChange={handleOutputTokenChange}
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)', width: '100vw', overflowX: 'hidden' }}>
      <div style={{ width: '100%', maxWidth: '100%' }}>
        <header className="card flex flex-col md:flex-row justify-between items-center mb-6 p-3 shadow-lg" style={{ background: 'var(--bg-secondary)', margin: 0, width: '100%', overflow: 'visible' }}>
          {/* Logo and Title */}
          <div className="flex items-center space-x-3 flex-shrink-0">
            <div className="relative">
              <Image
                src={"/soloswap.png"}
                alt="soloswap logo"
                width={40}
                height={40}
                className="h-8 w-8 sm:h-10 sm:w-10 drop-shadow-lg"
              />
              <div className="absolute inset-0 opacity-20 blur-sm" style={{ background: 'linear-gradient(135deg, var(--orange-primary), var(--bg-primary))' }} />
            </div>
            <h1 className="text-xl sm:text-3xl font-bold text-orange-primary tracking-tight">
              solo:
            </h1>
          </div>
          
          {/* Desktop Navigation - Right Side */}
          <nav className="hidden md:grid md:grid-cols-3 items-center flex-shrink-0" style={{ gap: '1rem', width: 'auto', overflow: 'visible' }}>
            {currentView === 'main' && (
              <button
                onClick={() => setCurrentView('multisig')}
                className="btn-primary text-sm font-medium whitespace-nowrap"
                style={{ borderRadius: '0', height: '40px', padding: '0 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '0.5rem' }}
              >
                swap
              </button>
            )}
            
            {currentView === 'multisig' && (
              <button
                onClick={() => setCurrentView('main')}
                className="btn-primary text-sm font-medium whitespace-nowrap"
                style={{ borderRadius: '0', height: '40px', padding: '0 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '0.5rem' }}
              >
                shop
              </button>
            )}

            <div className="flex justify-center" style={{ marginRight: '2rem' }}>
              <ThemeToggle />
            </div>

            <div className="wallet-button-wrapper" style={{ maxWidth: '140px', minHeight: '40px', pointerEvents: 'auto', position: 'relative', marginRight: '0.5rem' }}>
              <WalletMultiButton />
            </div>
          </nav>

          {/* Mobile Navigation */}
          <div className="md:hidden grid grid-cols-3 items-center gap-2 flex-shrink-0">
            {currentView === 'main' ? (
              <button
                onClick={() => setCurrentView('multisig')}
                className="btn-primary px-3 py-2 text-xs font-medium whitespace-nowrap"
                style={{ borderRadius: '0' }}
              >
                swap
              </button>
            ) : (
              <button
                onClick={() => setCurrentView('main')}
                className="btn-primary px-3 py-2 text-xs font-medium whitespace-nowrap"
                style={{ borderRadius: '0' }}
              >
                shop
              </button>
            )}

            <div className="flex justify-center">
              <ThemeToggle />
            </div>

            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="p-2 transition-all duration-300" 
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', borderRadius: '0', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {showMobileMenu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </header>

        {showMobileMenu && (
          <div className="card mb-6 p-4 shadow-lg md:hidden">
            <div className="flex flex-col space-y-4">
              <div className="mobile-wallet-button w-full" style={{ pointerEvents: 'auto' }}>
                <WalletMultiButton />
              </div>
            </div>
          </div>
        )}

        <main className="mb-8 px-0 sm:px-4 md:px-6" style={{ width: '100%' }}>
          {currentView === 'main' ? renderMainView() : (
            <MultisigAnalyzer onBack={() => setCurrentView('main')} />
          )}

          {currentView === 'main' && (
            <div className="mt-0 sm:mt-8 space-y-0 sm:space-y-6">
              <SwapHistoryPanel />
              {/* <HistoricalPortfolio /> */}
            </div>
          )}
        </main>

        <footer className="mt-8 pt-6 px-0 sm:px-4 md:px-6" style={{ borderTop: '1px solid var(--border-primary)', width: '100%' }}>
            <div className="flex justify-center items-center space-x-8">
              <a
                href="https://twitter.com/soloexplorerxyz"
                target="_blank"
                rel="noopener noreferrer"
                className="group p-3  transition-all duration-300 active:scale-95" 
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}
                aria-label="Follow on Twitter"
              >
                <svg 
                  className="w-5 h-5 group-hover:scale-110 transition-all duration-300" 
                  style={{ color: 'var(--text-secondary)' }}
                  fill="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path d="M23 3a10.9 10.9 0 0 1-3.14 1.53A4.48 4.48 0 0 0 12.2 7.49v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z" />
                </svg>
              </a>
              
              <a
                href="https://github.com/ilovespectra/solo-swap-v2"
                target="_blank"
                rel="noopener noreferrer"
                className="group p-3  transition-all duration-300 active:scale-95"
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}
                aria-label="View on GitHub"
              >
                <svg 
                  className="w-5 h-5 group-hover:scale-110 transition-all duration-300" 
                  style={{ color: 'var(--text-secondary)' }}
                  fill="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path 
                    fillRule="evenodd" 
                    clipRule="evenodd" 
                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.838 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.033 1.531 1.033.892 1.53 2.341 1.088 2.91.833.092-.647.35-1.088.636-1.338-2.22-.252-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.27.098-2.646 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.748-1.027 2.748-1.027.545 1.377.202 2.394.1 2.647.64.7 1.028 1.595 1.028 2.688 0 3.847-2.339 4.696-4.566 4.944.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"
                  />
                </svg>
              </a>
            </div>
          </footer>
      </div>
    </div>
  );
}
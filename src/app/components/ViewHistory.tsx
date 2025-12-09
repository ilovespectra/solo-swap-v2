'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { 
  collection, query, orderBy, getDocs, deleteDoc, doc, Timestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { encryptionService } from '../lib/encryption';
import { Trash2, Calendar, DollarSign, Wallet, Coins, Download, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';

interface PortfolioHistory {
  id?: string;
  timestamp: Date;
  totalValue: number;
  walletCount: number;
  tokenCount: number;
}

interface HistoricalPortfolioProps {
  onPortfolioSelect?: (portfolio: PortfolioHistory) => void;
  currentPortfolioValue?: number;
  mode?: 'single' | 'multisig';
  portfolioHistory?: Array<Omit<PortfolioHistory, 'id'> & { id?: string }>;
}

export function HistoricalPortfolio({ 
  onPortfolioSelect, 
  currentPortfolioValue, 
  mode = 'single',
  portfolioHistory: providedPortfolioHistory
}: HistoricalPortfolioProps) {
  const { publicKey } = useWallet();
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selectedPortfolio, setSelectedPortfolio] = useState<PortfolioHistory | null>(null);

  useEffect(() => {
    if (providedPortfolioHistory) {
      const normalized = providedPortfolioHistory.map((record, index) => ({
        ...record,
        id: record.id || `local-${index}-${record.timestamp.getTime()}`
      }));
      setPortfolioHistory(normalized);
      setLoading(false);
    }
  }, [providedPortfolioHistory]);

  useEffect(() => {
    if (publicKey && expanded && !providedPortfolioHistory) {
      loadPortfolioHistory();
    }
  }, [publicKey, expanded, mode, providedPortfolioHistory]);

  const getCollectionPath = () => {
    if (!publicKey) return '';
    
    const anonymizedKey = encryptionService.anonymizePublicKey(publicKey.toString());
    
    return mode === 'multisig' 
        ? `solo-users/${anonymizedKey}/portfolioHistory`
        : `wallet-history/${anonymizedKey}/records`;
    };

  const loadPortfolioHistory = async () => {
    if (!publicKey) return;

    try {
      setLoading(true);
      
      const collectionPath = getCollectionPath();
      
      const historyQuery = query(
        collection(db, collectionPath),
        orderBy('timestamp', 'desc')
      );
      const querySnapshot = await getDocs(historyQuery);
      
      const history: PortfolioHistory[] = [];
      let decryptionErrors = 0;
      let successfulDecryptions = 0;

      for (const doc of querySnapshot.docs) {
        const data = doc.data();
        
        if (!data.encryptedData) {
          continue;
        }

        try {
          let decryptedData;
          
          if (mode === 'multisig') {
            decryptedData = encryptionService.decryptPortfolioHistory(
              data.encryptedData, 
              publicKey.toString()
            );
          } else {
            const decryptedTotalValue = encryptionService.decryptData<number>(
              data.encryptedData.totalValue, 
              publicKey.toString()
            );
            const decryptedWalletCount = encryptionService.decryptData<number>(
              data.encryptedData.walletCount, 
              publicKey.toString()
            );
            const decryptedTokenCount = encryptionService.decryptData<number>(
              data.encryptedData.tokenCount, 
              publicKey.toString()
            );

            if (decryptedTotalValue === null || decryptedWalletCount === null || decryptedTokenCount === null) {
              continue;
            }

            decryptedData = {
              timestamp: data.timestamp?.toDate() || new Date(),
              totalValue: decryptedTotalValue,
              walletCount: decryptedWalletCount,
              tokenCount: decryptedTokenCount
            };
          }

          if (decryptedData) {
            history.push({
              id: doc.id,
              timestamp: decryptedData.timestamp,
              totalValue: decryptedData.totalValue,
              walletCount: decryptedData.walletCount,
              tokenCount: decryptedData.tokenCount
            });
            successfulDecryptions++;
          } else {
            decryptionErrors++;
          }
        } catch (decryptError) {
          console.error('decryption error for record:', doc.id, decryptError);
          decryptionErrors++;
        }
      }

      setPortfolioHistory(history);
      
    } catch (err) {
      console.error(`failed to load ${mode} portfolio history:`, err);
    } finally {
      setLoading(false);
    }
  };

  const deletePortfolioRecord = async (portfolioId?: string) => {
    if (!publicKey || !portfolioId) return;

    try {
      setDeletingId(portfolioId);
      const collectionPath = getCollectionPath();
      
      await deleteDoc(doc(db, collectionPath, portfolioId));
      
      setPortfolioHistory(prev => prev.filter(record => record.id !== portfolioId));
      
      if (selectedPortfolio?.id === portfolioId) {
        setSelectedPortfolio(null);
        if (onPortfolioSelect) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onPortfolioSelect(null as any);
        }
      }
    } catch (err) {
      console.error('failed to delete portfolio record:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handlePortfolioSelect = (portfolio: PortfolioHistory) => {
    setSelectedPortfolio(portfolio);
    if (onPortfolioSelect) {
      onPortfolioSelect(portfolio);
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const downloadHistoryAsCSV = () => {
    if (portfolioHistory.length === 0) return;

    const headers = ['date', 'total value', 'wallets', 'tokens'];
    const csvData = portfolioHistory.map(record => [
      record.timestamp.toISOString(),
      record.totalValue.toString(),
      record.walletCount.toString(),
      record.tokenCount.toString()
    ]);

    const csvContent = [headers, ...csvData]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio-history-${mode}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const calculateChange = (historicalValue: number) => {
    if (!currentPortfolioValue || currentPortfolioValue === 0) return 0;
    return ((currentPortfolioValue - historicalValue) / historicalValue) * 100;
  };

  if (!publicKey) {
    return (
      <div className="bg-gray-800/50 rounded-xl backdrop-blur-sm border border-gray-700 p-6 mt-6">
        <div className="text-center text-gray-400">
          <Wallet className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>connect your wallet to view portfolio history</p>
        </div>
      </div>
    );
  }

  return (
  <div className="bg-gray-800/30 backdrop-blur-sm rounded-2xl border border-gray-700/30 shadow-xl mt-6 overflow-hidden">
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full flex items-center justify-between p-6 text-left hover:bg-gray-700/40 transition-all duration-200 rounded-2xl mobile-optimized group"
    >
      <div className="flex items-center space-x-4">
        <div className="p-2 bg-gradient-to-br from-gray-500/20 to-gray-500/20 rounded-xl border border-gray-500/30">
          <Calendar className="h-5 w-5 sm:h-6 sm:w-6 text-gray-400" />
        </div>
        <div>
          <h3 className="text-base sm:text-l font-bold text-white">records</h3>
          <p className="text-xs sm:text-l text-gray-400 mt-1 lowercase">({mode})</p>
        </div>
      </div>
      <div className="flex items-center space-x-3">
        {portfolioHistory.length > 0 && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              downloadHistoryAsCSV();
            }}
            className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-black-600/80 to-gray-800/80 hover:from-gray-500 hover:to-gray-400 border border-gray-500/50 rounded-xl transition-all duration-200 transform hover:scale-[1.02] active:scale-95 text-xs sm:text-l font-medium text-white shadow-lg hover:shadow-gray-500/25 cursor-pointer"
          >
            <Download className="h-3 w-3 sm:h-4 sm:w-4" />
          </div>
        )}
        {expanded ? (
          <ChevronDown className="h-5 w-5 sm:h-6 sm:w-6 text-gray-400 group-hover:text-white transition-transform duration-200" />
        ) : (
          <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6 text-gray-400 group-hover:text-white transition-transform duration-200" />
        )}
      </div>
    </button>
    
    {expanded && (
      <div className="px-6 pb-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-500 mx-auto mb-4"></div>
            <p className="text-gray-400 text-l font-medium">loading {mode} history...</p>
          </div>
        ) : portfolioHistory.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 bg-gray-700/50 rounded-2xl flex items-center justify-center">
              <Calendar className="h-8 w-8 sm:h-10 sm:w-10 text-gray-400" />
            </div>
            <p className="text-gray-400 text-l sm:text-base font-medium">no {mode} history available yet</p>
            <p className="text-gray-500 text-xs sm:text-l mt-2">analyze your wallets to generate historical data</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-gray-500/10 to-gray-500/10 border border-gray-500/30 rounded-xl p-4 sm:p-5 backdrop-blur-sm">
                <div className="flex items-center space-x-3 mb-3">
                  <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
                  <span className="text-xs sm:text-l font-semibold text-gray-200">first record</span>
                </div>
                <div className="text-lg sm:text-xl font-bold text-gray-400 lowercase">
                  {formatDate(portfolioHistory[portfolioHistory.length - 1].timestamp)}
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-gray-500/10 to-gray-500/10 border border-gray-500/30 rounded-xl p-4 sm:p-5 backdrop-blur-sm">
                <div className="flex items-center space-x-3 mb-3">
                  <DollarSign className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
                  <span className="text-xs sm:text-l font-semibold text-gray-200">average value</span>
                </div>
                <div className="text-lg sm:text-xl font-bold text-gray-400">
                  {formatCurrency(
                    portfolioHistory.reduce((sum, record) => sum + record.totalValue, 0) / portfolioHistory.length
                  )}
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-gray-500/10 to-gray-500/10 border border-gray-500/30 rounded-xl p-4 sm:p-5 backdrop-blur-sm">
                <div className="flex items-center space-x-3 mb-3">
                  <Wallet className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
                  <span className="text-xs sm:text-l font-semibold text-gray-200">total snapshots</span>
                </div>
                <div className="text-lg sm:text-xl font-bold text-gray-400">
                  {portfolioHistory.length}
                </div>
              </div>
            </div>

            {/* Portfolio History List */}
            <div className="space-y-3 max-h-96 overflow-y-auto mobile-scroll pr-2 -mr-2">
              {portfolioHistory.map((portfolio, index) => {
                const change = calculateChange(portfolio.totalValue);
                const isSelected = selectedPortfolio?.id === portfolio.id;
                
                return (
                  <div
                    key={portfolio.id ?? `record-${index}`}
                    className={`p-4 sm:p-5 rounded-xl border transition-all duration-200 cursor-pointer group ${
                      isSelected
                        ? 'bg-gradient-to-r from-gray-500/20 to-gray-500/20 border-gray-500/50 shadow-lg shadow-gray-500/20'
                        : 'bg-gray-700/30 border-gray-600/50 hover:bg-gray-700/50 hover:border-gray-500/50'
                    }`}
                    onClick={() => handlePortfolioSelect(portfolio)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4 flex-1 min-w-0">
                        <div className="flex-shrink-0">
                          <div className={`w-3 h-3 rounded-full transition-all duration-200 ${
                            isSelected 
                              ? 'bg-gradient-to-r from-gray-400 to-gray-400 shadow-lg shadow-gray-400/50' 
                              : 'bg-gray-500 group-hover:bg-gray-400'
                          }`} />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-3 mb-2">
                            <span className="font-semibold text-l sm:text-base text-white lowercase truncate">
                              {formatDate(portfolio.timestamp)}
                            </span>
                            {currentPortfolioValue && (
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                change >= 0 
                                  ? 'bg-gray-500/20 text-gray-400 border border-gray-500/30' 
                                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
                              }`}>
                                {change >= 0 ? '↗' : '↘'} {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                              </span>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-4 sm:space-x-6 text-xs text-gray-400">
                            <div className="flex items-center space-x-2">
                              <DollarSign className="h-3 w-3 sm:h-4 sm:w-4" />
                              <span className="font-mono">{formatCurrency(portfolio.totalValue)}</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Wallet className="h-3 w-3 sm:h-4 sm:w-4" />
                              <span>{portfolio.walletCount} wallet{portfolio.walletCount !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Coins className="h-3 w-3 sm:h-4 sm:w-4" />
                              <span>{portfolio.tokenCount} token{portfolio.tokenCount !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-3 ml-4 flex-shrink-0">
                        {isSelected ? (
                          <Eye className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
                        ) : (
                          <EyeOff className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 group-hover:text-gray-300" />
                        )}
                        
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePortfolioRecord(portfolio.id);
                          }}
                          disabled={!portfolio.id || deletingId === portfolio.id}
                          className="text-red-400 hover:text-red-300 transition-all duration-200 p-2 hover:bg-red-500/20 rounded-lg disabled:opacity-50 mobile-optimized"
                        >
                          {deletingId === portfolio.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-400"></div>
                          ) : (
                            <Trash2 className="h-4 w-4 sm:h-5 sm:w-5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected Portfolio Details */}
            {selectedPortfolio && (
              <div className="mt-6 p-5 bg-gradient-to-r from-gray-500/15 to-gray-500/15 border border-gray-500/30 rounded-xl backdrop-blur-sm">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-lg text-gray-400 flex items-center space-x-2">
                    <Eye className="h-5 w-5" />
                    <span>selected snapshot</span>
                  </h4>
                  <button
                    onClick={() => {
                      setSelectedPortfolio(null);
                      if (onPortfolioSelect) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        onPortfolioSelect(null as any);
                      }
                    }}
                    className="text-xs text-gray-400 hover:text-gray-300 px-3 py-1 bg-gray-700/50 hover:bg-gray-600/50 rounded-lg transition-all duration-200"
                  >
                    clear selection
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 text-l">
                  <div>
                    <div className="text-gray-400 text-xs font-medium mb-1">date recorded</div>
                    <div className="text-white font-semibold lowercase">{formatDate(selectedPortfolio.timestamp)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs font-medium mb-1">total portfolio value</div>
                    <div className="text-gray-400 font-bold text-lg">
                      {formatCurrency(selectedPortfolio.totalValue)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs font-medium mb-1">assets tracked</div>
                    <div className="text-white font-semibold">
                      {selectedPortfolio.walletCount} wallet{selectedPortfolio.walletCount !== 1 ? 's' : ''} • {selectedPortfolio.tokenCount} token{selectedPortfolio.tokenCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )}
  </div>
);
}
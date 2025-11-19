'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import { TokenBalance } from '../types/token';
import { TokenService } from '../lib/api';
import { Search, ExternalLink, Calculator, Copy, CheckCircle, AlertCircle, Wallet, Download, ArrowUpDown, ChevronUp, ChevronDown, HelpCircle } from 'lucide-react';

interface MultisigAnalyzerProps {
  onBack: () => void;
}

interface AnalysisResult {
  tokens: TokenBalance[];
  totalValue: number;
  walletAddress: string;
  isDomain: boolean;
}

type SortField = 'symbol' | 'balance' | 'value' | 'percentage';
type SortDirection = 'asc' | 'desc';

interface SortIconProps {
  field: SortField;
  sortField: SortField;
  sortDirection: SortDirection;
}

const SortIcon = ({ field, sortField, sortDirection }: SortIconProps) => {
  if (sortField !== field) {
    return <ArrowUpDown className="h-3 w-3 text-gray-400" />;
  }
  
  return sortDirection === 'asc' 
    ? <ChevronUp className="h-3 w-3 text-purple-400" />
    : <ChevronDown className="h-3 w-3 text-purple-400" />;
};

export function MultisigAnalyzer({ onBack }: MultisigAnalyzerProps) {
  const { connection } = useConnection();
  const [walletInput, setWalletInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [sortField, setSortField] = useState<SortField>('value');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [liquidationAmount, setLiquidationAmount] = useState<string>('');
  const [liquidationType, setLiquidationType] = useState<'dollar' | 'percentage'>('percentage');
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [showHelp, setShowHelp] = useState(false);
  
  const selectAllRef = useRef<HTMLInputElement>(null);

  const tokenService = new TokenService();

  const SNS_DOMAINS = ['.sol', '.bonk', '.poor', '.ser', '.abc', '.backpack', '.crown', '.gogo', '.hodl', '.meme', '.monke', '.oon', '.ponke', '.pump', '.shark', '.snipe', '.turtle', '.wallet', '.whale', '.worker', '.00', '.inv', '.ux', '.ray', '.luv'];

  useEffect(() => {
    if (selectAllRef.current && result) {
      const allSelected = selectedTokens.size === result.tokens.length;
      const someSelected = selectedTokens.size > 0 && selectedTokens.size < result.tokens.length;
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [selectedTokens, result]);

  const resolveDomain = async (domain: string): Promise<string> => {
    try {
      const cleanDomain = domain.replace('@', '').toLowerCase();
      
      const response = await fetch(`https://sns-sdk-proxy.jup.ag/resolve/${cleanDomain}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data?.address) {
          console.log(`✅ resolved ${cleanDomain} to: ${data.address}`);
          return data.address;
        }
      }
      
      throw new Error(`could not resolve domain: ${cleanDomain}`);
    } catch (err) {
      console.error('domain resolution failed:', err);
      throw new Error(`failed to resolve domain: ${domain}`);
    }
  };

  const validateWalletAddress = (address: string): boolean => {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  };

  const isDomain = (input: string): boolean => {
    const cleanInput = input.toLowerCase().replace('@', '');
    return SNS_DOMAINS.some(domain => cleanInput.endsWith(domain));
  };

  const analyzeWallet = async () => {
    if (!walletInput.trim()) {
      setError('please enter a wallet address or domain');
      return;
    }

    setAnalyzing(true);
    setError('');
    setResult(null);
    setLiquidationAmount('');
    setSelectedTokens(new Set());

    try {
      let walletAddress = walletInput.trim();

      if (isDomain(walletAddress)) {
        walletAddress = await resolveDomain(walletAddress);
      }

      if (!validateWalletAddress(walletAddress)) {
        throw new Error('invalid wallet address');
      }

      console.log('🔍 analyzing wallet:', walletAddress);

      let tokenBalances = await tokenService.getTokenBalances(walletAddress);
      tokenBalances = await tokenService.getTokenPrices(tokenBalances);

      const valuableTokens = tokenBalances.filter(token => 
        (token.value || 0) > 0.01 && token.uiAmount > 0
      );

      const totalValue = valuableTokens.reduce((sum, token) => sum + (token.value || 0), 0);

      setResult({
        tokens: valuableTokens,
        totalValue,
        walletAddress,
        isDomain: isDomain(walletInput)
      });

      console.log('📊 analysis complete:', {
        tokens: valuableTokens.length,
        totalValue,
        walletAddress
      });

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'failed to analyze wallet';
      setError(errorMsg);
      console.error('❌ analysis error:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleTokenSelect = (mint: string) => {
    setSelectedTokens(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(mint)) {
        newSelected.delete(mint);
      } else {
        newSelected.add(mint);
      }
      return newSelected;
    });
  };

  const handleSelectAll = (select: boolean) => {
    if (!result) return;
    
    if (select) {
      setSelectedTokens(new Set(result.tokens.map(token => token.mint)));
    } else {
      setSelectedTokens(new Set());
    }
  };

  const allSelected = result ? selectedTokens.size === result.tokens.length : false;
  const someSelected = result ? selectedTokens.size > 0 && selectedTokens.size < result.tokens.length : false;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedTokens = useMemo(() => {
    if (!result) return [];

    const sorted = [...result.tokens].sort((a, b) => {
      const aPercentage = result.totalValue > 0 ? ((a.value || 0) / result.totalValue * 100) : 0;
      const bPercentage = result.totalValue > 0 ? ((b.value || 0) / result.totalValue * 100) : 0;

      let aValue: string | number = 0;
      let bValue: string | number = 0;

      switch (sortField) {
        case 'symbol':
          aValue = a.symbol.toLowerCase();
          bValue = b.symbol.toLowerCase();
          break;
        case 'balance':
          aValue = a.uiAmount;
          bValue = b.uiAmount;
          break;
        case 'value':
          aValue = a.value || 0;
          bValue = b.value || 0;
          break;
        case 'percentage':
          aValue = aPercentage;
          bValue = bPercentage;
          break;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return sortDirection === 'asc' 
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    return sorted;
  }, [result, sortField, sortDirection]);

  const selectedTokensValue = useMemo(() => {
    if (!result) return 0;
    return result.tokens
      .filter(token => selectedTokens.has(token.mint))
      .reduce((sum, token) => sum + (token.value || 0), 0);
  }, [result, selectedTokens]);

  const liquidationValue = useMemo(() => {
    if (!result || !liquidationAmount) return 0;
    
    const amount = parseFloat(liquidationAmount);
    if (isNaN(amount)) return 0;

    if (liquidationType === 'percentage') {
      return (selectedTokensValue * amount) / 100;
    } else {
      return Math.min(amount, selectedTokensValue);
    }
  }, [liquidationAmount, liquidationType, selectedTokensValue]);

  const calculateProRataAmounts = () => {
    if (!result || liquidationValue <= 0 || selectedTokens.size === 0) return [];

    const selectedTokenData = result.tokens.filter(token => selectedTokens.has(token.mint));
    
    return selectedTokenData.map(token => {
      const tokenValue = token.value || 0;
      const tokenPercentageOfSelected = selectedTokensValue > 0 ? tokenValue / selectedTokensValue : 0;
      
      const tokenLiquidationValue = liquidationValue * tokenPercentageOfSelected;
      const tokenPrice = token.price || 1;
      const tokenAmountToSwap = tokenPrice > 0 ? tokenLiquidationValue / tokenPrice : 0;
      
      const finalSwapAmount = Math.min(tokenAmountToSwap, token.uiAmount);
      
      return {
        ...token,
        swapAmount: finalSwapAmount,
        percentage: tokenPercentageOfSelected * 100,
        liquidationAmount: tokenLiquidationValue,
        originalAmount: token.uiAmount
      };
    });
  };

  const proRataTokens = calculateProRataAmounts();
  const hasLiquidation = liquidationValue > 0 && selectedTokens.size > 0;
  const remainingPortfolioValue = result ? result.totalValue - liquidationValue : 0;

  const generateShoppingList = () => {
    if (!result) return '';

    const header = `💰 pro-rata swap shopping list for ${walletInput}\n`;
    const summary = `total portfolio value: $${result.totalValue.toFixed(2)}\nselected tokens: ${selectedTokens.size}/${result.tokens.length}\nselected value: $${selectedTokensValue.toFixed(2)}\n\n`;
    
    let tokenList: string;
    
    if (hasLiquidation) {
      tokenList = proRataTokens.map(token => {
        const valuePercentage = selectedTokensValue > 0 ? ((token.value || 0) / selectedTokensValue * 100).toFixed(1) : '0';
        return `${token.symbol.padEnd(12)} | ${token.swapAmount.toFixed(6).padStart(12)} | $${token.liquidationAmount.toFixed(2).padStart(10)} | ${valuePercentage}%`;
      }).join('\n');
    } else {
      tokenList = sortedTokens
        .filter(token => selectedTokens.has(token.mint))
        .map(token => {
          const valuePercentage = selectedTokensValue > 0 ? ((token.value || 0) / selectedTokensValue * 100).toFixed(1) : '0';
          return `${token.symbol.padEnd(12)} | ${token.uiAmount.toFixed(6).padStart(12)} | $${(token.value || 0).toFixed(2).padStart(10)} | ${valuePercentage}%`;
        }).join('\n');
    }

    const liquidationInfo = hasLiquidation ? `\n💸 liquidation amount: $${liquidationValue.toFixed(2)} (${((liquidationValue / selectedTokensValue) * 100).toFixed(1)}% of selected)\nremaining portfolio: $${remainingPortfolioValue.toFixed(2)}\n` : '';
    const footer = `\n💡 use this list with your multisig wallet for pro-rata swaps.`;

    return header + summary + liquidationInfo + 'token'.padEnd(12) + ' | ' + 'amount'.padStart(12) + ' | ' + 'value'.padStart(10) + ' | share\n' + 
           '-'.repeat(50) + '\n' + tokenList + footer;
  };

  const copyShoppingList = async () => {
    const shoppingList = generateShoppingList();
    try {
      await navigator.clipboard.writeText(shoppingList);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('failed to copy:', err);
    }
  };

  const downloadShoppingList = () => {
    const shoppingList = generateShoppingList();
    const blob = new Blob([shoppingList], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swap-shopping-list-${walletInput.replace(/[^a-zA-Z0-9]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-4">
      <div className="max-w-6xl mx-auto">
        {/* header */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={onBack}
            className="flex items-center space-x-2 text-purple-400 hover:text-purple-300 transition-colors"
          >
            <span>← back to swap</span>
          </button>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            multisig portfolio analyzer
          </h1>
          <div className="w-20"></div>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4 mb-6 border border-gray-700 relative">
          <div className="flex items-start justify-between">
            <p className="text-sm text-gray-300 flex-1">
              enter any wallet address or sns domain (.sol, .bonk, etc.) to generate a pro-rata swap shopping list for multisig wallets.
              perfect for squads vaults and other multisig setups that can&apos;t connect directly to dapps.
            </p>
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="ml-4 text-gray-400 hover:text-gray-300 transition-colors flex-shrink-0"
            >
              <HelpCircle className="h-5 w-5" />
            </button>
          </div>
          
          {showHelp && (
            <div className="mt-3 p-3 bg-purple-500/20 border border-purple-500/50 rounded-lg">
              <h4 className="font-semibold text-sm mb-2">how to use:</h4>
              <ul className="text-xs text-gray-300 space-y-1">
                <li>• enter a wallet address or domain to analyze the portfolio</li>
                <li>• select tokens to include in the liquidation</li>
                <li>• enter a dollar amount or percentage to liquidate</li>
                <li>• copy the shopping list for your multisig wallet</li>
                <li>• execute pro-rata swaps while maintaining portfolio weights</li>
              </ul>
            </div>
          )}
        </div>

        {/* input section */}
        <div className="bg-gray-800/50 rounded-xl p-6 backdrop-blur-sm border border-gray-700 mb-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                wallet address or domain
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <input
                  type="text"
                  placeholder="enter wallet address or .sol domain..."
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && analyzeWallet()}
                  className="w-full pl-10 pr-4 py-3 bg-gray-700/50 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="text-xs text-gray-400">ie:</span>
                {['.sol', '.bonk', '.poor'].map(domain => (
                  <button
                    key={domain}
                    onClick={() => setWalletInput(`example${domain}`)}
                    className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    {domain}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={analyzeWallet}
              disabled={analyzing || !walletInput.trim()}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed py-3 px-4 rounded-lg font-medium transition-all duration-200 flex items-center justify-center space-x-2"
            >
              {analyzing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>analyzing portfolio...</span>
                </>
              ) : (
                <>
                  <Calculator className="h-4 w-4" />
                  <span>analyze portfolio</span>
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-500/20 border border-red-500 rounded-lg">
              <div className="flex items-center space-x-2 text-red-200">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}
        </div>

        {/* results */}
        {result && (
          <div className="bg-gray-800/50 rounded-xl p-6 backdrop-blur-sm border border-gray-700">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-xl font-semibold mb-2">portfolio analysis</h2>
                <div className="flex items-center space-x-2 text-sm text-gray-300">
                  <Wallet className="h-4 w-4" />
                  <span className="font-mono">
                    {result.isDomain ? `${walletInput} → ${result.walletAddress}` : result.walletAddress}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(result.walletAddress);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="text-gray-400 hover:text-gray-300 transition-colors"
                  >
                    {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-green-400">
                  ${result.totalValue.toFixed(2)}
                </div>
                <div className="text-sm text-gray-400">
                  {result.tokens.length} tokens
                </div>
                {selectedTokens.size > 0 && (
                  <div className="text-sm text-purple-400">
                    {selectedTokens.size} selected (${selectedTokensValue.toFixed(2)})
                  </div>
                )}
              </div>
            </div>

            {/* selection controls */}
            {result.tokens.length > 0 && (
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="rounded bg-gray-700 border-gray-600 text-purple-500 focus:ring-purple-500 w-4 h-4"
                    />
                    <span className="text-sm text-gray-300">select all</span>
                  </div>
                  {selectedTokens.size > 0 && (
                    <span className="text-sm text-purple-400">
                      {selectedTokens.size} tokens selected (${selectedTokensValue.toFixed(2)})
                    </span>
                  )}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleSelectAll(true)}
                    className="text-xs text-purple-400 hover:text-purple-300 transition-colors px-2 py-1"
                  >
                    select all
                  </button>
                  <button
                    onClick={() => handleSelectAll(false)}
                    className="text-xs text-gray-400 hover:text-gray-300 transition-colors px-2 py-1"
                  >
                    clear all
                  </button>
                </div>
              </div>
            )}

            {/* liquidation input */}
            {selectedTokens.size > 0 && (
              <div className="mb-6 p-4 bg-gray-700/50 rounded-lg border border-gray-600">
                <h3 className="font-medium mb-3">liquidation amount</h3>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1">
                    <div className="flex space-x-2 mb-2">
                      <button
                        onClick={() => setLiquidationType('percentage')}
                        className={`px-3 py-1 rounded text-xs ${
                          liquidationType === 'percentage' 
                            ? 'bg-purple-600 text-white' 
                            : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                        }`}
                      >
                        percentage
                      </button>
                      <button
                        onClick={() => setLiquidationType('dollar')}
                        className={`px-3 py-1 rounded text-xs ${
                          liquidationType === 'dollar' 
                            ? 'bg-purple-600 text-white' 
                            : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                        }`}
                      >
                        dollar amount
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        placeholder={liquidationType === 'percentage' ? 'enter percentage...' : 'enter dollar amount...'}
                        value={liquidationAmount}
                        onChange={(e) => setLiquidationAmount(e.target.value)}
                        className="w-full pl-3 pr-8 py-2 bg-gray-600 border border-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                      <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-sm">
                        {liquidationType === 'percentage' ? '%' : '$'}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm text-gray-300">
                    {liquidationValue > 0 && (
                      <>
                        <div>liquidating: <span className="text-green-400">${liquidationValue.toFixed(2)}</span></div>
                        <div>remaining portfolio: <span className="text-blue-400">${remainingPortfolioValue.toFixed(2)}</span></div>
                        <div>of selected: <span className="text-purple-400">{((liquidationValue / selectedTokensValue) * 100).toFixed(1)}%</span></div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* shopping list actions */}
            {selectedTokens.size > 0 && (
              <div className="flex space-x-3 mb-6">
                <button
                  onClick={copyShoppingList}
                  disabled={!selectedTokens.size}
                  className="flex items-center space-x-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors"
                >
                  {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  <span>{copied ? 'copied!' : 'copy shopping list'}</span>
                </button>
                <button
                  onClick={downloadShoppingList}
                  disabled={!selectedTokens.size}
                  className="flex items-center space-x-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors"
                >
                  <Download className="h-4 w-4" />
                  <span>download txt</span>
                </button>
              </div>
            )}

            {/* token table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-2 text-sm font-medium w-10">
                      select
                    </th>
                    <th 
                      className="text-left py-3 px-2 text-sm font-medium cursor-pointer hover:bg-gray-700/50 rounded transition-colors"
                      onClick={() => handleSort('symbol')}
                    >
                      <div className="flex items-center space-x-1">
                        <span>token</span>
                        <SortIcon field="symbol" sortField={sortField} sortDirection={sortDirection} />
                      </div>
                    </th>
                    <th 
                      className="text-right py-3 px-2 text-sm font-medium cursor-pointer hover:bg-gray-700/50 rounded transition-colors"
                      onClick={() => handleSort('balance')}
                    >
                      <div className="flex items-center justify-end space-x-1">
                        <span>balance</span>
                        <SortIcon field="balance" sortField={sortField} sortDirection={sortDirection} />
                      </div>
                    </th>
                    <th className="text-right py-3 px-2 text-sm font-medium">price</th>
                    <th 
                      className="text-right py-3 px-2 text-sm font-medium cursor-pointer hover:bg-gray-700/50 rounded transition-colors"
                      onClick={() => handleSort('value')}
                    >
                      <div className="flex items-center justify-end space-x-1">
                        <span>value</span>
                        <SortIcon field="value" sortField={sortField} sortDirection={sortDirection} />
                      </div>
                    </th>
                    <th 
                      className="text-right py-3 px-2 text-sm font-medium cursor-pointer hover:bg-gray-700/50 rounded transition-colors"
                      onClick={() => handleSort('percentage')}
                    >
                      <div className="flex items-center justify-end space-x-1">
                        <span>portfolio %</span>
                        <SortIcon field="percentage" sortField={sortField} sortDirection={sortDirection} />
                      </div>
                    </th>
                    {hasLiquidation && (
                      <th className="text-right py-3 px-2 text-sm font-medium text-green-400">
                        swap amount
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedTokens.map((token) => {
                    const percentage = result.totalValue > 0 ? ((token.value || 0) / result.totalValue * 100) : 0;
                    const proRataToken = proRataTokens.find(t => t.mint === token.mint);
                    const isSelected = selectedTokens.has(token.mint);
                    
                    return (
                      <tr 
                        key={token.mint} 
                        className={`border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors ${
                          isSelected ? 'bg-purple-500/10' : ''
                        }`}
                      >
                        <td className="py-3 px-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleTokenSelect(token.mint)}
                            className="rounded bg-gray-700 border-gray-600 text-purple-500 focus:ring-purple-500 w-4 h-4"
                          />
                        </td>
                        <td className="py-3 px-2">
                          <div className="flex items-center space-x-3">
                            {token.logoURI ? (
                              <img
                                src={token.logoURI}
                                alt={token.symbol}
                                className="w-6 h-6 rounded-full"
                              />
                            ) : (
                              <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                                {token.symbol.slice(0, 3)}
                              </div>
                            )}
                            <div>
                              <div className="font-medium text-sm">{token.symbol}</div>
                              <div className="text-xs text-gray-400">{token.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-right py-3 px-2 text-sm">
                          {token.uiAmount < 0.0001 ? token.uiAmount.toExponential(2) : token.uiAmount.toFixed(6)}
                        </td>
                        <td className="text-right py-3 px-2 text-sm">
                          {token.price ? `$${token.price < 0.01 ? token.price.toExponential(2) : token.price.toFixed(2)}` : 'n/a'}
                        </td>
                        <td className="text-right py-3 px-2 text-sm font-medium">
                          ${(token.value || 0).toFixed(2)}
                        </td>
                        <td className="text-right py-3 px-2 text-sm">
                          <div className="flex items-center justify-end space-x-2">
                            <div className="w-16 bg-gray-700 rounded-full h-2">
                              <div 
                                className="bg-green-400 h-2 rounded-full" 
                                style={{ width: `${Math.min(percentage, 100)}%` }}
                              />
                            </div>
                            <span className="w-12 text-right">{percentage.toFixed(1)}%</span>
                          </div>
                        </td>
                        {hasLiquidation && proRataToken && (
                          <td className="text-right py-3 px-2 text-sm text-green-400 font-medium">
                            {proRataToken.swapAmount > 0.0001 ? proRataToken.swapAmount.toFixed(6) : proRataToken.swapAmount.toExponential(2)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* instructions */}
            {selectedTokens.size > 0 && (
              <div className="mt-6 p-4 bg-purple-500/20 border border-purple-500/50 rounded-lg">
                <div className="text-sm text-gray-300">
                  {hasLiquidation ? (
                    <>
                      <span className="text-green-400">ready to swap ${liquidationValue.toFixed(2)} </span>
                      <span>({((liquidationValue / selectedTokensValue) * 100).toFixed(1)}% of selected tokens)</span>
                      <div className="mt-1 text-xs">remaining portfolio value: ${remainingPortfolioValue.toFixed(2)}</div>
                    </>
                  ) : (
                    'select tokens and enter a liquidation amount to generate swap quantities'
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
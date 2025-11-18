'use client';

import { useState, useCallback, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { TokenBalance, ProRataSwap } from './types/token';
import { TokenService } from './lib/api';
import { TokenTable } from './components/TokenTable';
import { SwapInterface } from './components/SwapInterface';
import { SettingsPanel } from './components/SettingsPannel';
import { Settings2, Wallet, Menu, X } from 'lucide-react';
import { RpcStatus } from './components/RpcStatus';
import Image from 'next/image';

export default function Home() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const tokenService = new TokenService();

  const fetchTokenBalances = useCallback(async () => {
    if (!publicKey) return;
    
    setLoading(true);
    setError('');
    
    try {
      console.log('🔄 Fetching token balances for:', publicKey.toString());
      let tokenBalances = await tokenService.getTokenBalances(publicKey.toString());
      console.log('📊 Raw token balances:', tokenBalances);
      
      tokenBalances = await tokenService.getTokenPrices(tokenBalances);
      console.log('💰 Token balances with prices:', tokenBalances);
      
      setTokens(tokenBalances);
    } catch (err) {
      console.error('❌ Error fetching tokens:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch tokens');
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  
  useEffect(() => {
    if (connected) {
      fetchTokenBalances();
    }
  }, [connected, fetchTokenBalances]);

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

  const handleSwapComplete = () => {
    console.log('✅ Swap completed, refreshing balances...');
    fetchTokenBalances(); // Refresh token balances after swap
  };

  // Add this inside your Home component, before the return statement
  useEffect(() => {
    const debugRpc = async () => {
      console.log('=== RPC DEBUG INFO ===');
      console.log('NEXT_PUBLIC_HELIUS_API_KEY exists:', !!process.env.NEXT_PUBLIC_HELIUS_API_KEY);
      console.log('NEXT_PUBLIC_SOLANA_RPC_URL:', process.env.NEXT_PUBLIC_SOLANA_RPC_URL);
      
      const testService = new TokenService();
      await testService.getTokenBalances(publicKey?.toString() || 'Cj1jScR4V73qLmvWJiGiWs9jtcwCXEZsmS5cevWt9jNc');
    };

    if (connected) {
      debugRpc();
    }
  }, [connected]);

  // Debug selected tokens
  useEffect(() => {
    console.log('🎯 Selected tokens updated:', {
      count: selectedTokens.length,
      tokens: selectedTokens.map(t => ({
        symbol: t.symbol,
        selected: t.selected,
        balance: t.uiAmount,
        value: t.value
      })),
      totalValue: totalSelectedValue
    });
  }, [selectedTokens, totalSelectedValue]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-3 sm:p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header - HIGHER Z-INDEX */}
        <header className="flex justify-between items-center mb-6 sm:mb-8 p-3 sm:p-4 bg-gray-800/50 rounded-lg backdrop-blur-sm relative z-30">
          <div className="flex items-center space-x-3 sm:space-x-4">
            <div className="flex items-center space-x-2">
              <Image
                src={"/soloswap.png"}
                alt="SoloSwap Logo"
                width={32}
                height={32}
                className="h-7 w-auto sm:h-8" 
              />
              <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                solo swap
              </h1>
            </div>
          </div>
          
          {/* Desktop Actions */}
          <div className="hidden sm:flex items-center space-x-4">
            <RpcStatus />
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <Settings2 className="h-5 w-5" />
            </button>
            <div className="relative z-40">
              <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700 !transition-colors !text-sm" />
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="sm:hidden flex items-center space-x-2">
            <RpcStatus />
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
            >
              {showMobileMenu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </header>

        {/* Mobile Menu */}
        {showMobileMenu && (
          <div className="sm:hidden mb-4 p-4 bg-gray-800/80 rounded-lg backdrop-blur-sm border border-gray-700 relative z-30">
            <div className="flex flex-col space-y-3">
              <button
                onClick={() => {
                  setShowSettings(true);
                  setShowMobileMenu(false);
                }}
                className="flex items-center space-x-2 p-2 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <Settings2 className="h-4 w-4" />
                <span>Settings</span>
              </button>
              <div className="flex justify-center relative z-40">
                <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700 !transition-colors !text-sm !py-2 !px-4" />
              </div>
            </div>
          </div>
        )}

        {/* Main Content - LOWER Z-INDEX */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 relative z-10">
          {/* Token Table */}
          <div className="lg:col-span-2 order-2 lg:order-1">
            <div className="bg-gray-800/50 rounded-xl p-4 sm:p-6 backdrop-blur-sm border border-gray-700">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 sm:mb-6 space-y-3 sm:space-y-0">
                <h2 className="text-lg sm:text-xl font-semibold flex items-center space-x-2">
                  <Wallet className="h-4 w-4 sm:h-5 sm:w-5" />
                  <span>tokens</span>
                </h2>
                
                <div className="flex items-center justify-between sm:justify-end space-x-2 sm:space-x-4">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleSelectAll(true)}
                      className="text-xs sm:text-sm text-purple-400 hover:text-purple-300 transition-colors px-2 py-1"
                    >
                      select all
                    </button>
                    <button
                      onClick={() => handleSelectAll(false)}
                      className="text-xs sm:text-sm text-gray-400 hover:text-gray-300 transition-colors px-2 py-1"
                    >
                      clear all
                    </button>
                  </div>
                  <button
                    onClick={fetchTokenBalances}
                    disabled={loading}
                    className="text-xs sm:text-sm bg-purple-600 hover:bg-purple-700 px-2 sm:px-3 py-1 rounded transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {loading ? 'refreshing...' : 'refresh'}
                  </button>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-200 text-sm">
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
              />
            </div>
          </div>

          {/* Unified Swap Interface - Sticky on mobile */}
          <div className="lg:col-span-1 order-1 lg:order-2 mb-4 sm:mb-0">
            <div className="sticky top-4">
              <SwapInterface
                selectedTokens={selectedTokens}
                totalSelectedValue={totalSelectedValue}
                onSwapComplete={handleSwapComplete}
              />
            </div>
          </div>
        </div>

        {showSettings && (
          <SettingsPanel onClose={() => setShowSettings(false)} />
        )}

        {/* Debug Panel */}
        <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-gray-800/30 rounded-lg border border-gray-700 relative z-10">
          <h3 className="text-xs sm:text-sm font-medium mb-2 text-gray-400">debug</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 text-xs">
            <div>
              <div className="text-gray-400">wallet connected</div>
              <div className={connected ? 'text-green-400' : 'text-red-400'}>
                {connected ? 'yes' : 'no'}
              </div>
            </div>
            <div>
              <div className="text-gray-400">total tokens</div>
              <div>{tokens.length}</div>
            </div>
            <div>
              <div className="text-gray-400">selected tokens</div>
              <div>{selectedTokens.length}</div>
            </div>
            <div>
              <div className="text-gray-400">selected value</div>
              <div>${totalSelectedValue.toFixed(2)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
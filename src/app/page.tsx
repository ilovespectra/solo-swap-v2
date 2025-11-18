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
    fetchTokenBalances(); 
  };

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
            {/* <RpcStatus /> */}
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
            {/* <RpcStatus /> */}
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

      <div className="mt-4 sm:mt-6 pt-4 border-t border-gray-700/50">
        <div className="flex justify-center items-center space-x-6">
          {/* Twitter Link */}
          <a
            href="https://twitter.com/ilovespectra"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center space-x-2 text-gray-400 hover:text-blue-400 transition-colors duration-200"
            aria-label="follow on twitter"
          >
            <svg 
              className="w-5 h-5 group-hover:scale-110 transition-transform duration-200" 
              fill="currentColor" 
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" />
            </svg>
          </a>

          <a
            href="https://github.com/ilovespectra/solo-swap-v2"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center space-x-2 text-gray-400 hover:text-purple-400 transition-colors duration-200"
            aria-label="view on gitHub"
          >
            <svg 
              className="w-5 h-5 group-hover:scale-110 transition-transform duration-200" 
              fill="currentColor" 
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.337-3.369-1.337-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.022.8-.223 1.65-.334 2.5-.338.85.004 1.7.115 2.5.338 1.91-1.291 2.75-1.022 2.75-1.022.544 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
          </a>
        </div>
      </div>
      </div>
    </div>
  );
}
'use client';

import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { 
  PhantomWalletAdapter, 
  SolflareWalletAdapter,
  LedgerWalletAdapter 
} from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { ThemeProvider } from './contexts/themeContext';
import { ReactNode, useMemo, useEffect } from 'react';

import '@solana/wallet-adapter-react-ui/styles.css';

export function Providers({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => {
    return process.env.NEXT_PUBLIC_RPC_ENDPOINT_1 || 
           process.env.NEXT_PUBLIC_RPC_ENDPOINT_2 ||
           'https://api.mainnet-beta.solana.com';
  }, []);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new LedgerWalletAdapter(),
    ],
    []
  );

  useEffect(() => {
    const preserveWalletAddressCase = () => {
      setTimeout(() => {
        const walletButtons = document.querySelectorAll('.wallet-adapter-button');
        walletButtons.forEach(button => {
          const span = button.querySelector('span');
          if (span) {
            const text = span.textContent || '';
            if (text.match(/[0-9a-zA-Z]{32,44}/) || text.includes('...') || text.length > 20) {
              // Type cast to HTMLElement to access style property
              (span as HTMLElement).style.textTransform = 'none';
              (button as HTMLElement).style.textTransform = 'none';
            }
          }
        });
      }, 100);
    };

    preserveWalletAddressCase();
    
    const observer = new MutationObserver(preserveWalletAddressCase);
    observer.observe(document.body, { 
      childList: true, 
      subtree: true 
    });

    return () => observer.disconnect();
  }, []);

  return (
    <ThemeProvider>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <style jsx global>{`
              /* Global lowercase styling for user-facing text */
              .wallet-adapter-button {
                text-transform: lowercase !important;
                margin-right: 1rem !important;
              }
              
              .wallet-adapter-modal-button span {
                text-transform: lowercase !important;
              }
              
              .wallet-adapter-modal-list-more {
                text-transform: lowercase !important;
              }
            
              .wallet-adapter-dropdown-list-item {
                text-transform: lowercase !important;
              }
                
              .wallet-adapter-modal-title {
                text-transform: lowercase !important;
              }

              /* But preserve wallet addresses and technical text */
              .wallet-address,
              .token-address,
              .mono,
              code,
              pre {
                text-transform: none !important;
              }

              /* Ensure all user-facing button text is lowercase */
              button:not(.wallet-adapter-button):not([class*="mono"]), 
              [role="button"]:not([class*="mono"]) {
                text-transform: lowercase !important;
              }

              /* Comprehensive Wallet Modal Theme Styling */
              .wallet-adapter-modal-wrapper {
                background: rgba(0, 0, 0, 0.5) !important;
                z-index: 999999 !important;
              }

              .wallet-adapter-modal-overlay {
                z-index: 999999 !important;
              }

              .wallet-adapter-modal-container,
              .wallet-adapter-modal {
                background: var(--bg-secondary) !important;
                color: var(--text-primary) !important;
                border: 1px solid var(--border-primary) !important;
                border-radius: 0 !important;
              }

              .wallet-adapter-modal-title {
                background: var(--bg-tertiary) !important;
                color: var(--text-primary) !important;
                border-bottom: 1px solid var(--border-primary) !important;
                border-radius: 0 !important;
                padding: 1rem !important;
                margin: 0 !important;
              }

              .wallet-adapter-modal-button {
                background: var(--bg-tertiary) !important;
                color: var(--text-primary) !important;
                border: 1px solid var(--border-primary) !important;
                border-radius: 0 !important;
                cursor: pointer !important;
                padding: 0.75rem 1rem !important;
                margin: 0.5rem !important;
                transition: all 0.3s ease !important;
              }

              .wallet-adapter-modal-button:hover {
                background: linear-gradient(135deg, var(--orange-primary), var(--orange-secondary)) !important;
                color: #ffffff !important;
                border-color: var(--orange-primary) !important;
                transform: translateY(-1px) !important;
              }

              .wallet-adapter-modal-button:active {
                transform: scale(0.95) !important;
              }

              .wallet-adapter-modal-list {
                background: var(--bg-secondary) !important;
                margin: 0 !important;
                padding: 0 !important;
              }

              .wallet-adapter-dropdown-list-item {
                background: var(--bg-secondary) !important;
                color: var(--text-primary) !important;
                border-bottom: 1px solid var(--border-primary) !important;
                border-radius: 0 !important;
                padding: 1rem !important;
                cursor: pointer !important;
                transition: all 0.3s ease !important;
                margin: 0 !important;
                margin-right: 4rem !important;
              }

              .wallet-adapter-dropdown-list-item:last-child {
                border-bottom: none !important;
              }

              .wallet-adapter-dropdown-list-item:hover {
                background: var(--bg-tertiary) !important;
              }

              .wallet-adapter-dropdown-list-item:active {
                transform: scale(0.95) !important;
              }

              .wallet-adapter-dropdown {
                border-radius: 0 !important;
                background: var(--bg-secondary) !important;
                border: 1px solid var(--border-primary) !important;
                z-index: 9999 !important;
              }

              /* Force desktop wallet button visibility */
              @media (min-width: 768px) {
                .wallet-button-wrapper {
                  display: flex !important;
                  visibility: visible !important;
                  opacity: 1 !important;
                }
                
                .wallet-button-wrapper .wallet-adapter-button {
                  display: flex !important;
                  visibility: visible !important;
                  opacity: 1 !important;
                }
              }

              /* Mobile text scaling - only apply to mobile wallet button */
              @media (max-width: 767px) {
                body {
                  font-size: 18px !important;
                  line-height: 1.6 !important;
                }
                
                .mobile-wallet-button .wallet-adapter-button {
                  font-size: 16px !important;
                  padding: 12px 16px !important;
                  min-height: 48px !important;
                }
                
                .wallet-adapter-dropdown-list-item {
                  font-size: 16px !important;
                  padding: 14px 16px !important;
                  min-height: 48px !important;
                }
                
                .wallet-adapter-modal-title {
                  font-size: 20px !important;
                }
                
                .wallet-adapter-modal-button {
                  font-size: 16px !important;
                }
                
                button:not(.wallet-adapter-button) {
                  font-size: 16px !important;
                }
              }
            `}</style>
            {children}
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </ThemeProvider>
  );
}
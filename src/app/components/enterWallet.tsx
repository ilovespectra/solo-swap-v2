'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { PublicKey } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { TokenBalance } from '../types/token';
import { useColumnState } from '../hooks/useColumnState';
import { TokenTable } from './TokenTable';
import { TokenService } from '../lib/api';
import { 
  Search, Calculator, Copy, CheckCircle, AlertCircle, 
  Wallet, Download, HelpCircle, Plus, Trash2, Upload, FileText, Clock, ChevronRight, X, Eye, EyeOff, GripVertical
} from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, TouchSensor, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  collection, doc, setDoc, getDoc, getDocs, deleteDoc, 
  query, orderBy, Timestamp, writeBatch 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import Papa from 'papaparse';
import { encryptionService } from '../lib/encryption';
import { HistoricalPortfolio } from './ViewHistory';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

interface PortalProps {
  children: React.ReactNode;
}

export function Portal({ children }: PortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timeoutId = setTimeout(() => setMounted(true), 0);
    return () => {
      clearTimeout(timeoutId);
      setMounted(false);
    };
  }, []);

  if (!mounted) return null;

  return createPortal(children, document.body);
}

declare global {
  interface Window {
    refreshPortfolioChart?: () => void;
  }
}

interface MultisigAnalyzerProps {
  onBack: () => void;
}

interface AnalysisResult {
  tokens: TokenBalance[];
  totalValue: number;
  walletAddress: string;
  nickname?: string;
  isDomain: boolean;
  analyzedAt: Date;
}

interface SavedWallet {
  id: string;
  address: string;
  nickname?: string | null;
  createdAt: Date;
  isDomain: boolean;
  lastAnalyzed?: Date | null;
  lastTotalValue?: number;
}

interface PortfolioHistory {
  timestamp: Date;
  totalValue: number;
  walletCount: number;
  tokenCount: number;
}

type SortField = 'symbol' | 'balance' | 'value' | 'percentage';
type SortDirection = 'asc' | 'desc';
interface LoadingBarProps {
  totalItems: number;
  currentProcessed: number;
  itemType?: string;
  durationPerItem?: number;
  className?: string;
}

export function LoadingBar({ 
  totalItems, 
  currentProcessed, 
  itemType = 'tokens',
  durationPerItem = 1100,
  className = '' 
}: LoadingBarProps) {
  const [progress, setProgress] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previousProcessedRef = useRef<number>(0);

  useEffect(() => {
    if (totalItems === 0) return;

    if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
    }

    const updateProgress = () => {
      if (!startTimeRef.current) return;

      const currentTime = Date.now();
      const elapsed = currentTime - startTimeRef.current;
      const totalDuration = totalItems * durationPerItem;
      
      const actualProgress = totalItems > 0 ? (currentProcessed / totalItems) * 100 : 0;
      const timeBasedProgress = totalDuration > 0 ? Math.min((elapsed / totalDuration) * 100, 100) : 0;
      
      const displayProgress = Math.max(actualProgress, timeBasedProgress);
      setProgress(Math.min(displayProgress, 100));

      if (actualProgress > 0 && actualProgress < 100) {
        const estimatedTotalTime = (elapsed / actualProgress) * 100;
        const remaining = estimatedTotalTime - elapsed;
        setTimeRemaining(Math.max(0, remaining));
      } else if (timeBasedProgress > 0 && timeBasedProgress < 100) {
        const remaining = totalDuration - elapsed;
        setTimeRemaining(Math.max(0, remaining));
      } else {
        setTimeRemaining(0);
      }

      if (displayProgress < 100) {
        animationFrameRef.current = requestAnimationFrame(updateProgress);
      } else {
        setProgress(100);
        setTimeRemaining(0);
      }
    };

    animationFrameRef.current = requestAnimationFrame(updateProgress);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [totalItems, currentProcessed, durationPerItem]);

  useEffect(() => {
    
    startTimeRef.current = Date.now();
    previousProcessedRef.current = 0;
    const resetFrame = requestAnimationFrame(() => {
      setProgress(0);
      setTimeRemaining(0);
    });

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    return () => cancelAnimationFrame(resetFrame);
  }, [totalItems]);

  useEffect(() => {
    if (currentProcessed > previousProcessedRef.current) {
      previousProcessedRef.current = currentProcessed;
    }

    if (totalItems > 0 && currentProcessed >= totalItems) {
      const timer = setTimeout(() => {
        setProgress(100);
        setTimeRemaining(0);
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [currentProcessed, totalItems]);

  const formatTimeRemaining = (ms: number): string => {
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const itemsRemaining = totalItems - currentProcessed;
  const isComplete = progress >= 100 || (totalItems > 0 && currentProcessed >= totalItems);

  return (
    <div className={`w-full ${className}`}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-secondary font-medium">
          {totalItems} {itemType} detected
        </span>
        <span className="text-sm text-tertiary">
          {isComplete ? 'complete!' : timeRemaining > 0 ? `${formatTimeRemaining(timeRemaining)} remaining` : 'starting...'}
        </span>
      </div>

      <div className="w-full  h-3 overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
        <div 
          className="h-full  transition-all duration-300 ease-out relative"
          style={{ 
            width: `${progress}%`,
            background: 'linear-gradient(90deg, var(--orange-primary), var(--orange-light))'
          }}
        >
          {!isComplete && (
            <div 
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              style={{
                animation: 'shimmer 2s infinite'
              }}
            />
          )}
        </div>
      </div>

      <div className="flex justify-between items-center mt-2">
        <span className="text-xs text-tertiary">
          {Math.round(progress)}% complete
        </span>
      </div>

      {itemsRemaining > 0 && !isComplete && (
        <div className="flex items-center justify-center mt-3 space-x-2">
          <div className="flex space-x-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2  animate-pulse"
                style={{ background: 'var(--orange-primary)' }}
              />
            ))}
          </div>
        </div>
      )}

      {isComplete && (
        <div className="flex items-center justify-center mt-3 space-x-2">
          <div className="w-2 h-2  animate-ping" style={{ background: 'var(--green-primary)' }} />
        </div>
      )}

      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

function CollapsibleSection({ title, children, defaultOpen = true, className = '', style }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`card backdrop-blur-sm ${className}`} style={style}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-6 text-left transition-colors "
        style={{ 
          background: isOpen ? 'var(--bg-tertiary)' : 'transparent'
        }}
      >
        <h3 className="text-lg font-semibold text-orange-primary">{title}</h3>
        <ChevronRight 
          className={`h-5 w-5 text-secondary transition-transform duration-300 ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
      </button>
      {isOpen && (
        <div className="px-6 pb-6">
          {children}
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MultisigAnalyzer({ onBack }: MultisigAnalyzerProps) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const tokenService = useMemo(() => TokenService.getInstance(), []);
  const [walletInput, setWalletInput] = useState('');
  const [walletNickname, setWalletNickname] = useState<string>(''); 
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [savedWallets, setSavedWallets] = useState<SavedWallet[]>([]);
  const [copied, setCopied] = useState(false);
  const [sortField] = useState<SortField>('value');
  const [sortDirection] = useState<SortDirection>('desc');
  const [liquidationAmount, setLiquidationAmount] = useState<string>('');
  const [liquidationType, setLiquidationType] = useState<'dollar' | 'percentage'>('percentage');
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [showHelp, setShowHelp] = useState(false);
  const [csvUploadError, setCsvUploadError] = useState('');
  const [addingWallet, setAddingWallet] = useState(false);
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioHistory[]>([]);
  const [lastLoadedPortfolioValue, setLastLoadedPortfolioValue] = useState<number>(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loadingLastValue, setLoadingLastValue] = useState<boolean>(false);
  const [chartDataLoaded, setChartDataLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [targetToken, setTargetToken] = useState<any>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [updatedTokens, setUpdatedTokens] = useState<Set<string>>(new Set());
  const [updatedWallets, setUpdatedWallets] = useState<Set<string>>(new Set());
  const subscriptionsSetup = useRef(false);
  const lastFirestoreWrite = useRef<number>(0);
  const lastCleanupRun = useRef<number>(0);
  const HISTORY_CACHE_TTL_MS = 10 * 60 * 1000;

  const [showColumnPanel, setShowColumnPanel] = useState(false);

interface Column {
  id: string;
  label: string;
  visible: boolean;
  width?: number;
}

interface SortableColumnItemProps {
  column: Column;
  onToggleVisibility: (columnId: string) => void;
}

function SortableColumnItem({ column, onToggleVisibility }: SortableColumnItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: 'var(--bg-tertiary)',
        borderColor: 'var(--border-primary)'
      }}
      className="flex items-center justify-between p-3  border"
    >
      <div className="flex items-center space-x-3 flex-1">
        <button
          {...attributes}
          {...listeners}
          className="p-1 text-tertiary cursor-grab active:cursor-grabbing transition-colors"
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-tertiary)'}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-secondary">{column.label}</span>
      </div>
      <button
        onClick={() => onToggleVisibility(column.id)}
        className="p-2 text-tertiary transition-colors"
        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-tertiary)'}
      >
        {column.visible ? (
          <Eye className="h-4 w-4" />
        ) : (
          <EyeOff className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

  interface ColumnCustomizationPanelProps {
  columns: Column[];
  onToggleVisibility: (columnId: string) => void;
  onReorder: (oldIndex: number, newIndex: number) => void;
  onReset: () => void;
  isOpen: boolean;
  onClose: () => void;
  excludeColumns?: string[];
  triggerElement?: HTMLElement | null;
}

function ColumnCustomizationPanel({
  columns,
  onToggleVisibility,
  onReorder,
  onReset,
  isOpen,
  onClose,
  excludeColumns = [],
  triggerElement
}: ColumnCustomizationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (isOpen && triggerElement) {
      const rect = triggerElement.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 8,
        left: Math.min(
          rect.left + window.scrollX,
          window.innerWidth - 400
        )
      });
    }
  }, [isOpen, triggerElement]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = columns.findIndex(col => col.id === active.id);
      const newIndex = columns.findIndex(col => col.id === over.id);
      onReorder(oldIndex, newIndex);
    }
  };

  const filteredColumns = columns.filter(column => 
    !excludeColumns.includes(column.id)
  );

  if (!isOpen) return null;

  return (
    <Portal>
      <div 
        className="fixed inset-0 bg-black/50 z-50"
        style={{ top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <div
          ref={panelRef}
          className="absolute  p-6 w-full max-w-md max-h-[80vh] overflow-y-auto shadow-2xl border"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            transform: 'none',
            background: 'var(--bg-secondary)',
            borderColor: 'var(--border-primary)'
          }}
        >
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">column settings</h3>
            <button
              onClick={onClose}
              className="text-tertiary p-2  transition-colors"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-tertiary)'}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <div className="space-y-3 mb-6">
            <p className="text-sm text-tertiary">
              drag to reorder columns, toggle visibility with the eye icon
            </p>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext 
              items={filteredColumns.map(col => col.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {filteredColumns.map((column) => (
                  <SortableColumnItem
                    key={column.id}
                    column={column}
                    onToggleVisibility={onToggleVisibility}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <div className="flex justify-between items-center mt-6 pt-4 border-t" style={{ borderColor: 'var(--border-primary)' }}>
            <button
              onClick={onReset}
              className="px-4 py-2  transition-colors text-sm font-medium"
              style={{ background: 'var(--bg-tertiary)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
            >
              reset to default
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 btn-primary  transition-colors text-sm font-medium"
            >
              done
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

  const searchTokens = useCallback(async (query: string) => {
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

      const data = await response.json();
      

      const tokens = Array.isArray(data) ? data : (data.tokens || []);
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formattedResults = tokens.slice(0, 20).map((token: any) => ({
        mint: token.address || token.id || token.mint,
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || 'Unknown Token',
        logoURI: token.logoURI || token.icon || '',
        decimals: token.decimals || 9,
        uiAmount: 0,
        value: 0,
        price: 0
      }));
      
      setSearchResults(formattedResults);
      
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);


  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timeoutId = setTimeout(() => {
      searchTokens(searchQuery);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchTokens]);

  const [loadingProgress, setLoadingProgress] = useState({
    totalItems: 0,
    currentProcessed: 0,
    itemType: 'wallets' as const,
    isActive: false
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const SNS_DOMAINS = ['.sol', '.bonk', '.poor', '.ser', '.abc', '.backpack', '.crown', '.gogo', '.hodl', '.meme', '.monke', '.oon', '.ponke', '.pump', '.shark', '.snipe', '.turtle', '.wallet', '.whale', '.worker', '.00', '.inv', '.ux', '.ray', '.luv'];

  useEffect(() => {
    if (!publicKey) return;

    const loadPortfolioHistory = async () => {
      try {
        const cacheKey = `portfolio-history-cache-${publicKey.toString()}`;
        const cached = typeof window !== 'undefined' ? sessionStorage.getItem(cacheKey) : null;
        if (cached) {
          try {
            const parsed = JSON.parse(cached) as { ts: number; data: PortfolioHistory[] };
            if (Date.now() - parsed.ts < HISTORY_CACHE_TTL_MS && Array.isArray(parsed.data)) {
              setPortfolioHistory(parsed.data.map(r => ({ ...r, timestamp: new Date(r.timestamp) })));
              setChartDataLoaded(true);
              return;
            }
          } catch {
          }
        }

        const anonymizedKey = encryptionService.anonymizePublicKey(publicKey.toString());
        const historyQuery = query(
          collection(db, 'solo-users', anonymizedKey, 'portfolioHistory'),
          orderBy('timestamp', 'asc')
        );
        const querySnapshot = await getDocs(historyQuery);
        
        const nowMs = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const retentionMs = 90 * dayMs;
        const retentionCutoff = nowMs - retentionMs;

        const history: PortfolioHistory[] = [];

        for (const doc of querySnapshot.docs) {
          const data = doc.data();
          
          if (!data.encryptedData) {
            continue;
          }

          try {
            const decryptedData = encryptionService.decryptPortfolioHistory(
              data.encryptedData, 
              publicKey.toString()
            );

            if (decryptedData) {
              const timestamp = decryptedData.timestamp instanceof Date
                ? decryptedData.timestamp
                : new Date(decryptedData.timestamp);

              if (!isNaN(timestamp.getTime()) && timestamp.getTime() >= retentionCutoff) {
                history.push({
                  timestamp,
                  totalValue: decryptedData.totalValue,
                  walletCount: decryptedData.walletCount,
                  tokenCount: decryptedData.tokenCount
                });
              }
            }
          } catch {
          }
        }

        history.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        
        setPortfolioHistory(history);
        setChartDataLoaded(true);

        if (typeof window !== 'undefined') {
          sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: history }));
        }

      } catch {
        setChartDataLoaded(true);
      }
    };

    loadPortfolioHistory();
  }, [publicKey]);

  useEffect(() => {
    if (!publicKey) return;

    const loadSavedWallets = async () => {
      try {
        setLoadingLastValue(true);
        const walletsQuery = query(collection(db, 'solo-users', publicKey.toString(), 'wallets'));
        const querySnapshot = await getDocs(walletsQuery);
        
        const wallets = querySnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate() || new Date(0),
            lastAnalyzed: data.lastAnalyzed?.toDate() || undefined,
            lastTotalValue: data.lastTotalValue || 0 
          };
        }) as SavedWallet[];
        
        wallets.sort((a, b) => {
          const timeA = a.createdAt?.getTime() || 0;
          const timeB = b.createdAt?.getTime() || 0;
          return timeB - timeA;
        });
        
        setSavedWallets(wallets);
        
        const totalLastValue = wallets.reduce((sum, wallet) => sum + (wallet.lastTotalValue || 0), 0);
        setLastLoadedPortfolioValue(totalLastValue);
        
      } catch {
      } finally {
        setLoadingLastValue(false); 
      }
    };

    loadSavedWallets();
  }, [publicKey]);

  const saveWalletToFirestore = async (address: string, nickname?: string, isDomain: boolean = false) => {
    if (!publicKey) {
      throw new Error('wallet not connected. please ensure your wallet is connected and try again.');
    }

    if (!address) throw new Error('wallet address is required');

    const walletData = {
      address,
      nickname: nickname || undefined,
      isDomain,
      createdAt: new Date(),
      lastAnalyzed: null
    };

    try {
      
      const walletRef = doc(collection(db, 'solo-users', publicKey.toString(), 'wallets'));
      
      await setDoc(walletRef, walletData);
      
      return { id: walletRef.id, ...walletData };
      
    } catch (error) {
      
      if (error instanceof Error) {
        const firestoreError = error as { code?: string };
        console.error('error details:', {
          message: error.message,
          code: firestoreError.code,
          user: publicKey?.toString(),
          collection: 'solo-users'
        });
      }
      
      throw new Error(`failed to save wallet: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  };

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
    const throttleMs = 900000;
    if (nowMs - lastCleanupRun.current < throttleMs) {
      return;
    }

    const anonymizedKey = encryptionService.anonymizePublicKey(publicKey.toString());
    const recordsRef = collection(db, 'solo-users', anonymizedKey, 'portfolioHistory');
    const snapshot = await getDocs(query(recordsRef, orderBy('timestamp', 'asc')));

    if (snapshot.empty) {
      lastCleanupRun.current = nowMs;
      return;
    }

    const decryptedRecords: PortfolioHistory[] = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      if (!data.encryptedData) return;

      try {
        const decryptedData = encryptionService.decryptPortfolioHistory(
          data.encryptedData,
          publicKey.toString()
        );

        if (!decryptedData) return;

        decryptedRecords.push({
          timestamp: decryptedData.timestamp,
          totalValue: decryptedData.totalValue,
          walletCount: decryptedData.walletCount,
          tokenCount: decryptedData.tokenCount,
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
    const retentionMs = 90 * dayMs;

    const retentionCutoff = nowMs - retentionMs;

    const recentCutoff = nowMs - hourMs;
    const weekCutoff = nowMs - weekMs;
    const monthCutoff = nowMs - monthMs;

    const filteredRecords = decryptedRecords.filter((r) => r.timestamp.getTime() >= retentionCutoff);

    const recentRecords = filteredRecords.filter((r) => r.timestamp.getTime() >= recentCutoff);
    const minuteReduced = bucketizeRecords(filteredRecords, 60_000, weekCutoff, recentCutoff);
    const hourlyReduced = bucketizeRecords(filteredRecords, 60 * 60 * 1000, monthCutoff, weekCutoff);
    const multiDayReduced = bucketizeRecords(filteredRecords, 4 * dayMs, 0, monthCutoff);

    const finalRecords = [...multiDayReduced, ...hourlyReduced, ...minuteReduced, ...recentRecords]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const batch = writeBatch(db);
    snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));

    finalRecords.forEach((record) => {
      const encryptedData = encryptionService.encryptPortfolioHistory({
        totalValue: record.totalValue,
        walletCount: record.walletCount,
        tokenCount: record.tokenCount,
        timestamp: record.timestamp,
      }, publicKey.toString());

      const docRef = doc(collection(db, 'solo-users', anonymizedKey, 'portfolioHistory'));
      const bucketSizeMs = record.timestamp.getTime() < monthCutoff
        ? 4 * dayMs
        : record.timestamp.getTime() < weekCutoff
          ? 60 * 60 * 1000
          : record.timestamp.getTime() < recentCutoff
            ? 60_000
            : 30_000;

      batch.set(docRef, {
        timestamp: Timestamp.fromDate(record.timestamp),
        userId: publicKey.toString(),
        encryptedData,
        randomField1: encryptionService.generateRandomEncrypted(publicKey.toString()),
        randomField2: encryptionService.generateRandomEncrypted(publicKey.toString()),
        metadata: {
          hasData: true,
          recordType: 'portfolio',
          version: '1.1',
          bucketSizeMs,
          walletCountRange: record.walletCount > 10 ? '10+' : '1-10',
          tokenCountRange: record.tokenCount > 50 ? '50+' : record.tokenCount > 10 ? '10-50' : '1-10'
        }
      });
    });

    await batch.commit();
    setPortfolioHistory(finalRecords);
    lastCleanupRun.current = Date.now();
  }, [publicKey, bucketizeRecords]);

  const savePortfolioHistory = useCallback(async (totalValue: number, walletCount: number, tokenCount: number) => {
    if (!publicKey) {
      return;
    }

    if (totalValue <= 0) {
      return;
    }

    try {
      const anonymizedKey = encryptionService.anonymizePublicKey(publicKey.toString());
      const portfolioData = {
        totalValue,
        walletCount,
        tokenCount,
        timestamp: new Date()
      };

      const encryptedPortfolioData = encryptionService.encryptPortfolioHistory(
        portfolioData, 
        publicKey.toString()
      );

      const nowMs = Date.now();
      const hourMs = 60 * 60 * 1000;
      const dayMs = 24 * hourMs;
      const weekMs = 7 * dayMs;
      const monthMs = 30 * dayMs;

      const bucketSizeMs = nowMs >= (nowMs - hourMs)
        ? 30_000
        : nowMs >= (nowMs - weekMs)
          ? 60_000
          : nowMs >= (nowMs - monthMs)
            ? 60 * 60 * 1000
            : 4 * dayMs;

      const bucketStart = Math.floor(nowMs / bucketSizeMs) * bucketSizeMs;
      const bucketDate = new Date(bucketStart);
      const docId = `bucket-${bucketSizeMs}-${bucketStart}`;

      const historyData = {
        timestamp: Timestamp.fromDate(bucketDate),
        userId: publicKey.toString(),
        encryptedData: encryptedPortfolioData,
        randomField1: encryptionService.generateRandomEncrypted(publicKey.toString()),
        randomField2: encryptionService.generateRandomEncrypted(publicKey.toString()),
        metadata: {
          hasData: true,
          recordType: 'portfolio',
          version: '1.1',
          bucketSizeMs,
          walletCountRange: walletCount > 10 ? '10+' : '1-10',
          tokenCountRange: tokenCount > 50 ? '50+' : tokenCount > 10 ? '10-50' : '1-10'
        }
      };

      const historyRef = doc(collection(db, 'solo-users', anonymizedKey, 'portfolioHistory'), docId); 
      
      await setDoc(historyRef, historyData);
      
      setPortfolioHistory(prev => {
        const newHistory = [...prev, {
          timestamp: bucketDate,
          totalValue: portfolioData.totalValue,
          walletCount: portfolioData.walletCount,
          tokenCount: portfolioData.tokenCount
        }];
        
        newHistory.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const trimmedHistory = newHistory.slice(-100);
        
        return trimmedHistory;
      });

      await cleanupPortfolioHistory();

    } catch {
    }
  }, [publicKey, cleanupPortfolioHistory]);

  useEffect(() => {
    const totalLastValue = savedWallets.reduce((sum, wallet) => sum + (wallet.lastTotalValue || 0), 0);
    
    if (results.length > 0) {
      const currentTotal = results.reduce((sum, result) => sum + result.totalValue, 0);
      setLastLoadedPortfolioValue(currentTotal);
    } else if (totalLastValue > 0) {
      setLastLoadedPortfolioValue(totalLastValue);
    }
  }, [savedWallets, results]);

  const updateWalletLastAnalyzed = useCallback(async (walletAddress: string, totalValue: number = 0) => {
    if (!publicKey) return;

    try {
      const wallet = savedWallets.find(w => w.address === walletAddress);
      if (!wallet) return;

      const walletRef = doc(db, 'solo-users', publicKey.toString(), 'wallets', wallet.id);
      await setDoc(walletRef, {
        lastAnalyzed: new Date(),
        lastTotalValue: totalValue 
      }, { merge: true });
      
      setSavedWallets(prev => prev.map(w => 
        w.id === wallet.id 
          ? { ...w, lastAnalyzed: new Date(), lastTotalValue: totalValue }
          : w
      ));
    } catch {
    }
  }, [publicKey, savedWallets]);

  const deleteWalletFromFirestore = async (walletId: string) => {
    if (!publicKey) return;
    
    await deleteDoc(doc(db, 'solo-users', publicKey.toString(), 'wallets', walletId));
    setSavedWallets(prev => prev.filter(w => w.id !== walletId));
    setResults(prev => prev.filter(r => !savedWallets.find(w => w.id === walletId && w.address === r.walletAddress)));
  };

  const resolveDomain = async (domain: string): Promise<string> => {
  try {
    const cleanDomain = domain.replace('@', '').toLowerCase().trim();

    try {
      const { getDomainKey, NameRegistryState } = await import('@bonfida/spl-name-service');
      
      const { pubkey } = await getDomainKey(cleanDomain);
      const registry = await NameRegistryState.retrieve(connection, pubkey);
      const owner = registry.registry.owner.toBase58();
      
      return owner;
    } catch {
    }

    try {
      const response = await fetch(connection.rpcEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getDomainNames',
          params: {
            domain: cleanDomain
          },
        }),
      });

      const data = await response.json();
      if (data.result && data.result.owner) {
        return data.result.owner;
      }
    } catch {
    }

    try {
      const response = await fetch(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${cleanDomain}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data?.address) {
          return data.address;
        }
      }
    } catch {
    }

    throw new Error(`could not resolve domain: ${cleanDomain}. the domain may not exist or all resolution methods are unavailable.`);

  } catch (err) {
    
    if (err instanceof Error) {
      if (err.message.includes('not exist') || err.message.includes('not found')) {
        throw new Error(`the domain "${domain}" doesn't exist or isn't registered on Solana.`);
      } else if (err.message.includes('currently unavailable')) {
        throw new Error(`domain resolution services are temporarily down. Please try using the wallet address directly for "${domain}".`);
      }
    }
    
    throw new Error(`failed to resolve domain "${domain}". please try using the wallet address directly.`);
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

  const addWallet = async () => {
  if (!walletInput.trim()) {
    setError('please enter a wallet address or domain');
    return;
  }

  if (!publicKey) {
    setError('wallet not properly connected. please ensure your wallet is connected and try again.');
    return;
  }

  setAddingWallet(true);
  setError('');

  try {
    let address = walletInput.trim();
    let isDomainAddress = false;

    if (isDomain(address)) {
      try {
        address = await resolveDomain(address);
        isDomainAddress = true;
      } catch (resolveError) {
        const errorMsg = resolveError instanceof Error ? resolveError.message : 'unknown resolution error';
        
        if (errorMsg.includes('not exist') || errorMsg.includes('not found') || errorMsg.includes('doesn\'t exist')) {
          setError(`the domain "${walletInput}" doesn't exist or isn't registered. please check the domain and try again.`);
        } else if (errorMsg.includes('network') || errorMsg.includes('failed to fetch') || errorMsg.includes('connection')) {
          setError('network error resolving domain. please check your internet connection and try again.');
        } else if (errorMsg.includes('rate limit') || errorMsg.includes('too many requests')) {
          setError('domain service is temporarily unavailable due to high demand. please try again in a few moments.');
        } else {
          setError(`failed to resolve domain "${walletInput}": ${errorMsg}`);
        }
        return;
      }
    }

    if (!validateWalletAddress(address)) {
      throw new Error(`invalid wallet address: ${address}. please check the address and try again.`);
    }

    const existingWallet = savedWallets.find(wallet => wallet.address === address);
    if (existingWallet) {
      const existingName = existingWallet.nickname || (existingWallet.isDomain ? existingWallet.address : `${existingWallet.address.slice(0, 8)}...${existingWallet.address.slice(-6)}`);
      throw new Error(`this wallet is already saved as: ${existingName}`);
    }

    const savedWallet = await saveWalletToFirestore(
      address, 
      walletNickname || undefined, 
      isDomainAddress
    );

    setSavedWallets(prev => [savedWallet, ...prev]);
    
    const existingResult = results.find(r => r.walletAddress === address);
    if (!existingResult) {
      await analyzeWallet(address, walletNickname, isDomainAddress);
    } else {
      if (walletNickname) {
        setResults(prev => prev.map(r => 
          r.walletAddress === address 
            ? { ...r, nickname: walletNickname }
            : r
        ));
      }
    }

    setWalletInput('');
    setWalletNickname('');
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'failed to add wallet';
    
    if (errorMsg.includes('already saved') || errorMsg.includes('already exists')) {
      setError(errorMsg);
    } else if (errorMsg.includes('firestore') || errorMsg.includes('permission')) {
      setError('storage error: unable to save wallet. please check your connection and try again.');
    } else if (errorMsg.includes('invalid wallet address')) {
      setError(errorMsg);
    } else {
      setError(`failed to add wallet: ${errorMsg}`);
    }
  } finally {
    setAddingWallet(false);
  }
};

const analyzeWallet = async (walletAddress: string, nickname?: string | null, isDomain: boolean = false): Promise<AnalysisResult | null> => {
  setError('');

  try {
    await new Promise(resolve => setTimeout(resolve, 500));

    let tokenBalances: TokenBalance[] = [];
    
    try {
      tokenBalances = await tokenService.getTokenBalances(walletAddress);
    } catch {
      throw new Error(`unable to fetch token balances for this wallet. the wallet may be empty or there may be network issues.`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    const potentiallyValuableTokens = tokenBalances.filter(token => {
      const isSol = token.symbol.toLowerCase() === 'sol' || token.name.toLowerCase().includes('solana');
      const hasBalance = token.uiAmount > 0;
      
      return (isSol && hasBalance) || (!isSol && hasBalance);
    });

    let valuableTokens: TokenBalance[] = [];
    
    if (potentiallyValuableTokens.length > 0) {
      try {
        valuableTokens = await tokenService.getTokenPrices(potentiallyValuableTokens);
        
        valuableTokens = valuableTokens.filter(token => {
          const isSol = token.symbol.toLowerCase() === 'sol' || token.name.toLowerCase().includes('solana');
          const hasValue = (token.value || 0) > 0.01;
          const hasBalance = token.uiAmount > 0;
          
          return (isSol && hasBalance) || (!isSol && hasValue && hasBalance);
        });
      } catch {
        valuableTokens = potentiallyValuableTokens.map(token => ({
          ...token,
          value: 0,
          price: 0
        }));
      }
    }

    const totalValue = valuableTokens.reduce((sum, token) => sum + (token.value || 0), 0);

    const result: AnalysisResult = {
      tokens: valuableTokens,
      totalValue,
      walletAddress,
      nickname: nickname || undefined,
      isDomain,
      analyzedAt: new Date()
    };

    await updateWalletLastAnalyzed(walletAddress, totalValue);

    if (valuableTokens.length === 0) {
      if (savedWallets.length === 1) {
        setError('no valuable tokens found in this wallet (all non-sol tokens < $0.01 value)');
      }
    }

    return result;

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'failed to analyze wallet';
    
    if (savedWallets.length === 1) {
      if (errorMsg.includes('failed to fetch') || errorMsg.includes('network')) {
        setError('network error: unable to connect to solana rpc. please check your connection and try again.');
      } else if (errorMsg.includes('invalid') || errorMsg.includes('validation')) {
        setError('invalid wallet address or domain');
      } else if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
        setError('rate limited: too many requests. please wait a moment and try again.');
      } else if (errorMsg.includes('unable to fetch token balances')) {
        setError(errorMsg);
      } else {
        setError(`analysis failed: ${errorMsg}`);
      }
    }
    
    throw err;
  }
};


  const tokenMints = useMemo(() => {
    const allTokenMints = new Set<string>();
    results.forEach(result => {
      result.tokens.forEach(token => allTokenMints.add(token.mint));
    });
    return Array.from(allTokenMints).sort();
  }, [results]);

  const tokenMintsKey = tokenMints.join(',');

  useEffect(() => {
  if (!publicKey || tokenMints.length === 0) {
    subscriptionsSetup.current = false;
    return;
  }

  const unsubscribeCallbacks: (() => void)[] = [];

  tokenMints.forEach(mint => {
    const unsubscribe = tokenService.subscribeToPriceUpdates(mint, (priceUpdate) => {
      setResults(prev => {
        const updated = prev.map(result => ({
          ...result,
          tokens: result.tokens.map(token =>
            token.mint === priceUpdate.mint
              ? {
                  ...token,
                  price: priceUpdate.price || 0,
                  value: (priceUpdate.price || 0) * token.uiAmount,
                  changePercent24h: priceUpdate.changePercent24h,
                  lastUpdated: priceUpdate.lastUpdated
                }
              : token
          ),
          totalValue: result.tokens.reduce((sum, token) => {
            if (token.mint === priceUpdate.mint) {
              return sum + ((priceUpdate.price || 0) * token.uiAmount);
            }
            return sum + (token.value || 0);
          }, 0)
        }));

        const newTotalPortfolioValue = updated.reduce((sum, result) => sum + result.totalValue, 0);
        
        const now = Date.now();
        if (now - lastFirestoreWrite.current > 180000 && newTotalPortfolioValue > 0) {
          lastFirestoreWrite.current = now;
          savePortfolioHistory(newTotalPortfolioValue, updated.length, updated.reduce((sum, r) => sum + r.tokens.length, 0)).catch(err =>
            console.error('Failed to save portfolio history:', err)
          );
        }

        return updated;
      });

      setUpdatedTokens(prev => {
        const newSet = new Set(prev);
        newSet.add(priceUpdate.mint);
        return newSet;
      });

      setResults(prevResults => {
        setUpdatedWallets(prevWallets => {
          const newSet = new Set(prevWallets);
          prevResults.forEach((result: AnalysisResult) => {
            if (result.tokens.some((t: TokenBalance) => t.mint === priceUpdate.mint)) {
              newSet.add(result.walletAddress);
            }
          });
          return newSet;
        });
        return prevResults;
      });

      setTimeout(() => {
        setUpdatedTokens(prev => {
          const next = new Set(prev);
          next.delete(priceUpdate.mint);
          return next;
        });
        setResults(prevResults => {
          setUpdatedWallets(prevWallets => {
            const next = new Set(prevWallets);
            prevResults.forEach((result: AnalysisResult) => {
              if (result.tokens.some((t: TokenBalance) => t.mint === priceUpdate.mint)) {
                next.delete(result.walletAddress);
              }
            });
            return next;
          });
          return prevResults;
        });
      }, 800);
    });
    
    unsubscribeCallbacks.push(unsubscribe);
  });

  return () => {
    unsubscribeCallbacks.forEach(unsub => unsub());
    subscriptionsSetup.current = false;
  };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [publicKey, savePortfolioHistory, tokenMintsKey, tokenService, tokenMints.length]);

  const analyzeAllWallets = useCallback(async () => {
  if (savedWallets.length === 0) {
    setError('no saved wallets to analyze');
    return;
  }

  setAnalyzing(true);
  setError('');
  
  setLoadingProgress({
    totalItems: savedWallets.length,
    currentProcessed: 0,
    itemType: 'wallets',
    isActive: true
  });

  try {
    let failedAnalyses = 0;
    const failedWallets: string[] = [];

    if (!loadingProgress.isActive) {
      setResults([]);
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const walletBalances: Array<{ wallet: SavedWallet; tokens: TokenBalance[] }> = [];
    
    for (let i = 0; i < savedWallets.length; i++) {
      const wallet = savedWallets[i];
      
      setLoadingProgress(prev => ({
        ...prev,
        currentProcessed: i
      }));
      
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        const tokenBalances = await tokenService.getTokenBalances(wallet.address);
        const tokensWithBalance = tokenBalances.filter(token => {
          const isSol = token.symbol.toLowerCase() === 'sol';
          return isSol ? token.uiAmount > 0 : token.uiAmount > 0;
        });
        
        walletBalances.push({ wallet, tokens: tokensWithBalance });
      } catch {
        failedAnalyses++;
        failedWallets.push(wallet.address);
      }
    }

    if (failedWallets.length > 0) {
      const failedPreview = failedWallets
        .slice(0, 3)
        .map(addr => `${addr.slice(0, 8)}...${addr.slice(-6)}`)
        .join(', ');

      setError(`analysis incomplete: failed to load balances for ${failedWallets.length} wallet${failedWallets.length > 1 ? 's' : ''} (${failedPreview}${failedWallets.length > 3 ? ', ...' : ''}). results not updated to avoid partial totals.`);
      setLoadingProgress(prev => ({
        ...prev,
        currentProcessed: savedWallets.length,
        isActive: false
      }));
      setAnalyzing(false);
      return;
    }

    const allMints = new Set<string>();
    const tokensByMint = new Map<string, TokenBalance>();
    
    walletBalances.forEach(({ tokens }) => {
      tokens.forEach(token => {
        allMints.add(token.mint);
        if (!tokensByMint.has(token.mint)) {
          tokensByMint.set(token.mint, token);
        }
      });
    });

    const uniqueTokens = Array.from(tokensByMint.values());
    let tokensWithPrices: TokenBalance[] = [];

    if (uniqueTokens.length > 0) {
      try {
        tokensWithPrices = await tokenService.getTokenPrices(uniqueTokens);
      } catch (error) {
        console.error('Error fetching prices:', error);
        setError('network error fetching prices. please check your internet connection and try again.');
        setLoadingProgress(prev => ({
          ...prev,
          currentProcessed: savedWallets.length,
          isActive: false
        }));
        setAnalyzing(false);
        return;
      }
    }

    const priceMap = new Map<string, { price: number; value?: number; changePercent24h?: number | null }>();
    tokensWithPrices.forEach(token => {
      priceMap.set(token.mint, { 
        price: token.price || 0, 
        changePercent24h: token.changePercent24h ?? null
      });
    });

    const newResults: AnalysisResult[] = [];
    
    for (const { wallet, tokens } of walletBalances) {
      const tokensWithValues = tokens.map(token => {
        const priceData = priceMap.get(token.mint);
        const price = priceData?.price || 0;
        return {
          ...token,
          price,
          value: price * token.uiAmount,
          changePercent24h: priceData?.changePercent24h ?? null
        };
      }).filter(token => {
        const isSol = token.symbol.toLowerCase() === 'sol';
        return isSol ? token.uiAmount > 0 : (token.value || 0) > 0.01 && token.uiAmount > 0;
      });

      const totalValue = tokensWithValues.reduce((sum, token) => sum + (token.value || 0), 0);

      const result: AnalysisResult = {
        tokens: tokensWithValues,
        totalValue,
        walletAddress: wallet.address,
        nickname: wallet.nickname || undefined,
        isDomain: wallet.isDomain,
        analyzedAt: new Date()
      };

      await updateWalletLastAnalyzed(wallet.address, totalValue);
      newResults.push(result);
    }

    setResults(newResults);

    setLoadingProgress(prev => ({
      ...prev,
      currentProcessed: savedWallets.length
    }));

    await new Promise(resolve => setTimeout(resolve, 500));

    const totalPortfolioValue = newResults.reduce((sum, result) => sum + result.totalValue, 0);
    const totalTokens = newResults.reduce((sum, result) => sum + result.tokens.length, 0);

    setLastLoadedPortfolioValue(totalPortfolioValue);

    if (totalPortfolioValue > 0 && newResults.length > 0) {
      await savePortfolioHistory(totalPortfolioValue, newResults.length, totalTokens);
    }

    const event = new CustomEvent('portfolioAnalysisComplete', {
      detail: {
        totalValue: totalPortfolioValue,
        walletCount: newResults.length,
        tokenCount: totalTokens,
        timestamp: new Date()
      }
    });
    window.dispatchEvent(event);

    if (typeof window !== 'undefined' && typeof window.refreshPortfolioChart === 'function') {
      window.refreshPortfolioChart();
    }

    window.dispatchEvent(new CustomEvent('portfolioUpdated'));
    localStorage.setItem('portfolioDataUpdated', Date.now().toString());
    
    if (failedAnalyses > 0) {
      setError(`completed with ${failedAnalyses} failed analyses. check console for details.`);
    }
    
  } catch (err) {
    setError(`failed to analyze some wallets: ${err instanceof Error ? err.message : 'unknown error'}`);
    setLoadingProgress(prev => ({ ...prev, isActive: false }));
  } finally {
    setAnalyzing(false);
    setTimeout(() => {
      setLoadingProgress(prev => ({ ...prev, isActive: false }));
    }, 1000);
  }
}, [loadingProgress.isActive, savePortfolioHistory, savedWallets, tokenService, updateWalletLastAnalyzed]);

  useEffect(() => {
    if (initialLoad && savedWallets.length > 0 && publicKey && !analyzing) {
      analyzeAllWallets();
      setInitialLoad(false);
    }
  }, [analyzeAllWallets, analyzing, initialLoad, publicKey, savedWallets.length]);

  const downloadCsvTemplate = () => {
    const template = `address,nickname
    7aEY...f9Xq,main treasury
    your-domain.sol,team wallet
    8vM2...z4p1,investment fund
    another-domain.bonk,community wallet`;

    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wallet-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const allTokens = useMemo(() => {

    const tokenMap = new Map<string, TokenBalance & { sourceWallet: string; sourceNickname: string }>();
    
    results.forEach(result => {
      result.tokens.forEach(token => {
        const existing = tokenMap.get(token.mint);
        const sourceNickname = result.nickname || (result.isDomain ? result.walletAddress : `${result.walletAddress.slice(0, 4)}...${result.walletAddress.slice(-4)}`);
        
        if (existing) {

          tokenMap.set(token.mint, {
            ...existing,
            uiAmount: existing.uiAmount + token.uiAmount,
            value: existing.value + token.value,

            sourceNickname: existing.sourceWallet === result.walletAddress 
              ? existing.sourceNickname 
              : `${existing.sourceNickname}, ${sourceNickname}`
          });
        } else {

          tokenMap.set(token.mint, {
            ...token,
            sourceWallet: result.walletAddress,
            sourceNickname
          });
        }
      });
    });
    
    return Array.from(tokenMap.values());
  }, [results]);

  useEffect(() => {
    if (selectAllRef.current && allTokens.length > 0) {
      const someSelected = selectedTokens.size > 0 && selectedTokens.size < allTokens.length;
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [selectedTokens, allTokens]);

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

  const {
    columns,
    toggleColumnVisibility,
    reorderColumns,
    resetColumns,
  } = useColumnState();

  const handleSelectAll = (select: boolean) => {
    if (allTokens.length === 0) return;
    
    if (select) {
      setSelectedTokens(new Set(allTokens.map(token => token.mint)));
    } else {
      setSelectedTokens(new Set());
    }
  };

  const totalPortfolioValue = useMemo(() => {
    return results.reduce((sum, result) => sum + result.totalValue, 0);
  }, [results]);

  const sortedTokens = useMemo(() => {
  if (allTokens.length === 0) return [];

  const sorted = [...allTokens].sort((a, b) => {
      const aPercentage = totalPortfolioValue > 0 ? ((a.value || 0) / totalPortfolioValue * 100) : 0;
      const bPercentage = totalPortfolioValue > 0 ? ((b.value || 0) / totalPortfolioValue * 100) : 0;

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
  }, [allTokens, sortField, sortDirection, totalPortfolioValue]);

  const selectedTokensValue = useMemo(() => {
    if (allTokens.length === 0) return 0;
    return allTokens
      .filter(token => selectedTokens.has(token.mint))
      .reduce((sum, token) => sum + (token.value || 0), 0);
  }, [allTokens, selectedTokens]);

  const liquidationValue = useMemo(() => {
    if (allTokens.length === 0 || !liquidationAmount) return 0;
    
    const amount = parseFloat(liquidationAmount);
    if (isNaN(amount)) return 0;

    if (liquidationType === 'percentage') {
      return (selectedTokensValue * amount) / 100;
    } else {
      return Math.min(amount, selectedTokensValue);
    }
  }, [allTokens.length, liquidationAmount, liquidationType, selectedTokensValue]);

  const calculateProRataAmounts = () => {
    if (allTokens.length === 0 || liquidationValue <= 0 || selectedTokens.size === 0) return [];

    const selectedTokenData = allTokens.filter(token => selectedTokens.has(token.mint));
    
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
  const remainingPortfolioValue = totalPortfolioValue - liquidationValue;

  const generateShoppingList = () => {
  if (allTokens.length === 0) return '';

  const selectedTokenData = allTokens.filter(token => selectedTokens.has(token.mint));
  const selectedTokensValue = selectedTokenData.reduce((sum, token) => sum + (token.value || 0), 0);

  const sortedSelectedTokens = [...selectedTokenData].sort((a, b) => (b.value || 0) - (a.value || 0));
  const sortedProRataTokens = [...proRataTokens].sort((a, b) => (b.value || 0) - (a.value || 0));

  const header = `💰 multi-wallet pro-rata swap shopping list\n`;
  const timestamp = `generated: ${new Date().toLocaleString()}\n`;
  
  const targetInfo = targetToken ? `swapping to: ${targetToken.symbol} (${targetToken.name})\n` : '';
  
  const walletSummary = results.map(result => 
    `• ${result.nickname || (result.isDomain ? result.walletAddress : `${result.walletAddress.slice(0, 8)}...${result.walletAddress.slice(-6)}`)}: $${result.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  ).join('\n');
  
  const summary = `total portfolio value: $${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nwallets analyzed: ${results.length}\n${walletSummary}\n\n${targetInfo}selected tokens: ${selectedTokens.size}/${allTokens.length}\nselected value: $${selectedTokensValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n`;
  
  let tokenList: string;
  
  if (hasLiquidation) {
    tokenList = sortedProRataTokens.map((token, index) => {
      const portfolioPercentage = totalPortfolioValue > 0 ? ((token.value || 0) / totalPortfolioValue * 100) : 0;
      const selectedPercentage = selectedTokensValue > 0 ? ((token.value || 0) / selectedTokensValue * 100) : 0;
      
      return `${(index + 1).toString().padStart(2)}. ${token.symbol.padEnd(8)} | ${token.swapAmount.toLocaleString(undefined, { maximumFractionDigits: 6 }).padStart(15)} | $${token.liquidationAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(12)} | ${selectedPercentage.toFixed(1).padStart(5)}% sel | ${portfolioPercentage.toFixed(1).padStart(5)}% port | ${token.sourceNickname}`;
    }).join('\n');
  } else {
    tokenList = sortedSelectedTokens
      .map((token, index) => {
        const portfolioPercentage = totalPortfolioValue > 0 ? ((token.value || 0) / totalPortfolioValue * 100) : 0;
        const selectedPercentage = selectedTokensValue > 0 ? ((token.value || 0) / selectedTokensValue * 100) : 0;
        
        return `${(index + 1).toString().padStart(2)}. ${token.symbol.padEnd(8)} | ${token.uiAmount.toLocaleString(undefined, { maximumFractionDigits: 6 }).padStart(15)} | $${(token.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(12)} | ${selectedPercentage.toFixed(1).padStart(5)}% sel | ${portfolioPercentage.toFixed(1).padStart(5)}% port | ${token.sourceNickname}`;
      }).join('\n');
  }

  const liquidationInfo = hasLiquidation ? 
    `\n💸 summary:\n` +
    `liquidating: $${liquidationValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
    `of selected: ${((liquidationValue / selectedTokensValue) * 100).toFixed(1)}%\n` +
    `remaining portfolio: $${remainingPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` : '';

  const footer = `\n💡 instructions:\n` +
    `• use this list with your multisig wallet for pro-rata swaps\n` +
    `• tokens are ordered by value (highest to lowest)\n` +
    `• "sel" = percentage of selected tokens\n` +
    `• "port" = percentage of total portfolio\n` +
    `• source shows which wallet holds each token`;

  const columnHeaders = 
    'no. token    |           amount |        value |  share |  share | source\n' +
    '-- ---------- | ---------------- | ------------ | ------ | ------ | ---------\n';

  return header + timestamp + summary + liquidationInfo + columnHeaders + tokenList + '\n\n' + footer;
};

  const copyShoppingList = async () => {
    const shoppingList = generateShoppingList();
    try {
      await navigator.clipboard.writeText(shoppingList);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('failed to copy shopping list to clipboard');
    }
  };

  const downloadShoppingList = () => {
    const shoppingList = generateShoppingList();
    const blob = new Blob([shoppingList], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prorata-shopping-list-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvUploadError('');
    setError('');

    if (!publicKey) {
      setCsvUploadError('wallet not connected. Please connect your wallet and try again.');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    try {
      const text = await file.text();
      const results = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim().toLowerCase()
      });

      if (results.errors.length > 0) {
        throw new Error(`csv parsing error: ${results.errors[0].message}`);
      }

      const wallets = results.data as Array<{ address: string; nickname?: string }>;
      
      if (!wallets || wallets.length === 0) {
        throw new Error('no valid wallet data found in csv');
      }

      let successfulImports = 0;
      let failedImports = 0;
      const errors: string[] = [];
      const processedAddresses = new Set<string>();
      const duplicateAddresses = new Set<string>();

      for (const [index, wallet] of wallets.entries()) {
        try {
          if (!publicKey) {
            throw new Error('wallet disconnected during import');
          }

          if (!wallet.address?.trim()) {
            failedImports++;
            errors.push(`row ${index + 1}: empty address`);
            continue;
          }

          let address = wallet.address.trim();
          let isDomainAddress = false;

          if (isDomain(address)) {
            try {
              address = await resolveDomain(address);
              isDomainAddress = true;
            } catch {
              failedImports++;
              errors.push(`row ${index + 1}: failed to resolve domain ${wallet.address}`);
              continue;
            }
          }

          if (!validateWalletAddress(address)) {
            failedImports++;
            errors.push(`row ${index + 1}: invalid address ${wallet.address}`);
            continue;
          }

          if (processedAddresses.has(address)) {
            duplicateAddresses.add(address);
            failedImports++;
            errors.push(`row ${index + 1}: duplicate address ${wallet.address}`);
            continue;
          }

          const walletDocRef = doc(db, 'solo-users', publicKey.toString(), 'wallets', address);
          const walletDoc = await getDoc(walletDocRef);
          
          if (walletDoc.exists()) {
            duplicateAddresses.add(address);
            failedImports++;
            errors.push(`row ${index + 1}: address already exists in your wallets ${wallet.address}`);
            continue;
          }

          await saveWalletToFirestore(
            address,
            wallet.nickname?.trim() || undefined,
            isDomainAddress
          );

          processedAddresses.add(address);
          successfulImports++;
          
          if (index < wallets.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
        } catch (err) {
          failedImports++;
          errors.push(`row ${index + 1}: ${err instanceof Error ? err.message : 'unknown error'}`);
          
          if (err instanceof Error && err.message.includes('wallet not connected')) {
            setCsvUploadError('wallet disconnected during import. please reconnect and try again.');
            break;
          }
          
          if (err instanceof Error && err.message.includes('permissions')) {
            setCsvUploadError('firestore permissions error. please check your security rules.');
            break;
          }
        }
      }

      let successMessage = '';
      if (successfulImports > 0) {
        successMessage = `successfully imported ${successfulImports} wallet${successfulImports > 1 ? 's' : ''}`;
        
        if (failedImports > 0) {
          successMessage += `, ${failedImports} failed`;
        }
        
        if (duplicateAddresses.size > 0) {
          successMessage += ` (${duplicateAddresses.size} duplicate${duplicateAddresses.size > 1 ? 's' : ''} skipped)`;
        }
        
        setCsvUploadError(successMessage);
        
        try {
          const walletsQuery = query(collection(db, 'solo-users', publicKey.toString(), 'wallets'));
          const querySnapshot = await getDocs(walletsQuery);
          
          const updatedWallets = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
              createdAt: data.createdAt?.toDate() || new Date(0),
              lastAnalyzed: data.lastAnalyzed?.toDate() || undefined
            };
          }) as SavedWallet[];
          
          updatedWallets.sort((a, b) => {
            const timeA = a.createdAt?.getTime() || 0;
            const timeB = b.createdAt?.getTime() || 0;
            return timeB - timeA;
          });
          
          setSavedWallets(updatedWallets);
        } catch {
        }
      } else if (failedImports > 0) {
        let errorMessage = `no wallets were successfully imported. all ${failedImports} failed.`;
        
        if (duplicateAddresses.size > 0) {
          errorMessage += ` (${duplicateAddresses.size} duplicate${duplicateAddresses.size > 1 ? 's' : ''} found)`;
        }
        
        if (errors.length > 0) {
          const errorPreview = errors.slice(0, 3).join('; ');
          errorMessage += ` errors: ${errorPreview}${errors.length > 3 ? '...' : ''}`;
        }
        
        setCsvUploadError(errorMessage);
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'failed to process csv file';
      setCsvUploadError(`${errorMsg}`);
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  useEffect(() => {
  const handleClickOutside = (event: MouseEvent) => {
    const searchArea = document.querySelector('[data-search-area]');
    if (searchArea && !searchArea.contains(event.target as Node)) {
      setSearchResults([]);
    }
  };

  document.addEventListener('mousedown', handleClickOutside);
  return () => {
    document.removeEventListener('mousedown', handleClickOutside);
  };
}, []);

  const formatTimestamp = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  return (
  <div className="w-full overflow-x-hidden px-0 sm:px-4 md:px-6" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
    <div className="relative z-10">
      <div className="w-full py-6">
        {/* Enhanced Header */}
        <div className="flex items-center justify-between mb-8 p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--orange-primary)' }}>
            solo: shop
          </h1>
          <div className="w-20"></div>
        </div>

        {/* Instructions Section */}
        <CollapsibleSection 
          title="instructions"
          defaultOpen={true}
          className="mb-6"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}
        >
          <div className="flex items-start justify-between">
            <p className="text-sm flex-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              enter multiple addresses to generate a combined pro-rata swapping list.
            </p>
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="ml-4 p-2 transition-colors"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
            >
              <HelpCircle className="h-5 w-5" style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>
          
          {showHelp && (
            <div className="mt-4 p-4" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
              <h4 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-primary)' }}>how to use:</h4>
              <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center space-x-2">
                  <div className="w-1.5 h-1.5 bg-gray-400 "></div>
                  <span>add individual wallets or upload a csv with multiple addresses</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-1.5 h-1.5 bg-gray-400 "></div>
                  <span>wallets are saved to your account for future use</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-1.5 h-1.5 bg-gray-400 "></div>
                  <span>analyze all wallets at once to see combined portfolio</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-1.5 h-1.5 bg-gray-400 "></div>
                  <span>select tokens from any wallet for pro-rata calculations</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-1.5 h-1.5 bg-gray-400 "></div>
                  <span>generate shopping lists that maintain weights across all selected tokens</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="w-1.5 h-1.5 bg-gray-400 "></div>
                  <span>each token shows which wallet it comes from</span>
                </li>
              </ul>
            </div>
          )}
        </CollapsibleSection>

        {/* last total Section */}
        {savedWallets.length > 0 && lastLoadedPortfolioValue > 0 && (
          <CollapsibleSection 
            title="last total"
            defaultOpen={true}
            className="mb-6"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                  <Clock className="h-5 w-5" style={{ color: 'var(--orange-primary)' }} />
                </div>
                <div>
                  <h3 className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>last total</h3>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {savedWallets.length} wallet{savedWallets.length > 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg sm:text-xl font-bold" style={{ color: 'var(--green-primary)' }}>
                  ${lastLoadedPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                {results.length > 0 && (
                  <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    current: ${totalPortfolioValue.toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>
        )}

        {/* Manage Wallets Section */}
        <CollapsibleSection 
          title="manage wallets"
          defaultOpen={true}
          className="mb-6"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-2 text-gray-200">
                wallet address or domain
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
                <input
                  type="text"
                  placeholder="enter wallet address or domain"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addWallet()}
                  className="w-full pl-10 pr-4 py-3 text-sm"
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="text-xs text-gray-400">try domains:</span>
                {['.sol', '.bonk', '.poor'].map(domain => (
                  <button
                    key={domain}
                    onClick={() => setWalletInput(`example${domain}`)}
                    className="text-xs text-gray-400 hover:text-gray-300 transition-colors px-2 py-1 bg-gray-500/10 hover:bg-gray-500/20 "
                  >
                    {domain}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-200">
                nickname
              </label>
              <input
                type="text"
                placeholder="my treasury"
                value={walletNickname}
                onChange={(e) => setWalletNickname(e.target.value)}
                className="w-full px-4 py-3 text-sm"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-6">
            {/* Add Wallet */}
            <button
              onClick={addWallet}
              disabled={addingWallet || analyzing || !walletInput.trim()}
              className="flex items-center justify-center sm:justify-start space-x-2 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-3 transition-colors text-sm font-medium w-full sm:w-auto"
              style={{
                background: 'linear-gradient(135deg, var(--orange-primary), var(--orange-secondary))',
                color: '#ffffff',
              }}
            >
              {addingWallet ? (
                <>
                  <div className="h-4 w-4 text-white" style={{ color: 'white' }}>
                    <div className="circular-dot-spinner"></div>
                  </div>
                  <span>adding wallet...</span>
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  <span>add wallet</span>
                </>
              )}
            </button>

            {/* Analyze All */}
            <button
              onClick={analyzeAllWallets}
              disabled={analyzing || savedWallets.length === 0 || loadingProgress.isActive}
              className="flex items-center justify-center sm:justify-start space-x-2 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-3 transition-colors text-sm font-medium w-full sm:w-auto"
              style={{
                background: 'linear-gradient(135deg, var(--orange-primary), var(--orange-secondary))',
                color: '#ffffff',
              }}
            >
              {loadingProgress.isActive ? (
                <>
                  <div className="h-4 w-4 text-white" style={{ color: 'white' }}>
                    <div className="circular-dot-spinner"></div>
                  </div>
                  <span>analyzing... ({loadingProgress.currentProcessed}/{savedWallets.length})</span>
                </>
              ) : (
                <>
                  <Calculator className="h-4 w-4" />
                  <span>analyze all ({savedWallets.length})</span>
                </>
              )}
            </button>

            {/* Upload CSV */}
            <label className="flex items-center justify-center sm:justify-start space-x-2 px-5 py-3 transition-colors text-sm font-medium cursor-pointer w-full sm:w-auto"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
              }}>
              <Upload className="h-4 w-4" />
              <span>upload csv</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleCsvUpload}
                className="hidden"
              />
            </label>

            {/* Download Template */}
            <button
              onClick={downloadCsvTemplate}
              className="flex items-center justify-center sm:justify-start space-x-2 px-5 py-3 transition-colors text-sm font-medium cursor-pointer w-full sm:w-auto"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <FileText className="h-4 w-4" />
              <span>template</span>
            </button>
          </div>

          {/* Loading Progress */}
          {loadingProgress.isActive && (
            <div className="mb-6 p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
              <h3 className="text-lg font-semibold mb-4 flex items-center space-x-3">
                <div className="h-6 w-6" style={{ color: 'var(--orange-primary)' }}>
                  <div className="circular-dot-spinner"></div>
                </div>
                <span>analyzing wallets...</span>
              </h3>
              <LoadingBar
                totalItems={loadingProgress.totalItems}
                currentProcessed={loadingProgress.currentProcessed}
                itemType={loadingProgress.itemType}
                durationPerItem={500}
                className="mt-4"
              />
              <div className="mt-4 text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
                processing wallet {Math.min(loadingProgress.currentProcessed + 1, loadingProgress.totalItems)} of {loadingProgress.totalItems}
                {/* {loadingProgress.currentProcessed > 0 && (
                  <span className="ml-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                    ({Math.round((loadingProgress.currentProcessed / loadingProgress.totalItems) * 100)}%)
                  </span>
                )} */}
              </div>
            </div>
          )}

          {/* Error/Success Messages */}
          {(error || csvUploadError) && (
            <div className={`p-4  border text-sm ${
              error.includes('✅') || csvUploadError.includes('successfully imported') || csvUploadError.includes('added') 
                ? 'border-success text-green-primary'
                : 'text-orange-dark'
            }`} style={{
              background: error.includes('✅') || csvUploadError.includes('successfully imported') || csvUploadError.includes('added')
                ? 'rgba(0, 255, 136, 0.1)'
                : 'rgba(217, 79, 31, 0.1)',
              borderColor: error.includes('✅') || csvUploadError.includes('successfully imported') || csvUploadError.includes('added')
                ? 'var(--border-success)'
                : 'var(--border-error)'
            }}>
              <div className="flex items-center space-x-2">
                {error.includes('✅') || csvUploadError.includes('successfully imported') || csvUploadError.includes('added') ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                <span>{error || csvUploadError}</span>
              </div>
            </div>
          )}

          {/* Saved Wallets List */}
          {savedWallets.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-medium mb-4 flex items-center space-x-2" style={{ color: 'var(--text-primary)' }}>
                <Wallet className="h-4 w-4" style={{ color: 'var(--orange-primary)' }} />
                <span>saved wallets ({savedWallets.length})</span>
              </h4>
              <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                {savedWallets.map((wallet) => (
                  <div
                    key={wallet.id}
                    className="flex items-center justify-between p-4 transition-colors group"
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-primary)',
                    }}
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className="p-2" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                        <Wallet className="h-4 w-4" style={{ color: 'var(--orange-primary)' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                          {wallet.nickname || (wallet.isDomain ? 
                            (wallet.address || 'Unknown domain') : 
                            `${(wallet.address || '').slice(0, 8)}...${(wallet.address || '').slice(-6)}`
                          )}
                        </div>
                        {wallet.nickname && wallet.isDomain && (
                          <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{wallet.address}</div>
                        )}
                        {wallet.nickname && !wallet.isDomain && (
                          <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{`${(wallet.address || '').slice(0, 8)}...${(wallet.address || '').slice(-6)}`}</div>
                        )}
                        {wallet.lastAnalyzed && (
                          <div className="text-xs flex items-center space-x-1 mt-1" style={{ color: 'var(--text-secondary)' }}>
                            <Clock className="h-3 w-3" />
                            <span>last analyzed: {formatTimestamp(wallet.lastAnalyzed)}</span>
                          </div>
                        )}
                        {wallet.lastTotalValue !== undefined && wallet.lastTotalValue > 0 && (
                          <div className="text-xs font-semibold mt-1" style={{ color: 'var(--green-primary)' }}>
                            ${wallet.lastTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 flex-shrink-0">
                      <button
                        onClick={() => analyzeWallet(wallet.address, wallet.nickname, wallet.isDomain)}
                        disabled={analyzing}
                        className="p-2 bg-gray-500/20 hover:bg-gray-400/30 border border-gray-500/30  transition-colors text-gray-300 hover:text-gray-100 disabled:opacity-50"
                      >
                        <Calculator className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteWalletFromFirestore(wallet.id)}
                        className="p-2 border  transition-colors mobile-optimized"
                        style={{
                          background: 'rgba(217, 79, 31, 0.1)',
                          borderColor: 'var(--border-error)',
                          color: 'var(--orange-dark)'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(217, 79, 31, 0.2)';
                          e.currentTarget.style.color = 'var(--orange-primary)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(217, 79, 31, 0.1)';
                          e.currentTarget.style.color = 'var(--orange-dark)';
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CollapsibleSection>

        {/* Results Section */}
        {results.length > 0 && (
          <div className="space-y-6">
            {/* Analysis Section */}
            <CollapsibleSection 
              title="analysis"
              defaultOpen={true}
              className="bg-gray-800/30 border border-gray-700/30"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="text-sm text-gray-300">
                    {results.length} wallet{results.length > 1 ? 's' : ''} analyzed • 
                    total value: <span className="text-green-400 font-semibold">
                      ${totalPortfolioValue.toLocaleString()}
                    </span>
                    {/* {results[0]?.analyzedAt && (
                      <span className="text-gray-400 ml-2">
                        • updated: {formatTimestamp(results[0].analyzedAt)}
                      </span>
                    )} */}
                  </div>
                </div>
              </div>

              {/* Wallet Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {results
                  .sort((a, b) => b.totalValue - a.totalValue)
                  .map((result) => (
                    <div key={result.walletAddress} className="p-4 transition-colors" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                            {result.nickname || (result.isDomain ? result.walletAddress : `${result.walletAddress.slice(0, 8)}...${result.walletAddress.slice(-6)}`)}
                          </h3>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                            {result.tokens.length} tokens
                          </p>
                          {result.analyzedAt && (
                            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                              analyzed: {formatTimestamp(result.analyzedAt)}
                            </p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className={`text-lg font-bold text-green-400 transition-all ${
                            updatedWallets.has(result.walletAddress) ? 'price-updated' : ''
                          }`}>
                            ${result.totalValue.toLocaleString()}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            {((result.totalValue / totalPortfolioValue) * 100).toFixed(1)}% of total
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>

              {allTokens.length > 0 && (
                <div className="mb-6 flex items-center justify-between p-4" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                  <div className="flex items-center space-x-4">
                    {selectedTokens.size > 0 && (
                      <span className="text-sm font-medium" style={{ color: 'var(--orange-primary)' }}>
                        {selectedTokens.size} tokens selected (${selectedTokensValue.toLocaleString()})
                      </span>
                    )}
                  </div>
                </div>
              )}

              {selectedTokens.size > 0 && (
                <CollapsibleSection 
                  title="liquidation amount"
                  defaultOpen={true}
                  className="mb-6 bg-gray-700/20 border border-gray-600/30"
                >
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                      <div className="flex space-x-2 mb-3">
                        <button
                          onClick={() => setLiquidationType('percentage')}
                          className={`px-4 py-2  text-sm font-medium transition-colors ${
                            liquidationType === 'percentage' 
                              ? 'bg-gray-600 text-white' 
                              : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                          }`}
                        >
                          percentage
                        </button>
                        <button
                          onClick={() => setLiquidationType('dollar')}
                          className={`px-4 py-2  text-sm font-medium transition-colors ${
                            liquidationType === 'dollar' 
                              ? 'bg-gray-600 text-white' 
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
                          className="w-full pl-4 pr-12 py-3 bg-gray-600 border border-gray-500  focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent text-sm"
                        />
                        <span className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 text-sm">
                          {liquidationType === 'percentage' ? '%' : '$'}
                        </span>
                      </div>
                    </div>
                    <div className="text-sm text-gray-300 space-y-2">
                      {liquidationValue > 0 && (
                        <>
                          <div>liquidating: <span className="text-green-400 font-semibold">${liquidationValue.toLocaleString()}</span></div>
                          <div>remaining portfolio: <span className="text-gray-400 font-semibold">${remainingPortfolioValue.toLocaleString()}</span></div>
                          <div>of selected: <span className="text-gray-400 font-semibold">{((liquidationValue / selectedTokensValue) * 100).toLocaleString()}%</span></div>
                        </>
                      )}
                    </div>
                  </div>
                </CollapsibleSection>
              )}

              {selectedTokens.size > 0 && (
                <CollapsibleSection 
                  title="swap destination"
                  defaultOpen={true}
                  className="mb-6 bg-gray-700/20 border border-gray-600/30"
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2 text-gray-200">
                        search token to swap to
                      </label>
                      <div className="relative">
                        <Search className="absolute ml-1 left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                        <input
                          type="text"
                          placeholder="search symbol, name (e.g., USDC, SOL, etc.)"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 bg-gray-600 border border-gray-500  focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent text-sm"
                        />
                        {isSearching && (
                          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                            <div className="h-4 w-4" style={{ color: 'var(--orange-primary)' }}>
                              <div className="circular-dot-spinner"></div>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {/* Search Results Dropdown */}
                      {searchResults.length > 0 && (
                        <div className="mt-2 max-h-60 overflow-y-auto shadow-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                          {searchResults.map((token) => (
                            <button
                              key={token.mint}
                              onClick={() => {
                                setTargetToken(token);
                                setSearchResults([]);
                                setSearchQuery(token.symbol);
                              }}
                              className="w-full flex items-center space-x-3 p-3 transition-colors text-left"
                              style={{ background: 'var(--bg-secondary)' }}
                            >
                              {token.logoURI ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={token.logoURI}
                                  alt={token.symbol}
                                  className="w-6 h-6 "
                                />
                              ) : (
                                <div className="w-6 h-6 flex items-center justify-center text-xs font-bold" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
                                  {token.symbol.slice(0, 3)}
                                </div>
                              )}
                              <div className="flex-1">
                                <div className="font-medium text-sm text-white">{token.symbol}</div>
                                <div className="text-xs text-gray-400 truncate">{token.name}</div>
                              </div>
                              {targetToken?.mint === token.mint && (
                                <CheckCircle className="h-4 w-4 text-green-400" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {selectedTokens.size > 0 && (
                      <CollapsibleSection 
                        title="shopping list actions"
                        defaultOpen={true}
                        className="mb-6 mt-6"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}
                      >
                        <div className="flex flex-wrap gap-3">
                          <button
                            onClick={copyShoppingList}
                            disabled={!selectedTokens.size}
                            className="flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 transition-colors text-sm font-medium"
                            style={{
                              background: 'linear-gradient(135deg, var(--orange-primary), var(--orange-secondary))',
                              color: '#ffffff',
                            }}
                          >
                            {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            <span>{copied ? 'copied!' : 'copy shopping list'}</span>
                          </button>
                          <button
                            onClick={downloadShoppingList}
                            disabled={!selectedTokens.size}
                            className="flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 transition-colors text-sm font-medium"
                            style={{
                              background: 'linear-gradient(135deg, var(--orange-primary), var(--orange-secondary))',
                              color: '#ffffff',
                            }}
                          >
                            <Download className="h-4 w-4" />
                            <span>download txt</span>
                          </button>
                        </div>
                        
                        {/* Preview of what will be included */}
                        {selectedTokens.size > 0 && (
                          <div className="mt-4 p-4 bg-gray-600/30  border border-gray-500/30">
                            <h4 className="text-sm font-medium text-gray-200 mb-2">shopping list preview:</h4>
                            <div className="text-xs text-gray-400 space-y-1">
                              <div>• {selectedTokens.size} selected tokens from {results.length} wallets</div>
                              <div>• total value: ${selectedTokensValue.toLocaleString()}</div>
                              {targetToken && (
                                <div>• swapping to: {targetToken.symbol} ({targetToken.name})</div>
                              )}
                              {hasLiquidation && (
                                <div>• liquidating: ${liquidationValue.toLocaleString()} ({((liquidationValue / selectedTokensValue) * 100).toFixed(1)}% of selected)</div>
                              )}
                            </div>
                          </div>
                        )}
                      </CollapsibleSection>
                    )}

                    {targetToken && (
                      <div className="flex items-center justify-between p-3" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                        <div className="flex items-center space-x-3">
                          {targetToken.logoURI ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={targetToken.logoURI}
                              alt={targetToken.symbol}
                              className="w-8 h-8 "
                            />
                          ) : (
                            <div className="w-8 h-8 bg-gray-500  flex items-center justify-center text-white text-xs font-bold">
                              {targetToken.symbol.slice(0, 3)}
                            </div>
                          )}
                          <div>
                            <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{targetToken.symbol}</div>
                            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{targetToken.name}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setTargetToken(null);
                            setSearchQuery('');
                          }}
                          className="p-1 hover:bg-orange-primary/20  transition-all duration-300"
                        >
                          <Trash2 className="h-4 w-4 text-orange-dark" />
                        </button>
                      </div>
                    )}
                  </div>
                </CollapsibleSection>
              )}

              <CollapsibleSection 
                title={`tokens • ${allTokens.length} total`}
                defaultOpen={true}
                className="bg-gray-800/30 border border-gray-700/30 overflow-hidden"
              >
                <TokenTable
                  tokens={sortedTokens.map(token => ({
                    ...token,
                    selected: selectedTokens.has(token.mint)
                  }))}
                  loading={analyzing}
                  onTokenSelect={(mint) => handleTokenSelect(mint)}
                  onSelectAll={handleSelectAll}
                  selectedTokens={sortedTokens.filter(token => selectedTokens.has(token.mint))}
                  totalSelectedValue={selectedTokensValue}
                  onRefreshPrices={analyzeAllWallets}
                  processingProgress={loadingProgress.currentProcessed}
                  totalToProcess={loadingProgress.totalItems}
                  portfolioHistory={portfolioHistory}
                  excludeTokenMint={targetToken?.mint}
                  updatedTokens={updatedTokens}
                />
              </CollapsibleSection>

              {/* Portfolio Summary */}
              {results.length > 0 && (
                <CollapsibleSection 
                  title="portfolio summary"
                  defaultOpen={true}
                  className="mt-6"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>total portfolio</div>
                      <div className="font-bold text-lg" style={{ color: 'var(--green-primary)' }}>${totalPortfolioValue.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>selected tokens</div>
                      <div className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
                        {selectedTokens.size}/{allTokens.length} (${selectedTokensValue.toLocaleString()})
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-400 text-xs font-medium mb-1">wallets</div>
                      <div className="text-gray-400 font-bold text-lg">{results.length} active</div>
                    </div>
                  </div>
                  
                  {hasLiquidation && (
                    <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-primary)' }}>
                      <div className="flex flex-wrap gap-4 text-sm">
                        <div>
                          <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>liquidating</div>
                          <div className="font-semibold" style={{ color: 'var(--green-primary)' }}>${liquidationValue.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>of selected</div>
                          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {((liquidationValue / selectedTokensValue) * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>remaining</div>
                          <div className="text-gray-400 font-semibold">${remainingPortfolioValue.toLocaleString()}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </CollapsibleSection>
              )}
            </CollapsibleSection>

            {/* Historical Chart - shown when results exist */}
            <HistoricalPortfolio 
              mode="multisig"
              currentPortfolioValue={totalPortfolioValue}
              portfolioHistory={portfolioHistory}
            />
          </div>
        )}

        {/* Historical Chart - shown when no results but has saved wallets and history */}
        {results.length === 0 && savedWallets.length > 0 && portfolioHistory.length > 0 && chartDataLoaded && (
          <div className="space-y-6">
            <HistoricalPortfolio 
              mode="multisig"
              currentPortfolioValue={lastLoadedPortfolioValue}
              portfolioHistory={portfolioHistory}
            />
          </div>
        )}

        {portfolioHistory.length === 0 && chartDataLoaded && savedWallets.length > 0 && results.length === 0 && (
          <div className="text-center py-12" style={{ color: 'var(--text-secondary)' }}>
            <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 flex items-center justify-center" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              <Clock className="h-8 w-8 sm:h-10 sm:w-10" />
            </div>
            <p className="text-sm sm:text-base font-medium">no portfolio history available yet</p>
            <p className="text-gray-500 text-xs sm:text-sm mt-2">analyze your wallets to generate chart data</p>
          </div>
        )}
      </div>
    </div>
    <ColumnCustomizationPanel
      columns={columns}
      onToggleVisibility={toggleColumnVisibility}
      onReorder={reorderColumns}
      onReset={resetColumns}
      isOpen={showColumnPanel}
      onClose={() => setShowColumnPanel(false)}
      excludeColumns={['select']}
    />
  </div>
);
}
'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { TokenBalance } from '../types/token';
import { ArrowUpDown, Search, ChevronDown, ChevronUp, ChevronRight, RefreshCw, Settings, Eye, EyeOff, GripVertical, X, ArrowUp, ArrowDown } from 'lucide-react';
import { LoadingBar } from './LoadingBar';
import { PortfolioChart } from './HistoricalChart';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, TouchSensor } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ColumnConfig, SortField } from '../types/table';
import { useColumnState } from '../hooks/useColumnState';

const createThrottledFunction = <T extends (...args: any[]) => any>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => Promise<ReturnType<T>>) => {
  let lastCall = 0;
  const pendingCall: ReturnType<T> | null = null;
  
  return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;
    
    if (timeSinceLastCall < limit) {
      await new Promise(resolve => setTimeout(resolve, limit - timeSinceLastCall));
    }
    
    lastCall = Date.now();
    return func(...args);
  };
};

const useRequestQueue = () => {
  const queueRef = useRef<Array<() => Promise<any>>>([]);
  const isProcessingRef = useRef(false);
  
  const processQueue = async () => {
    if (isProcessingRef.current || queueRef.current.length === 0) return;
    
    isProcessingRef.current = true;
    
    while (queueRef.current.length > 0) {
      const task = queueRef.current.shift();
      if (task) {
        try {
          await task();
        } catch (error) {
          console.error('Queue task failed:', error);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    isProcessingRef.current = false;
  };
  
  const enqueueRequest = (request: () => Promise<any>) => {
    queueRef.current.push(request);
    if (!isProcessingRef.current) {
      processQueue();
    }
  };
  
  return { enqueueRequest };
};

const TokenTableErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  
  useEffect(() => {
    const handleError = (error: ErrorEvent) => {
      console.error('TokenTable error:', error);
      setHasError(true);
    };
    
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);
  
  if (hasError) {
    return (
      <div className="p-6 text-center text-secondary">
        <div className="text-lg font-semibold mb-2">temporary issue</div>
        <div className="text-sm">please try again in a moment</div>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-secondary hover:bg-primary transition-colors"
        >
          reload
        </button>
      </div>
    );
  }
  
  return <>{children}</>;
};

interface TokenTableProps {
  tokens: TokenBalance[];
  loading: boolean;
  onTokenSelect: (mint: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  selectedTokens: TokenBalance[];
  totalSelectedValue: number;
  onRefreshPrices?: () => void;
  processingProgress: number; 
  totalToProcess: number; 
  portfolioHistory?: Array<{
    timestamp: Date;
    totalValue: number;
    walletCount: number;
    tokenCount: number;
  }>;
  sellIndicators?: Array<{
    timestamp: number | string
    valueUsd: number;
    token: string;
  }>; 
  excludeTokenMint?: string;
  updatedTokens?: Set<string>;
}

type SortDirection = 'asc' | 'desc';

interface SortIconProps {
  field: SortField;
  sortField: SortField;
  sortDirection: SortDirection;
}


interface TokenLogoProps {
  token: TokenBalance;
  size?: number;
}

const TokenLogo = ({ token, size = 8 }: TokenLogoProps) => {
  const logoClasses = size === 6 
    ? "w-6 h-6 sm:w-6 sm:h-6" 
    : "w-6 h-6 sm:w-8 sm:h-8";
  
  if (token.logoURI) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={token.logoURI}
        alt={token.symbol}
        className={` ${logoClasses} flex-shrink-0 object-cover`}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  
  return (
    <div style={{ 
      background: 'linear-gradient(135deg, var(--orange-primary), var(--bg-tertiary))',
      opacity: 0.8
    }} className={` ${logoClasses} flex items-center justify-center text-xs sm:text-sm font-bold flex-shrink-0`}>
      {token.symbol.slice(0, 3)}
    </div>
  );
};

interface PerformanceIndicatorProps {
  changePercent24h?: number;
  className?: string;
}

const PerformanceIndicator = ({ changePercent24h, className = '' }: PerformanceIndicatorProps) => {
  if (changePercent24h === undefined || changePercent24h === null) {
    return null;
  }

  const isPositive = changePercent24h > 0;
  const isNegative = changePercent24h < 0;
  const absoluteValue = Math.abs(changePercent24h);

  return (
    <div className={`flex items-center space-x-1 ${isPositive ? 'text-green-primary' : isNegative ? 'text-orange-dark' : 'text-tertiary'} ${className}`}>
      {isPositive ? (
        <ArrowUp className="h-3 w-3" />
      ) : isNegative ? (
        <ArrowDown className="h-3 w-3" />
      ) : null}
      <span className="text-xs font-medium">
        {absoluteValue.toFixed(2)}%
      </span>
    </div>
  );
};

interface TokenCardProps {
  token: TokenBalance;
  onSelect: (mint: string, selected: boolean) => void;
  isUpdated?: boolean;
}

const TokenCard = ({ token, onSelect, isUpdated = false }: TokenCardProps) => {
  return (
    <div 
      className="card p-4 mb-3 transition-all duration-300"
      style={{
        background: 'var(--bg-card)',
        borderColor: token.selected ? 'var(--orange-primary)' : 'var(--border-primary)'
      }}
    >
      {/* Header with checkbox and logo */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          <input
            type="checkbox"
            checked={token.selected}
            onChange={(e) => onSelect(token.mint, e.target.checked)}
            className="mobile-optimized flex-shrink-0"
            style={{ 
              width: '20px',
              height: '20px'
            }}
          />
          <TokenLogo token={token} size={10} />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-base text-primary truncate lowercase">
              {token.symbol}
            </div>
            <div className="text-xs text-tertiary truncate">{token.name}</div>
          </div>
        </div>
        {token.changePercent24h !== undefined && token.changePercent24h !== null && (
          <PerformanceIndicator changePercent24h={token.changePercent24h} />
        )}
      </div>

      {/* Grid with token data */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="space-y-1">
          <div className="text-tertiary text-xs">quantity</div>
          <div className="font-mono text-secondary font-medium">
            {token.uiAmount < 0.0001 ? token.uiAmount.toExponential(2) : token.uiAmount.toFixed(4)}
          </div>
        </div>

        <div className="space-y-1 text-right">
          <div className="text-tertiary text-xs">price</div>
          <div className="font-mono text-secondary font-medium transition-all duration-500">
            <span
              className={isUpdated ? 'price-updated' : ''}
              style={{
                animationDelay: isUpdated ? '0.05s' : '0s'
              }}
            >
              {token.price ? `$${token.price < 0.01 ? token.price.toExponential(2) : token.price.toFixed(2)}` : '- -'}
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-tertiary text-xs">value</div>
          <div className={`font-mono font-bold transition-all duration-500 ${
              token.value > 0 ? 'text-green-primary' : 'text-tertiary'
            }`}>
            <span
              className={isUpdated ? 'price-updated' : ''}
              style={{
                animationDelay: isUpdated ? '0.05s' : '0s'
              }}
            >
              {token.value ? `$${token.value.toFixed(2)}` : '$0.00'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

function CollapsibleSection({ title, children, defaultOpen = true, className = '' }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`card backdrop-blur-sm ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 sm:p-6 text-left transition-colors  mobile-optimized"
        style={{ 
          background: isOpen ? 'var(--bg-tertiary)' : 'transparent'
        }}
      >
        <h3 className="text-m font-semibold text-orange-primary">{title}</h3>
        <ChevronRight 
          className={`h-5 w-5 text-secondary transition-transform duration-300 ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
      </button>
      {isOpen && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6">
          {children}
        </div>
      )}
    </div>
  );
}

const defaultColumns: ColumnConfig[] = [
  { id: 'select', label: '', width: 60, visible: true, sortable: false, resizable: false, field: 'symbol', configurable: true },
  { id: 'symbol', label: 'symbol', width: 120, visible: true, sortable: true, resizable: true, field: 'symbol' },
  { id: 'source', label: 'source', width: 120, visible: true, sortable: true, resizable: true, field: 'symbol' },
  { id: 'balance', label: 'quantity', width: 120, visible: true, sortable: true, resizable: true, field: 'balance' },
  { id: 'price', label: 'price', width: 140, visible: true, sortable: true, resizable: true, field: 'USD' },
  { id: 'value', label: 'value', width: 120, visible: true, sortable: true, resizable: true, field: 'value' },
  { id: 'percentage', label: 'portfolio %', width: 140, visible: true, sortable: true, resizable: true, field: 'percentage' },
  { id: 'liquidation', label: 'swap amount', width: 140, visible: true, sortable: false, resizable: true, field: 'value' },
];

interface ResizableTableHeaderProps {
  column: ColumnConfig;
  onResize: (columnId: string, newWidth: number) => void;
  onSort: (field: SortField) => void;
  sortField: SortField;
  sortDirection: 'asc' | 'desc';
}

export function ResizableTableHeader({
  column,
  onResize,
  onSort,
  sortField,
  sortDirection,
}: ResizableTableHeaderProps) {
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
    width: `${column.width}px`,
    opacity: isDragging ? 0.5 : 1,
  };

  const isResizing = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = column.width;

    const handlePointerMove = (pe: PointerEvent) => {
      if (!isResizing.current) return;
      const deltaX = pe.clientX - startXRef.current;
      const newWidth = Math.max(40, startWidthRef.current + deltaX);
      onResize(column.id, newWidth);
    };

    const handlePointerUp = () => {
      isResizing.current = false;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleHeaderClick = () => {
    if (column.sortable) {
      onSort(column.field);
    }
  };

  return (
    <th
      key={column.id}
      style={{ width: `${column.width}px`, background: 'var(--bg-tertiary)' }}
      className="relative py-3 sm:py-4 px-2 sm:px-4 group select-none"
    >
      <div className="flex items-center justify-between h-full">

        <div className="flex items-center space-x-2 flex-1 h-full">
          {column.resizable && (
            <div
              {...listeners}
              className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity p-2 -m-2  mobile-optimized"
              style={{ touchAction: 'none' }}
            >
              <GripVertical className="h-4 w-4 text-secondary" />
            </div>
          )}

          <div
            onClick={handleHeaderClick}
            className={`flex-1 h-full flex items-center ${column.sortable ? 'cursor-pointer hover:text-orange-primary mobile-optimized' : ''}`}
            style={{ touchAction: column.sortable ? 'manipulation' : 'auto' }}
          >
            <div className="flex items-center space-x-2">
              <span className="text-xs sm:text-sm font-semibold text-primary lowercase">
                {column.label}
              </span>
              {column.sortable && sortField === column.field && (
                <span className="text-orange-primary">
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
          </div>
        </div>

        {column.resizable && (
          <div
            className="absolute right-0 top-0 bottom-0 w-6 sm:w-4 cursor-col-resize z-20 transition-colors mobile-optimized"
            onPointerDown={handlePointerDown}
            style={{ touchAction: 'none' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--orange-glow)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          />
        )}
      </div>
    </th>
  );
}

interface ColumnCustomizationPanelProps {
  columns: ColumnConfig[];
  onToggleVisibility: (columnId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onReset: () => void;
  isOpen: boolean;
  onClose: () => void;
}

function SortableColumnItem({ column, onToggleVisibility }: { column: ColumnConfig; onToggleVisibility: (id: string) => void }) {
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
      style={{...style, background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)'}}
      className="flex items-center justify-between p-4  mobile-optimized"
    >
      <div className="flex items-center space-x-3 flex-1">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-3 -m-3  mobile-optimized"
          style={{ touchAction: 'none' }}
        >
          <GripVertical className="h-5 w-5 text-secondary" />
        </div>
        <span className="text-base text-primary lowercase flex-1">{column.label}</span>
      </div>
      <button
        onClick={() => onToggleVisibility(column.id)}
        className="p-3  transition-colors mobile-optimized"
        style={{ 
          touchAction: 'manipulation', 
          minHeight: '44px', 
          minWidth: '44px',
          background: 'var(--bg-secondary)'
        }}
      >
        {column.visible ? (
          <Eye className="h-5 w-5 text-green-primary" />
        ) : (
          <EyeOff className="h-5 w-5 text-secondary" />
        )}
      </button>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sortableKeyboardCoordinates = (event: any, args: any) => {
  switch (event.code) {
    case 'ArrowRight':
      return { x: args.containerRect.width, y: 0 };
    case 'ArrowLeft':
      return { x: -args.containerRect.width, y: 0 };
    default:
      return undefined;
  }
};

export function TokenTable({ 
  tokens,
  loading, 
  onTokenSelect, 
  selectedTokens, 
  totalSelectedValue,
  onRefreshPrices,
  processingProgress,
  totalToProcess,
  portfolioHistory = [],
  excludeTokenMint,
  updatedTokens = new Set()
}: TokenTableProps) {
  const [sortField, setSortField] = useState<SortField>('value');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchTerm, setSearchTerm] = useState('');
  const [retryLoading, setRetryLoading] = useState(false);
  const [retryProgress, setRetryProgress] = useState({ current: 0, total: 0 });
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [hideZeroValueTokens, setHideZeroValueTokens] = useState(true);
  const [isMobileView, setIsMobileView] = useState(false);

  const { enqueueRequest } = useRequestQueue();

  useEffect(() => {
    const checkMobileView = () => {
      setIsMobileView(window.innerWidth < 700);
    };
    
    checkMobileView();
    window.addEventListener('resize', checkMobileView);
    
    return () => window.removeEventListener('resize', checkMobileView);
  }, []);
  
  const {
    columns,
    updateColumnWidth,
    toggleColumnVisibility,
    reorderColumns,
    resetColumns,
  } = useColumnState();

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
    setIsMounted(true);
  }, []);

  useEffect(() => {}, [loading, processingProgress, totalToProcess, tokens]);

  const totalPortfolioValue = useMemo(() => {
    return tokens.reduce((total, token) => total + (token.value || 0), 0);
  }, [tokens]);

  const filteredAndSortedTokens = useMemo(() => {
    let tokensToShow = excludeTokenMint 
      ? tokens.filter(token => token.mint !== excludeTokenMint)
      : tokens;

    if (hideZeroValueTokens) {
      tokensToShow = tokensToShow.filter(token => !(token.value === 0 && token.uiAmount > 0));
    }

    const filtered = tokensToShow.filter(token =>
      token.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      token.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    filtered.sort((a, b) => {
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
        case 'USD':
          aValue = a.price || 0;
          bValue = b.price || 0;
          break;
        case 'value':
          aValue = a.value || 0;
          bValue = b.value || 0;
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

    return filtered;
  }, [tokens, searchTerm, sortField, sortDirection, excludeTokenMint, hideZeroValueTokens]);

  const failedTokens = useMemo(() => 
    tokens.filter(token => token.value === 0 && token.uiAmount > 0),
    [tokens]
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  useEffect(() => {
  }, []);

  useEffect(() => {
    if (retryLoading) {
    }
  }, [retryLoading, failedTokens.length]);

  const handleRetryFailedTokens = async () => {
    if (failedTokens.length === 0 || retryLoading) return;
    
    setRetryLoading(true);
    setRetryProgress({ current: 0, total: failedTokens.length });
    
    enqueueRequest(async () => {
      try {
        if (onRefreshPrices) {
          await onRefreshPrices();
        }
      } catch (error) {
        console.error('failed to retry tokens:', error);
      } finally {
        setRetryLoading(false);
        setRetryProgress({ current: 0, total: 0 });
      }
    });
  };

  const isRetryLoading = retryLoading && retryProgress.total > 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleHeaderDragEnd = (event: any) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const oldIndex = columns.findIndex(col => col.id === active.id);
      const newIndex = columns.findIndex(col => col.id === over.id);
      reorderColumns(oldIndex, newIndex);
    }
  };

  const visibleColumns = columns.filter(col => col.visible);

  const renderTableCell = (token: TokenBalance, columnId: string) => {
    switch (columnId) {
      case 'select':
        return (
          <input
            type="checkbox"
            checked={token.selected}
            onChange={(e) => onTokenSelect(token.mint, e.target.checked)}
            className="border-primary text-orange-primary focus:ring-2 focus:ring-orange-primary focus:ring-offset-2 focus:ring-offset-secondary mx-0 w-4 h-4 sm:w-5 sm:h-5 transition-all duration-300 mobile-optimized"
            style={{ touchAction: 'manipulation' }}
          />
        );
      
      case 'symbol':
        return (
          <div className="flex items-center space-x-2 sm:space-x-3 lowercase">
            <TokenLogo token={token} size={8} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm sm:text-base text-primary truncate">
                {token.symbol}
              </div>
              <div className="text-xs text-secondary truncate">{token.name}</div>
            </div>
          </div>
        );
      
      case 'balance':
        return (
          <div className="text-right text-xs sm:text-sm font-mono text-primary">
            {token.uiAmount < 0.0001 ? token.uiAmount.toExponential(2) : token.uiAmount.toFixed(4)}
          </div>
        );
      
      case 'price':
        return (
          <div className="text-right">
            <div className="text-xs sm:text-sm font-mono text-primary transition-all duration-500">
              <span 
                className={updatedTokens.has(token.mint) ? 'price-updated' : ''}
                style={{
                  animationDelay: updatedTokens.has(token.mint) ? `${(filteredAndSortedTokens.findIndex(t => t.mint === token.mint) * 0.05)}s` : '0s'
                }}
              >
                {token.price ? `$${token.price < 0.01 ? token.price.toExponential(2) : token.price.toFixed(2)}` : '- -'}
              </span>
            </div>
            {token.changePercent24h !== undefined && token.changePercent24h !== null && (
              <div className="mt-1 flex justify-end transition-all duration-500">
                <PerformanceIndicator changePercent24h={token.changePercent24h} />
              </div>
            )}
          </div>
        );
      
      case 'value':
        return (
          <div className={`text-right text-xs sm:text-sm font-mono font-semibold transition-all duration-500 ${
              token.value > 0 ? 'text-green-primary' : 'text-tertiary'
            }`}>
            <span
              className={updatedTokens.has(token.mint) ? 'price-updated' : ''}
              style={{
                animationDelay: updatedTokens.has(token.mint) ? `${(filteredAndSortedTokens.findIndex(t => t.mint === token.mint) * 0.05)}s` : '0s'
              }}
            >
              {token.value ? `$${token.value.toFixed(2)}` : '$0.00'}
            </span>
          </div>
        );
      
      default:
        return null;
    }
  };

  const isProgressComplete = totalToProcess > 0 && processingProgress >= totalToProcess;
  const shouldShowLoading = (loading || isRetryLoading) && !isProgressComplete;

  if (shouldShowLoading) {
    const currentProgress = isRetryLoading ? retryProgress.current : processingProgress;
    const currentTotal = isRetryLoading ? retryProgress.total : totalToProcess;

    return (
      <div className="mr-3 ml-3 flex flex-col items-center justify-center py-12 space-y-6">
        <div className="w-full max-w-md">
          <LoadingBar 
            totalItems={currentTotal}
            currentProcessed={currentProgress}
            itemType="tokens"
            durationPerItem={1100}
            className="mb-4"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 -mx-3">
      {portfolioHistory && portfolioHistory.length > 0 && (
        <CollapsibleSection 
          title="performance"
          defaultOpen={true}
          className=""
        >
          <PortfolioChart 
            className="w-full"
            portfolioHistory={portfolioHistory}
            livePortfolioValue={totalPortfolioValue}
            liveTokenCount={tokens.length}
            liveWalletCount={1}
            mode="tokentable"
          />
        </CollapsibleSection>
      )}

      <CollapsibleSection 
        title="search"
        defaultOpen={true}
        className=""
      >
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-secondary h-5 w-5" />
            <input
              type="text"
              placeholder="search tokens by name or symbol..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ 
                background: 'var(--bg-tertiary)',
                borderColor: 'var(--border-secondary)',
                color: 'var(--text-primary)'
              }}
              className="w-full pl-10 pr-4 py-3 border  focus:outline-none text-sm"
            />
          </div>
          
          {failedTokens.length > 0 && (
            <button
              onClick={handleRetryFailedTokens}
              disabled={retryLoading}
              className="btn-primary px-4 py-3  disabled:opacity-50 text-sm font-medium"
            >
              {retryLoading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 text-white" style={{ color: 'white' }}>
                    <div className="circular-dot-spinner"></div>
                  </div>
                  <span className="text-sm">retrying...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                </div>
              )}
            </button>
          )}
        </div>

        {selectedTokens.length > 0 && (
          <div className=" p-4 mt-4" style={{ 
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-success)'
          }}>
            <div className="flex justify-between items-center text-sm">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 " style={{ background: 'var(--orange-primary)' }}></div>
                <span className="text-primary font-medium">
                  {selectedTokens.length} token{selectedTokens.length !== 1 ? 's' : ''} selected
                </span>
              </div>
              <span className="text-green-primary font-bold">
                ${totalSelectedValue.toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection 
        title={`tokens • ${filteredAndSortedTokens.length} of ${tokens.length}`}
        defaultOpen={true}
        className="bg-tertiary  border border-primary overflow-hidden"
      >
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setHideZeroValueTokens(!hideZeroValueTokens)}
            className="flex items-center space-x-1 p-1 hover:bg-secondary  transition-colors text-secondary mobile-optimized"
            style={{ touchAction: 'manipulation' }}
          >
            <span>show 0&apos;s</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-300 ${
                hideZeroValueTokens ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>
        
        {/* Mobile Card View */}
        {isMobileView ? (
          <div className="space-y-3 mt-4">
            {filteredAndSortedTokens.map((token) => (
              <TokenCard 
                key={token.mint}
                token={token}
                onSelect={onTokenSelect}
                isUpdated={updatedTokens.has(token.mint)}
              />
            ))}
            {filteredAndSortedTokens.length === 0 && (
              <div className="text-center py-8 text-tertiary">
                no tokens found
              </div>
            )}
          </div>
        ) : isMounted ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleHeaderDragEnd}
          >
            <SortableContext 
              items={visibleColumns.map(col => col.id)} 
              strategy={horizontalListSortingStrategy}
            >
             <div className="overflow-x-auto mobile-scroll" style={{ touchAction: 'pan-x' }}>
                <table className="w-full min-w-[500px] sm:min-w-full token-table-mobile" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    {visibleColumns.map(col => (
                      <col key={col.id} style={{ width: `${col.width}px` }} />
                    ))}
                    <col style={{ width: '48px' }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-primary bg-secondary">
                      {visibleColumns.map((column) => (
                        <ResizableTableHeader
                          key={column.id}
                          column={column}
                          onResize={updateColumnWidth}
                          onSort={handleSort}
                          sortField={sortField}
                          sortDirection={sortDirection}
                        />
                      ))}

                      <th className="py-3 sm:py-4 px-2 sm:px-4 w-12 bg-secondary relative z-20 hidden sm:table-cell"> 
                        <div className="relative">
                          <button
                            onClick={() => setShowColumnPanel(!showColumnPanel)}
                            className="p-1 hover:bg-tertiary  transition-colors mobile-optimized"
                            style={{ touchAction: 'manipulation' }}
                          >
                            <Settings className="h-4 w-4 text-primary" />
                          </button>
                        </div>
                      </th>

                    </tr>
                  </thead>

                  <tbody>
                    {filteredAndSortedTokens.map((token, index) => (
                      <tr 
                        key={token.mint} 
                        className={`border-b border-primary hover:bg-tertiary transition-all duration-300 group ${
                          token.value === 0 && token.uiAmount > 0 ? 'opacity-70' : ''
                        } ${index % 2 === 0 ? 'bg-secondary' : 'bg-primary'}`}
                      >
                        {visibleColumns.map(column => (
                          <td
                            key={column.id}
                            style={{ width: `${column.width}px` }}
                            className="py-3 sm:py-4 px-2 sm:px-4"
                          >
                            {renderTableCell(token, column.id)}
                          </td>
                        ))}

                        <td className="py-3 sm:py-4 px-2 sm:px-4" />
                      </tr>
                    ))}
                  </tbody>
                </table>
               </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="overflow-x-auto mobile-scroll" style={{ touchAction: 'pan-x' }}>
            <table className="w-full min-w-[500px] sm:min-w-full token-table-mobile">
              <thead>
                <tr className="border-b border-primary bg-secondary">
                  
                  {visibleColumns.map((column) => (
                    <th
                      key={column.id}
                      style={{ width: column.width }}
                      className="relative py-3 sm:py-4 px-2 sm:px-4 bg-secondary group select-none"
                    >
                      <div className="flex items-center justify-between h-full">
                        {column.resizable && (
                          <div
                            className="absolute left-0 top-0 bottom-0 w-4 cursor-col-resize hover:bg-orange-primary active:bg-orange-dark z-10 touch-manipulation"
                          />
                        )}
                        
                        <div className="flex items-center space-x-2 flex-1 h-full">
                          {column.resizable && (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <GripVertical className="h-4 w-4 text-secondary" />
                            </div>
                          )}
                          
                          <div
                            onClick={() => column.sortable && handleSort(column.field)}
                            className={`flex-1 h-full flex items-center ${column.sortable ? 'cursor-pointer hover:text-primary mobile-optimized' : ''}`}
                            style={{ touchAction: column.sortable ? 'manipulation' : 'auto' }}
                          >
                            <div className="flex items-center space-x-2">
                              <span className="text-xs sm:text-sm font-semibold text-primary lowercase">
                                {column.label}
                              </span>
                              {column.sortable && sortField === column.field && (
                                <span className="text-secondary">
                                  {sortDirection === 'asc' ? '↑' : '↓'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {column.resizable && (
                          <div
                            className="absolute right-0 top-0 bottom-0 w-4 cursor-col-resize hover:bg-orange-primary active:bg-orange-dark z-10 touch-manipulation"
                          />
                        )}
                      </div>
                    </th>
                  ))}

                  <th className="py-3 sm:py-4 px-2 sm:px-4 w-12 bg-secondary relative z-20"> 
                    <div className="relative">
                      <button
                        onClick={() => setShowColumnPanel(!showColumnPanel)}
                        className="p-1 hover:bg-tertiary  transition-colors mobile-optimized"
                        style={{ touchAction: 'manipulation' }}
                      >
                        <Settings className="h-4 w-4 text-primary" />
                      </button>
                    </div>
                  </th>

                </tr>
              </thead>

              <tbody>
                {filteredAndSortedTokens.map((token, index) => (
                  <tr 
                    key={token.mint} 
                    className={`border-b border-primary hover:bg-tertiary transition-all duration-300 group ${
                      token.value === 0 && token.uiAmount > 0 ? 'opacity-70' : ''
                    } ${index % 2 === 0 ? 'bg-secondary' : 'bg-primary'}`}
                  >
                    {visibleColumns.map(column => (
                      <td 
                        key={column.id}
                        style={{ width: column.width }}
                        className="py-3 sm:py-4 px-2 sm:px-4"
                      >
                        {renderTableCell(token, column.id)}
                      </td>
                    ))}
                    
                    <td className="py-3 sm:py-4 px-2 sm:px-4"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </CollapsibleSection>

      {showColumnPanel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-secondary  p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">settings</h3>
              <button
                onClick={() => setShowColumnPanel(false)}
                className="text-secondary hover:text-primary p-2  transition-colors mobile-optimized"
                style={{ touchAction: 'manipulation' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="space-y-3 mb-6">
              <p className="text-sm text-secondary">
                drag to reorder columns, toggle visibility with the eye icon
              </p>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleHeaderDragEnd}
            >
              <SortableContext 
                items={columns.map(col => col.id)} 
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {columns.map((column) => (
                    <SortableColumnItem
                      key={column.id}
                      column={column}
                      onToggleVisibility={toggleColumnVisibility}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <div className="flex justify-between items-center mt-6 pt-4 border-t border-primary">
              <button
                onClick={resetColumns}
                className="px-4 py-2 bg-tertiary hover:bg-secondary  transition-colors text-sm font-medium mobile-optimized"
                style={{ touchAction: 'manipulation' }}
              >
                reset to default
              </button>
              <button
                onClick={() => setShowColumnPanel(false)}
                className="px-4 py-2 bg-gradient-to-r from-gray-600 to-black-600 hover:from-gray-500 hover:to-black-500  transition-colors text-sm font-medium mobile-optimized"
                style={{ touchAction: 'manipulation' }}
              >
                done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TokenTableWrapper(props: TokenTableProps) {
  return (
    <TokenTableErrorBoundary>
      <TokenTable {...props} />
    </TokenTableErrorBoundary>
  );
}
'use client';

import { useCallback, useEffect, useMemo, useState, memo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  HistorySummaryResponse,
} from '../types/history';
import { SwapHistoryChart } from './SwapHistoryChart';
import {
  Clock,
  RefreshCw,
  ArrowRightLeft,
  Activity,
  AlertTriangle,
} from 'lucide-react';

const HISTORY_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_HISTORY === 'true' ||
  process.env.ENABLE_HISTORY === 'true';

let swapHistoryRefreshCallback: (() => void) | null = null;

export function registerSwapHistoryRefresh(callback: () => void) {
  swapHistoryRefreshCallback = callback;
}

export function triggerSwapHistoryRefresh() {
  swapHistoryRefreshCallback?.();
}

// Optimized: Memoized component to prevent unnecessary re-renders
export const SwapHistoryPanel = memo(function SwapHistoryPanel() {
  const { publicKey } = useWallet();
  const [summary, setSummary] = useState<HistorySummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async () => {
    if (!publicKey || !HISTORY_ENABLED) return;

    setLoading(true);
    setError('');

    try {
      const wallet = publicKey.toBase58();
      // Optimized: Only fetch summary data, history detail view is commented out
      const summaryRes = await fetch(`/api/history/summary?wallet=${wallet}&range=30`);

      if (!summaryRes.ok) {
        throw new Error('summary request failed');
      }

      const summaryData = (await summaryRes.json()) as HistorySummaryResponse;
      setSummary(summaryData);
    } catch (err) {
      console.error('failed to load history:', err);
      setError('unable to load swap history');
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (publicKey && HISTORY_ENABLED) {
      loadHistory();
    } else {
      setSummary(null);
    }
  }, [publicKey, loadHistory]);

  const latestSummary = useMemo(() => {
    if (!summary || summary.points.length === 0) return null;
    const lastPoint = summary.points[summary.points.length - 1];
    const totalSold = summary.points.reduce(
      (sum, point) => sum + point.totalValue,
      0,
    );
    return {
      lastValue: lastPoint.totalValue,
      totalSold,
    };
  }, [summary]);

  if (!HISTORY_ENABLED) {
    return null;
  }

  if (!publicKey) {
    return (
      <div className="bg-secondary  p-6 border border-primary">
        <div className="text-center text-tertiary">
          <ArrowRightLeft className="h-8 w-8 mx-auto mb-3" />
          <p className="text-sm">connect your wallet to view swap history</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-secondary border border-primary  sm: p-4 sm:p-6 space-y-4 sm:space-y-6 -mx-4 sm:mx-0">
      <div className="flex items-center justify-between">
        <div className="ml-5 flex items-center space-x-3">
          <div className="p-2 bg-tertiary ">
            <Clock className="h-5 w-5 text-secondary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-primary">swaps</h3>
          </div>
        </div>
        <button
          onClick={loadHistory}
          disabled={loading}
          className="mr-4 flex items-center space-x-2 text-xs bg-tertiary px-3 py-2  border border-primary hover:bg-secondary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="flex items-center space-x-2 text-sm border  p-3" style={{
          color: 'var(--orange-dark)',
          background: 'rgba(217, 79, 31, 0.05)',
          borderColor: 'var(--border-error)'
        }}>
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-tertiary border border-primary  p-3 sm:p-4 -mx-2 sm:mx-0">
        <SwapHistoryChart
          summary={summary?.points ?? []}
          sellIndicators={summary?.sellIndicators ?? []}
        />
        {latestSummary && (
          <div className="ml-4 flex items-center justify-between mt-4 text-sm text-secondary">
            <div className="flex items-center space-x-2">
              <Activity className="h-4 w-4 text-secondary" />
              <span>
                latest day: $
                {latestSummary.lastValue.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="text-tertiary text-xs mr-4">
              30d total sold: $
              {latestSummary.totalSold.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
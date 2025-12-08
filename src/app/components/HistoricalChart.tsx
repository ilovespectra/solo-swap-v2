'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler,
  TooltipItem,
  ChartOptions
} from 'chart.js';
import { TrendingUp, Calendar, Download } from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler
);

interface PortfolioHistory {
  timestamp: Date;
  totalValue: number;
  walletCount: number;
  tokenCount: number;
}

interface PortfolioChartProps {
  className?: string;
  portfolioHistory?: Array<{
    timestamp: Date;
    totalValue: number;
    walletCount: number;
    tokenCount: number;
  }>;
  livePortfolioValue?: number;
  liveTokenCount?: number;
  liveWalletCount?: number;
  mode?: string; 
}

type TimeRange = '1d' | '30d' | '90d' | '1y' | 'all';

export function PortfolioChart({ 
  className = '', 
  portfolioHistory = [],
  livePortfolioValue,
  liveTokenCount,
  liveWalletCount}: PortfolioChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1d');
  const [valueUpdated, setValueUpdated] = useState(false);
  const prevLiveValue = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (livePortfolioValue !== undefined) {
      if (prevLiveValue.current === undefined) {
        prevLiveValue.current = livePortfolioValue;
        return;
      }
      
      if (prevLiveValue.current !== livePortfolioValue) {
        const animationTimer = setTimeout(() => {
          setValueUpdated(true);
        }, 0);
        const resetTimer = setTimeout(() => setValueUpdated(false), 800);
        
        prevLiveValue.current = livePortfolioValue;
        
        return () => {
          clearTimeout(animationTimer);
          clearTimeout(resetTimer);
        };
      }
    }
  }, [livePortfolioValue]);

  const filterDataByTimeRange = useCallback((data: PortfolioHistory[]): PortfolioHistory[] => {
    if (data.length === 0) return [];
    
    const now = new Date();
    const cutoffDate = new Date();

    switch (timeRange) {
      case '1d':
        cutoffDate.setDate(now.getDate() - 1);
        break;
      case '30d':
        cutoffDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        cutoffDate.setDate(now.getDate() - 90);
        break;
      case '1y':
        cutoffDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'all':
        return data;
    }

    return data.filter(item => item.timestamp >= cutoffDate);
  }, [timeRange]);

  const formatDate = (date: Date): string => {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let formattedDate: string;

    if (diffDays <= 1) {
      formattedDate = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } else if (diffDays <= 90) {
      formattedDate = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric'
      });
    } else {
      formattedDate = date.toLocaleDateString('en-US', { 
        month: 'short', 
        year: 'numeric'
      });
    }

    return formattedDate.toLowerCase();
  };

  const performanceStats = useMemo(() => {
    if (portfolioHistory.length < 2) return null;

    const filteredData = filterDataByTimeRange(portfolioHistory);
    if (filteredData.length < 2) return null;

    const firstValue = filteredData[0].totalValue;
    const lastValue = filteredData[filteredData.length - 1].totalValue;
    const change = lastValue - firstValue;
    const percentageChange = firstValue > 0 ? (change / firstValue) * 100 : 0;

    return {
      change,
      percentageChange,
      isPositive: change >= 0
    };
  }, [portfolioHistory, filterDataByTimeRange]);

  const getChartColors = () => {
    if (!performanceStats) {
      return {
        borderColor: 'rgb(156, 163, 175)',
        backgroundColor: 'rgba(156, 163, 175, 0.1)',
        tooltipBorderColor: 'rgba(156, 163, 175, 0.5)'
      };
    }

    if (performanceStats.isPositive) {
      return {
        borderColor: 'rgb(0, 255, 136)',
        backgroundColor: 'rgba(0, 255, 136, 0.1)',
        tooltipBorderColor: 'rgba(0, 255, 136, 0.5)'
      };
    } else {
      return {
        borderColor: 'rgb(217, 79, 31)',
        backgroundColor: 'rgba(217, 79, 31, 0.1)',
        tooltipBorderColor: 'rgba(217, 79, 31, 0.5)'
      };
    }
  };

  const chartColors = getChartColors();

  const getChartData = () => {
  const filteredData = filterDataByTimeRange(portfolioHistory);
  
  if (filteredData.length === 0) {
    return {
      labels: ['no data available'],
      datasets: [
        {
          label: 'total portfolio value',
          data: [0],
          borderColor: chartColors.borderColor,
          backgroundColor: chartColors.backgroundColor,
          fill: true,
          tension: 0,
        },
      ],
    };
  }

  return {
    labels: filteredData.map(() => ''),
    datasets: [
      {
        label: 'total portfolio value',
        data: filteredData.map(item => item.totalValue),
        borderColor: chartColors.borderColor,
        backgroundColor: chartColors.backgroundColor,
        borderWidth: 3,
        fill: true,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        pointBackgroundColor: 'transparent',
        pointBorderColor: 'transparent',
        pointBorderWidth: 0,
      },
    ],
  };
};

  const chartOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    title: {
      display: false,
    },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      titleColor: 'rgb(156, 163, 175)',
      bodyColor: 'white',
      borderColor: chartColors.tooltipBorderColor,
      borderWidth: 1,
      callbacks: {
        label: function(context: TooltipItem<'line'>): string {
          const value = context.parsed.y ?? 0;
          return `$${value.toLocaleString(undefined, { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
          })}`;
        },
        title: function(tooltipItems: TooltipItem<'line'>[]): string {
          const item = portfolioHistory.find(item => 
            formatDate(item.timestamp) === tooltipItems[0].label
          );
          if (item) {
            return item.timestamp.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            }).toLowerCase();
          }
          return tooltipItems[0].label;
        }
      }
    },
  },
  scales: {
    x: {
      grid: {
        color: 'rgba(75, 85, 99, 0.2)',
      },
      ticks: {
        color: 'rgb(156, 163, 175)',
        maxTicksLimit: 8,
      },
    },
    y: {
      grid: {
        color: 'rgba(75, 85, 99, 0.2)',
      },
      ticks: {
        color: 'rgb(156, 163, 175)',
        callback: function(value: number | string): string {
          const numericValue = typeof value === 'number' ? value : Number(value);
          return `$${numericValue.toLocaleString()}`;
        },
      },
      beginAtZero: true,
    },
  },
  interaction: {
    mode: 'nearest' as const,
    axis: 'x' as const,
    intersect: false,
  },
  elements: {
    line: {
      tension: 0,
    },
  },
};

  const downloadChartData = () => {
    const csvContent = [
      ['date', 'total value', 'wallet count', 'token count'],
      ...portfolioHistory.map(item => [
        item.timestamp.toISOString(),
        item.totalValue.toString(),
        item.walletCount.toString(),
        item.tokenCount.toString()
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio-history-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`bg-secondary  p-6 border border-primary ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 space-y-3 sm:space-y-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-tertiary ">
            <TrendingUp className="h-5 w-5 text-secondary" />
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Performance Stats */}
          {performanceStats && (
            <div className={`px-3 py-1  ${
              performanceStats.isPositive 
                ? 'text-green-primary' 
                : 'text-orange-dark'
            }`} style={{
              background: performanceStats.isPositive 
                ? 'rgba(0, 255, 136, 0.1)' 
                : 'rgba(217, 79, 31, 0.1)'
            }}>
              <div className="text-l font-medium">
                {performanceStats.isPositive ? '+' : ''}{performanceStats.percentageChange.toFixed(2)}%
              </div>
              <div className="text-xs">
                {performanceStats.isPositive ? '+' : ''}${performanceStats.change.toLocaleString(undefined, { 
                  minimumFractionDigits: 2, 
                  maximumFractionDigits: 2 
                })}
              </div>
            </div>
          )}

          {/* Download Button */}
          {portfolioHistory.length > 0 && (
            <button
              onClick={downloadChartData}
              className="p-2 bg-tertiary hover:bg-secondary  transition-colors"
              title="download csv"
            >
              <Download className="h-4 w-4 text-secondary" />
            </button>
          )}
        </div>
      </div>

     {/* Time Range Selector */}
      <div className="flex space-x-0.5 mb-4">
        {(['1d', '30d', '90d', '1y', 'all'] as TimeRange[]).map((range) => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`px-1.5 py-0.5 text-xs  transition-colors flex-1 text-center min-w-0 ${
              timeRange === range
                ? 'bg-tertiary text-primary'
                : 'bg-secondary text-secondary hover:bg-tertiary'
            }`}
          >
            {range === '1d' ? '1d' : 
            range === '30d' ? '1m' : 
            range === '90d' ? '3m' : 
            range === '1y' ? '1y' : 'all'}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="h-80 -mx-4">
        {portfolioHistory.length > 0 ? (
          <Line data={getChartData()} options={chartOptions} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Calendar className="h-12 w-12 text-tertiary mx-auto mb-3" />
              <p className="text-secondary">no portfolio history available</p>
              <p className="text-l text-tertiary mt-1">
                analyze your portfolio to start tracking performance
              </p>
            </div>
          </div>
        )}
      </div>

     {/* Summary Stats */}
    {(livePortfolioValue !== undefined || portfolioHistory.length > 0) && (
      <div className="grid grid-cols-3 gap-2 md:gap-4 mt-4 md:mt-6 pt-4 md:pt-6 border-t border-primary">
        <div className="text-center">
          <div className={`text-lg md:text-2xl font-bold text-green-primary transition-all ${
            valueUpdated ? 'price-updated' : ''
          }`}>
            ${(livePortfolioValue !== undefined ? livePortfolioValue : portfolioHistory[portfolioHistory.length - 1]?.totalValue || 0).toLocaleString(undefined, { 
              minimumFractionDigits: 2, 
              maximumFractionDigits: 2 
            })}
          </div>
          <div className="text-xs md:text-sm text-secondary">current value</div>
        </div>
        <div className="text-center">
          <div className="text-lg md:text-2xl font-bold text-secondary">
            {liveWalletCount !== undefined ? liveWalletCount : (portfolioHistory[portfolioHistory.length - 1]?.walletCount || 1)}
          </div>
          <div className="text-xs md:text-sm text-secondary">wallets</div>
        </div>
        <div className="text-center">
          <div className="text-lg md:text-2xl font-bold text-secondary">
            {liveTokenCount !== undefined ? liveTokenCount : (portfolioHistory[portfolioHistory.length - 1]?.tokenCount || 0)}
          </div>
          <div className="text-xs md:text-sm text-secondary">tokens</div>
        </div>
      </div>
    )}
    </div>
  );
}
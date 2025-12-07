import { useState, useEffect, useRef } from 'react';

interface LoadingBarProps {
  totalItems: number;
  currentProcessed: number;
  itemType?: string;
  durationPerItem?: number;
  className?: string;
  status?: 'analyzing' | 'fetching' | 'processing' | 'complete' | 'idle';
  currentItemName?: string;
  subProgress?: {
    total: number;
    current: number;
    type: string;
  };
}

export function LoadingBar({ 
  totalItems, 
  currentProcessed, 
  itemType = 'tokens',
  durationPerItem = 500,
  className = '' 
}: LoadingBarProps) {
  const startTimeRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);
  const previousProcessedRef = useRef<number>(0);
  const [timeRemaining, setTimeRemaining] = useState(0);

  const progress = totalItems > 0 ? Math.min((currentProcessed / totalItems) * 100, 100) : 0;

  useEffect(() => {
    const updateTime = () => {
      if (lastUpdateTimeRef.current === 0) {
        lastUpdateTimeRef.current = Date.now();
      }

      if (totalItems === 0 || currentProcessed === 0) {
        startTimeRef.current = null;
        previousProcessedRef.current = 0;
        setTimeRemaining(0);
        return;
      }

      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
        previousProcessedRef.current = currentProcessed;
        lastUpdateTimeRef.current = Date.now();
      }

      if (currentProcessed > previousProcessedRef.current && startTimeRef.current) {
        const now = Date.now();
        const elapsed = now - startTimeRef.current;
        const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
        
        if (timeSinceLastUpdate > 5000 && currentProcessed > 0) {
          startTimeRef.current = now - (durationPerItem * currentProcessed);
        }

        const itemsProcessed = currentProcessed;
        const itemsRemaining = totalItems - currentProcessed;

        if (itemsProcessed > 0 && itemsRemaining > 0) {
          const avgTimePerItem = elapsed / itemsProcessed;
          setTimeRemaining(avgTimePerItem * itemsRemaining);
        } else {
          setTimeRemaining(0);
        }

        previousProcessedRef.current = currentProcessed;
        lastUpdateTimeRef.current = now;
      }

      if (currentProcessed >= totalItems) {
        setTimeRemaining(0);
      }
    };

    updateTime();
  }, [totalItems, currentProcessed, durationPerItem]);

  const formatTimeRemaining = (ms: number): string => {
    if (ms <= 0) return '0s';
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const itemsRemaining = totalItems - currentProcessed;
  const isComplete = currentProcessed >= totalItems && totalItems > 0;
  const isStarted = currentProcessed > 0;

  return (
    <div className={`w-full ${className}`}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-gray-300 font-medium">
          {totalItems} {itemType} detected
        </span>
        <span className="text-sm text-gray-400">
          {isComplete ? 'complete!' : isStarted && timeRemaining > 0 ? `${formatTimeRemaining(timeRemaining)} remaining` : 'starting...'}
        </span>
      </div>

      <div className="w-full bg-gray-700 h-3 overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-gray-500 to-gray-200 transition-all duration-500 ease-out relative"
          style={{ width: `${progress}%` }}
        >
          {!isComplete && isStarted && (
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
        <span className="text-xs text-gray-400">
          {currentProcessed} of {totalItems} processed
        </span>
        <span className="text-xs text-gray-400">
          {Math.round(progress)}% complete
        </span>
      </div>

      {itemsRemaining > 0 && !isComplete && isStarted && (
        <div className="flex items-center justify-center mt-3 space-x-2">
          <div className="flex space-x-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 bg-gray-400 animate-pulse"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </div>
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
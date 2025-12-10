import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  serverTimestamp,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  HistorySummaryResponse,
  SwapBatchRecord,
  SwapBatchRecordWithId,
} from '../../types/history';

const HISTORY_COLLECTION = 'swapHistory';
const MAX_LIMIT = 100;

export const recordSwapBatch = async (
  record: SwapBatchRecord,
): Promise<string> => {
  try {
    const docRef = await addDoc(collection(db, HISTORY_COLLECTION), {
      ...record,
      createdAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    console.error('failed to record swap batch:', error);
    throw error;
  }
};

interface HistoryQueryOptions {
  limit?: number;
  cursor?: QueryDocumentSnapshot<DocumentData>;
}

export const fetchHistoryByWallet = async (
  wallet: string,
  options: HistoryQueryOptions = {},
): Promise<{
  data: SwapBatchRecordWithId[];
  nextCursor?: QueryDocumentSnapshot<DocumentData>;
}> => {
  const pageSize = Math.min(options.limit ?? 25, MAX_LIMIT);
  try {
    let historyQuery;
    
    if (options.cursor) {
      historyQuery = query(
        collection(db, HISTORY_COLLECTION),
        where('wallet', '==', wallet),
        orderBy('timestamp', 'desc'),
        startAfter(options.cursor),
        limit(pageSize)
      );
    } else {
      historyQuery = query(
        collection(db, HISTORY_COLLECTION),
        where('wallet', '==', wallet),
        orderBy('timestamp', 'desc'),
        limit(pageSize)
      );
    }

    const snapshot = await getDocs(historyQuery);
    const records: SwapBatchRecordWithId[] = snapshot.docs.map((doc) => {
      const raw = doc.data();
      const data = raw as SwapBatchRecord;
      const createdAt =
        data.timestamp ??
        (raw.createdAt instanceof Timestamp ? raw.createdAt.toMillis() : undefined);

      return {
        ...data,
        id: doc.id,
        createdAt,
      };
    });

    const nextCursor =
      snapshot.docs.length === pageSize
        ? snapshot.docs[snapshot.docs.length - 1]
        : undefined;

    return { data: records, nextCursor };
  } catch (error) {
    console.error('failed to fetch history:', error);
    throw error;
  }
};

const summaryCache = new Map<string, { data: HistorySummaryResponse; timestamp: number }>();
const SUMMARY_CACHE_TTL = 60000;

export const fetchHistorySummary = async (
  wallet: string,
  days: number = 30,
): Promise<HistorySummaryResponse> => {
  try {
    const cacheKey = `${wallet}-${days}`;
    const cached = summaryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < SUMMARY_CACHE_TTL) {
      return cached.data;
    }

    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    
    const historyQuery = query(
      collection(db, HISTORY_COLLECTION),
      where('wallet', '==', wallet),
      where('timestamp', '>=', since),
      orderBy('timestamp', 'desc'),
      limit(Math.min(50, MAX_LIMIT)),
    );

    const snapshot = await getDocs(historyQuery);
    const pointsMap = new Map<string, number>();
    const sellIndicators: HistorySummaryResponse['sellIndicators'] = [];

    snapshot.forEach((doc) => {
      const data = doc.data() as SwapBatchRecord;
      const dayKey = new Date(data.timestamp).toISOString().slice(0, 10);
      const existing = pointsMap.get(dayKey) ?? 0;
      pointsMap.set(dayKey, existing + (data.totals.valueUsdOut || 0));

      if (sellIndicators.length < 100 && data.chartIndicators) {
        data.chartIndicators.forEach((indicator) => {
          sellIndicators.push({
            timestamp: indicator.timestamp,
            valueUsd: indicator.valueUsd,
            token: indicator.symbol,
            outputToken: indicator.outputToken, 
            type: indicator.type,
          });
        });
      }
    });

    const points = Array.from(pointsMap.entries())
      .map(([day, value]) => ({
        timestamp: new Date(`${day}T00:00:00Z`).getTime(),
        totalValue: value,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    const result = { points, sellIndicators };
    
    summaryCache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    if (summaryCache.size > 20) {
      const oldestKey = Array.from(summaryCache.keys())[0];
      summaryCache.delete(oldestKey);
    }

    return result;
  } catch (error) {
    console.error('failed to fetch history summary:', error);
    throw error;
  }
};
import { NextResponse } from 'next/server';
import { recordSwapBatch, fetchHistoryByWallet } from '@/app/lib/firestore/history';
import { SwapBatchRecord } from '@/app/types/history';

const HISTORY_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_HISTORY === 'true' ||
  process.env.ENABLE_HISTORY === 'true';

export async function GET(request: Request) {
  if (!HISTORY_ENABLED) {
    return NextResponse.json({ data: [], nextCursor: null });
  }

  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  const limitParam = searchParams.get('limit');
  const cursorParam = searchParams.get('cursor');

  if (!wallet) {
    return NextResponse.json(
      { error: 'wallet parameter is required' },
      { status: 400 },
    );
  }

  try {
    const limit = limitParam ? Number(limitParam) : undefined;
    
    const history = await fetchHistoryByWallet(wallet, { limit });
    
    const responseData = {
      data: history.data,
      nextCursor: history.nextCursor ? 'has_more' : null
    };
    
    return NextResponse.json(responseData);
  } catch (error) {
    
    return NextResponse.json(
      { 
        error: 'failed to fetch history',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!HISTORY_ENABLED) {
    return NextResponse.json({ disabled: true }, { status: 200 });
  }

  try {
    const walletHeader = request.headers.get('x-wallet');
    
    if (!walletHeader) {
      return NextResponse.json(
        { error: 'missing wallet header' },
        { status: 401 },
      );
    }

    const payload = (await request.json()) as SwapBatchRecord | null;
    
    if (!payload) {
      return NextResponse.json(
        { error: 'invalid payload' },
        { status: 400 },
      );
    }

    if (payload.wallet !== walletHeader) {
      return NextResponse.json(
        { error: 'wallet mismatch' },
        { status: 403 },
      );
    }

    if (!payload.tokensIn || payload.tokensIn.length === 0) {
      return NextResponse.json(
        { error: 'no token data provided' },
        { status: 400 },
      );
    }

    const recordId = await recordSwapBatch(payload);
    
    return NextResponse.json({ id: recordId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { 
        error: 'failed to record swap history',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 },
    );
  }
}
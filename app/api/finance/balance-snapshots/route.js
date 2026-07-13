import { NextResponse } from 'next/server';
import { listBalanceSnapshots, createBalanceSnapshot } from '@/lib/queries/finance/balances';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function GET(request) {
  try {
    return NextResponse.json({ snapshots: listBalanceSnapshots({ account_key: request.nextUrl.searchParams.get('account') || undefined, active_only: request.nextUrl.searchParams.get('history') !== '1' }) });
  } catch (error) {
    const result = financeErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function POST(request) {
  try {
    return NextResponse.json({ snapshot: createBalanceSnapshot(await readFinanceJson(request), actorFromRequest(request)) }, { status: 201 });
  } catch (error) {
    const result = financeErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

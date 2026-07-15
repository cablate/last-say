import { NextResponse } from 'next/server';
import { getBalanceSheet } from '@/lib/queries/reports/balance-sheet';
import { financeErrorResponse } from '@/lib/finance/http';

export async function GET(request) {
  try {
    return NextResponse.json(getBalanceSheet(request.nextUrl.searchParams));
  } catch (error) {
    const response = financeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

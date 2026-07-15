import { NextResponse } from 'next/server';
import { getCashFlow } from '@/lib/queries/reports/cash-flow';
import { financeErrorResponse } from '@/lib/finance/http';

export async function GET(request) {
  try {
    return NextResponse.json(getCashFlow(request.nextUrl.searchParams));
  } catch (error) {
    const response = financeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

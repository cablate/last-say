import { NextResponse } from 'next/server';

import { financeErrorResponse } from '@/lib/finance/http';
import { getMonthlyFinancialPulse } from '@/lib/queries/finance/control/monthly-pulse';

export async function GET(request) {
  try {
    return NextResponse.json(getMonthlyFinancialPulse(request.nextUrl.searchParams));
  } catch (error) {
    const response = financeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

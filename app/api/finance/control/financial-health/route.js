import { NextResponse } from 'next/server';

import { financeErrorResponse } from '@/lib/finance/http';
import { getFinancialHealthReview } from '@/lib/queries/finance/control/financial-health';

export async function GET(request) {
  try {
    return NextResponse.json(getFinancialHealthReview(request.nextUrl.searchParams));
  } catch (error) {
    const response = financeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

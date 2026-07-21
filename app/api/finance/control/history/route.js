import { NextResponse } from 'next/server';

import { financeErrorResponse } from '@/lib/finance/http';
import { getFinancialDashboardHistory } from '@/lib/queries/finance/control/history';

export async function GET(request) {
  try {
    return NextResponse.json(getFinancialDashboardHistory(request.nextUrl.searchParams));
  } catch (error) {
    const response = financeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

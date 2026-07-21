import { NextResponse } from 'next/server';

import { financeErrorResponse } from '@/lib/finance/http';
import { getCashForecast } from '@/lib/queries/finance/control/forecast';

export async function GET(request) {
  try {
    return NextResponse.json(getCashForecast(request.nextUrl.searchParams));
  } catch (error) {
    const response = financeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

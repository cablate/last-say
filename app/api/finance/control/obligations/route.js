import { NextResponse } from 'next/server';

import { financeErrorResponse } from '@/lib/finance/http';
import { getObligationTimeline } from '@/lib/queries/finance/control/obligations';

export async function GET(request) {
  try {
    return NextResponse.json(getObligationTimeline(request.nextUrl.searchParams));
  } catch (error) {
    const response = financeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

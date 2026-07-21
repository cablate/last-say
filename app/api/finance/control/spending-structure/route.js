import { NextResponse } from 'next/server';

import { financeErrorResponse } from '@/lib/finance/http';
import { getSpendingStructure } from '@/lib/queries/finance/control/spending-structure';

export async function GET(request) {
  try {
    return NextResponse.json(getSpendingStructure(request.nextUrl.searchParams));
  } catch (error) {
    const response = financeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

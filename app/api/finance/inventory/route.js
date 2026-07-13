import { NextResponse } from 'next/server';
import { getFinanceInventory } from '@/lib/queries/finance/inventory';
import { financeErrorResponse } from '@/lib/finance/http';

export async function GET(request) {
  try {
    const params = request.nextUrl.searchParams;
    return NextResponse.json({ inventory: getFinanceInventory({ entityKey: params.get('entity') || 'personal', asOfDate: params.get('as_of') || undefined }) });
  } catch (error) {
    const result = financeErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

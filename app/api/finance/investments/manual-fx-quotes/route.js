import { NextResponse } from 'next/server';
import { createManualFxQuote } from '@/lib/queries/finance/investments';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function POST(request) {
  try {
    return NextResponse.json(createManualFxQuote(await readFinanceJson(request), actorFromRequest(request)), { status: 201 });
  } catch (error) {
    const result = financeErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

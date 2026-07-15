import { NextResponse } from 'next/server';
import { updateTransferMatch } from '@/lib/queries/finance/reconciliation';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function PATCH(request, { params }) {
  try {
    const { key } = await params;
    return NextResponse.json({ match: updateTransferMatch(key, await readFinanceJson(request), actorFromRequest(request)) });
  } catch (error) {
    const response = financeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

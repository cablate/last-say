import { NextResponse } from 'next/server';
import { updateInstrument } from '@/lib/queries/finance/investments';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function PATCH(request, { params }) {
  try {
    const { key } = await params;
    return NextResponse.json({ instrument: updateInstrument(key, await readFinanceJson(request), actorFromRequest(request)) });
  } catch (error) {
    const result = financeErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

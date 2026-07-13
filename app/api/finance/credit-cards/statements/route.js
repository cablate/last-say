import { NextResponse } from 'next/server';
import { createCardStatement } from '@/lib/queries/finance/obligations';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function POST(request) {
  try { return NextResponse.json({ statement: createCardStatement(await readFinanceJson(request), actorFromRequest(request)) }, { status: 201 }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

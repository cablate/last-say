import { NextResponse } from 'next/server';
import { listLiabilities, createLiability } from '@/lib/queries/finance/obligations';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function GET() {
  try { return NextResponse.json({ liabilities: listLiabilities() }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

export async function POST(request) {
  try { return NextResponse.json({ liability: createLiability(await readFinanceJson(request), actorFromRequest(request)) }, { status: 201 }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

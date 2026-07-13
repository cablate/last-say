import { NextResponse } from 'next/server';
import { createLoanSchedule } from '@/lib/queries/finance/obligations';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function POST(request, { params }) {
  try { const { key } = await params; return NextResponse.json({ liability: createLoanSchedule(key, await readFinanceJson(request), actorFromRequest(request)) }, { status: 201 }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

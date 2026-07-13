import { NextResponse } from 'next/server';
import { createOccurrence } from '@/lib/queries/finance/obligations';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function POST(request, { params }) {
  try { const { key } = await params; return NextResponse.json({ occurrence: createOccurrence(key, await readFinanceJson(request), actorFromRequest(request)) }, { status: 201 }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

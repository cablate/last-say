import { NextResponse } from 'next/server';
import { getCommitment, updateCommitment } from '@/lib/queries/finance/obligations';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function GET(_request, { params }) {
  try { const { key } = await params; return NextResponse.json({ commitment: getCommitment(key) }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

export async function PATCH(request, { params }) {
  try { const { key } = await params; return NextResponse.json({ commitment: updateCommitment(key, await readFinanceJson(request), actorFromRequest(request)) }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

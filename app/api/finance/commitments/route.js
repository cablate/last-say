import { NextResponse } from 'next/server';
import { listCommitments, createCommitment } from '@/lib/queries/finance/obligations';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function GET() {
  try { return NextResponse.json({ commitments: listCommitments() }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

export async function POST(request) {
  try { return NextResponse.json({ commitment: createCommitment(await readFinanceJson(request), actorFromRequest(request)) }, { status: 201 }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

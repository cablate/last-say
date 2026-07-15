import { NextResponse } from 'next/server';
import { listReimbursementMatches, createReimbursementMatch } from '@/lib/queries/finance/reimbursements';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function GET(request) {
  try {
    return NextResponse.json({ matches: listReimbursementMatches({ status: request.nextUrl.searchParams.get('status') || null }) });
  } catch (error) {
    const response = financeErrorResponse(error); return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request) {
  try {
    return NextResponse.json({ match: createReimbursementMatch(await readFinanceJson(request), actorFromRequest(request)) }, { status: 201 });
  } catch (error) {
    const response = financeErrorResponse(error); return NextResponse.json(response.body, { status: response.status });
  }
}

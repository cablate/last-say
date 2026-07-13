import { NextResponse } from 'next/server';
import { getCreditCard, updateCreditCardProfile } from '@/lib/queries/finance/obligations';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function GET(_request, { params }) {
  try { const { key } = await params; return NextResponse.json({ credit_card: getCreditCard(key) }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

export async function PATCH(request, { params }) {
  try { const { key } = await params; return NextResponse.json({ credit_card: updateCreditCardProfile(key, await readFinanceJson(request), actorFromRequest(request)) }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

import { NextResponse } from 'next/server';
import { previewIngestion } from '@/lib/finance/ingestion';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function POST(request) {
  try {
    return NextResponse.json({ run: previewIngestion(await readFinanceJson(request), actorFromRequest(request)) }, { status: 201 });
  } catch (error) {
    const result = financeErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

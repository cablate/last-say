import { NextResponse } from 'next/server';
import { commitIngestion } from '@/lib/finance/ingestion';
import { actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function POST(request, { params }) {
  try {
    const { key } = await params;
    return NextResponse.json({ run: commitIngestion(key, actorFromRequest(request)) });
  } catch (error) {
    const result = financeErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

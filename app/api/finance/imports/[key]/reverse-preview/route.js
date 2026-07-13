import { NextResponse } from 'next/server';
import { reversePreview } from '@/lib/finance/ingestion/reversal';
import { financeErrorResponse } from '@/lib/finance/http';

export async function POST(_request, { params }) {
  try {
    const { key } = await params;
    return NextResponse.json({ impact: reversePreview(key) });
  } catch (error) {
    const result = financeErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

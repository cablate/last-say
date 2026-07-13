import { NextResponse } from 'next/server';
import { getIngestionRun } from '@/lib/finance/ingestion';
import { financeErrorResponse } from '@/lib/finance/http';

export async function GET(_request, { params }) {
  try {
    const { key } = await params;
    return NextResponse.json({ run: getIngestionRun(key) });
  } catch (error) {
    const result = financeErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

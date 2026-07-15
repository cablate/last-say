import { NextResponse } from 'next/server';
import { reviewWorkbench } from '@/lib/queries/finance/review-workbench';
import { financeErrorResponse } from '@/lib/finance/http';

export async function GET() {
  try {
    return NextResponse.json(reviewWorkbench());
  } catch (error) {
    const response = financeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

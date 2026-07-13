import { NextResponse } from 'next/server';
import { getLiability } from '@/lib/queries/finance/obligations';
import { financeErrorResponse } from '@/lib/finance/http';

export async function GET(_request, { params }) {
  try { const { key } = await params; return NextResponse.json({ liability: getLiability(key) }); }
  catch (error) { const result = financeErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
}

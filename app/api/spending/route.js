import { NextResponse } from 'next/server';
import { safeErrorMessage } from '@/lib/api-helpers';
import { getSpending } from '@/lib/queries';

export async function GET(request) {
  try {
    const { searchParams } = request.nextUrl;
    const month = searchParams.get('month');
    const category = searchParams.get('category');
    const scope = searchParams.get('scope');
    const data = getSpending(month, category, scope);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

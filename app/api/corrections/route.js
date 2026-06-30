import { NextResponse } from 'next/server';
import { getCorrections } from '@/lib/queries';

export async function GET(request) {
  try {
    const { searchParams } = request.nextUrl;
    const limit = searchParams.get('limit');
    const field = searchParams.get('field');
    const matchKey = searchParams.get('matchKey') || searchParams.get('key');
    const data = getCorrections({ limit, field, matchKey });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

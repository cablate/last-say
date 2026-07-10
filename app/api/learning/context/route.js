import { NextResponse } from 'next/server';
import { safeErrorMessage } from '@/lib/api-helpers';
import {
  MAX_LEARNING_BATCH,
  getLearningOverview,
  getMerchantLearningContext,
  getMerchantLearningContexts,
} from '@/lib/queries';

function inputError(error) {
  const message = String(error?.message || error);
  return message.includes('required') || message.includes('maximum batch size');
}

// GET without name returns the learning-loop overview used at Flow B preflight.
// GET with name returns deterministic evidence for one merchant.
export async function GET(request) {
  try {
    const { searchParams } = request.nextUrl;
    const name = searchParams.get('name');
    if (!name) return NextResponse.json(getLearningOverview());
    return NextResponse.json({
      context: getMerchantLearningContext({
        name,
        sourceType: searchParams.get('sourceType') || searchParams.get('source_type'),
        direction: searchParams.get('direction'),
        limit: searchParams.get('limit'),
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: inputError(error) ? 400 : 500 },
    );
  }
}

// POST batches merchant lookups so a monthly import does not need one request per row.
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: '請求內容不是有效的 JSON' }, { status: 400 });
    }
    if (Array.isArray(body?.items) && body.items.length > MAX_LEARNING_BATCH) {
      return NextResponse.json(
        { error: `items exceeds maximum batch size ${MAX_LEARNING_BATCH}` },
        { status: 400 },
      );
    }
    return NextResponse.json({ contexts: getMerchantLearningContexts(body?.items) });
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: inputError(error) ? 400 : 500 },
    );
  }
}

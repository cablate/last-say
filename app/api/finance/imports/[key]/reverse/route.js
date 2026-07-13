import { NextResponse } from 'next/server';
import { consumeHumanConfirmation } from '@/lib/queries/finance/human-confirmations';
import { reverseIngestion } from '@/lib/finance/ingestion/reversal';
import { getDb } from '@/lib/db';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';

export async function POST(request, { params }) {
  try {
    const { key } = await params; const body = await readFinanceJson(request); const db = getDb();
    const result = consumeHumanConfirmation({ action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: key, payload: body.payload, expected_version: null, proposal_key: body.proposal_key, confirmation_receipt: body.confirmation_receipt }, (authorization) => reverseIngestion(key, body.payload, actorFromRequest(request), db, authorization), db);
    return NextResponse.json({ result });
  } catch (error) {
    const result = financeErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

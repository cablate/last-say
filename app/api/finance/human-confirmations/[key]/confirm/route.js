import { NextResponse } from 'next/server';
import { confirmHumanConfirmation, consumeHumanConfirmation, getHumanConfirmation } from '@/lib/queries/finance/human-confirmations';
import { createScopeAttestation } from '@/lib/queries/finance/scope';
import { getDb } from '@/lib/db';
import { withTransaction } from '@/lib/queries/finance/common';
import { readFinanceJson, actorFromRequest, financeErrorResponse } from '@/lib/finance/http';
import { FinanceError } from '@/lib/finance/contracts';
import { reverseIngestion } from '@/lib/finance/ingestion/reversal';

export async function POST(request, { params }) {
  try {
    const origin = request.headers.get('origin')
    const fetchSite = request.headers.get('sec-fetch-site')
    const forwardedProtocol = request.headers.get('x-forwarded-proto') || 'http'
    const host = request.headers.get('host')
    const allowedOrigins = new Set([request.nextUrl.origin, host ? `${forwardedProtocol}://${host}` : null])
    if (!origin || !allowedOrigins.has(origin)) {
      throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Confirmation origin does not match this Last Say instance', { status: 403 })
    }
    if (fetchSite !== 'same-origin') {
      throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Same-origin browser Fetch Metadata is required', { status: 403 })
    }
    const body = await readFinanceJson(request)
    const cookie = request.cookies.get('last_say_confirmation_session')?.value
    if (!cookie) {
      throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Browser confirmation session is missing', { status: 403 })
    }
    if (body.browser_nonce !== cookie) {
      throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Browser confirmation session does not match', { status: 403 })
    }

    const { key } = await params
    const db = getDb()
    const result = withTransaction(db, () => {
      const proposal = getHumanConfirmation(key, db)
      const canDeclareScope = proposal.action_kind === 'declare_scope_complete' && proposal.resource_type === 'scope_attestation'
      const canReverseRun = proposal.action_kind === 'reverse_ingestion_run' && proposal.resource_type === 'ingestion_run'
      if (!canDeclareScope && !canReverseRun) {
        throw new FinanceError('REVIEW_REQUIRED', 'This action has no Phase 1 browser executor', { status: 409 })
      }
      const confirmed = confirmHumanConfirmation(key, { browserConfirmed: true }, db)
      return consumeHumanConfirmation({
        action_kind: proposal.action_kind,
        resource_type: proposal.resource_type,
        resource_key: proposal.resource_key,
        payload: proposal.payload,
        expected_version: proposal.expected_version,
        proposal_key: key,
        confirmation_receipt: confirmed.confirmation_receipt,
      }, (authorization) => canDeclareScope
        ? createScopeAttestation(proposal.payload, actorFromRequest(request), db, authorization)
        : reverseIngestion(proposal.resource_key, proposal.payload, actorFromRequest(request), db, authorization), db)
    })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const result = financeErrorResponse(error)
    return NextResponse.json(result.body, { status: result.status })
  }
}

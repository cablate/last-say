import { NextResponse } from 'next/server';
import { safeErrorMessage } from '@/lib/api-helpers';
import { reclassifyRuleHistory } from '@/lib/queries';

// POST /api/rules/:id/reclassify — 清理由舊版留下、仍指向此規則的歷史交易。
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const ruleId = Number(id);
    if (!Number.isFinite(ruleId)) {
      return NextResponse.json({ error: 'Invalid rule id' }, { status: 400 });
    }
    const mutation = reclassifyRuleHistory(ruleId);
    if (!mutation) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    return NextResponse.json({ ok: true, ...mutation });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 500 },
    );
  }
}

import { NextResponse } from 'next/server';
import { markReviewed } from '@/lib/queries';

// POST /api/transactions/review — 批次標記交易為「已審」（reviewed=1）。
// 用途：人類在審查佇列一鍵認可規則自動套用的交易（隱性正向信號，區分「看過」與「沒看過」）。
// body: { ids: [1,2,3] }，上限 500。
export async function POST(request) {
  try {
    const body = await request.json();
    const ids = Array.isArray(body && body.ids) ? body.ids : [];
    const result = markReviewed(ids);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: String((err && err.message) || err) },
      { status: 500 }
    );
  }
}

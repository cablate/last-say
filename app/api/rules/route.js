import { NextResponse } from 'next/server';
import { listRules, createRule } from '@/lib/queries';

// GET /api/rules — 列分類規則（給 UI 規則管理介面）。
// query: enabled('all'|1|0)、maxConfidence（低信心篩選）、origin、q(關鍵字)
export async function GET(request) {
  try {
    const { searchParams } = request.nextUrl;
    const filter = {
      enabled: searchParams.get('enabled'),
      maxConfidence: searchParams.get('maxConfidence'),
      origin: searchParams.get('origin'),
      q: searchParams.get('q'),
    };
    return NextResponse.json({ rules: listRules(filter) });
  } catch (err) {
    return NextResponse.json(
      { error: String((err && err.message) || err) },
      { status: 500 }
    );
  }
}

// POST /api/rules — 新增規則（外部 AI 產規則 / UI 手動新增）。
// body: { match_key, source_type, direction, owner_value, category_value, necessity_value,
//         confidence, sample_count, origin, enabled, note }
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: '請求內容不是有效的 JSON' }, { status: 400 });
    }
    const rule = createRule(body || {});
    return NextResponse.json({ ok: true, rule }, { status: 201 });
  } catch (err) {
    const msg = String((err && err.message) || err);
    // validateRule 的條件/結果不足錯誤屬使用者輸入問題 → 400
    const status = msg.includes('至少需') ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

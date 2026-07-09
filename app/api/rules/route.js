import { NextResponse } from 'next/server';
import { safeErrorMessage } from '@/lib/api-helpers';
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
      { error: safeErrorMessage(err) },
      { status: 500 }
    );
  }
}

// POST /api/rules — 新增規則（外部 AI 產規則 / UI 手動新增）。
// body: { match_key, source_type, direction, category_value,
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
    // createRule 對非標準 category_value 附 warning（軟校驗）；提升到回應頂層供 AI/UI 顯示。
    const { warning, ...ruleData } = rule;
    const response = { ok: true, rule: ruleData };
    if (warning) response.warning = warning;
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    const msg = String((err && err.message) || err);
    // validateRule 的輸入校驗錯誤（條件/結果不足、match_key 正規化後為空）屬使用者輸入問題 → 400
    const status = (msg.includes('至少需') || msg.includes('match_key 正規化後為空')) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

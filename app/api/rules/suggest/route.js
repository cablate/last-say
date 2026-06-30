import { NextResponse } from 'next/server';
import { suggestFromHistory } from '@/lib/queries';

// GET /api/rules/suggest — 冷啟動建議。
// 聚合已分類歷史交易 → 同 (match_key, source_type, direction) 眾數分類 → 建議清單。
// 供外部 AI 當 bootstrap 來源（AI 再 POST 成規則，origin='bootstrap'）。本工具不自己建規則。
export async function GET() {
  try {
    return NextResponse.json({ suggestions: suggestFromHistory() });
  } catch (err) {
    return NextResponse.json(
      { error: String((err && err.message) || err) },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { normalizeForRule } from '@/lib/normalize';

// GET /api/rules/normalize?text=... — 正規化預覽。
// 供外部 AI 產規則前驗證 match_key（確保與本工具匯入套用算出的鍵一致）。
export async function GET(request) {
  try {
    const { searchParams } = request.nextUrl;
    const text = searchParams.get('text') || '';
    return NextResponse.json({ input: text, match_key: normalizeForRule(text) });
  } catch (err) {
    return NextResponse.json(
      { error: String((err && err.message) || err) },
      { status: 500 }
    );
  }
}

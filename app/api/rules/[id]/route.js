import { NextResponse } from 'next/server';
import { getRule, updateRule, setRuleEnabled, deleteRule } from '@/lib/queries';

// GET /api/rules/:id — 單筆規則明細。
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const ruleId = Number(id);
    if (!Number.isFinite(ruleId)) {
      return NextResponse.json({ error: 'Invalid rule id' }, { status: 400 });
    }
    const rule = getRule(ruleId);
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    return NextResponse.json({ rule });
  } catch (err) {
    return NextResponse.json(
      { error: String((err && err.message) || err) },
      { status: 500 }
    );
  }
}

// PATCH /api/rules/:id — 更新規則。body 僅含 enabled → 快速啟停；否則部分更新欄位。
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const ruleId = Number(id);
    if (!Number.isFinite(ruleId)) {
      return NextResponse.json({ error: 'Invalid rule id' }, { status: 400 });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: '請求內容不是有效的 JSON' }, { status: 400 });
    }
    let rule;
    const onlyEnabled =
      body && Object.prototype.hasOwnProperty.call(body, 'enabled') && Object.keys(body).length === 1;
    if (onlyEnabled) {
      rule = setRuleEnabled(ruleId, body.enabled);
    } else {
      rule = updateRule(ruleId, body || {});
    }
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    return NextResponse.json({ ok: true, rule });
  } catch (err) {
    const msg = String((err && err.message) || err);
    const status = msg.includes('至少需') ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/rules/:id — 刪除規則。transactions.rule_id 因 ON DELETE SET NULL 自動清空。
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const ruleId = Number(id);
    if (!Number.isFinite(ruleId)) {
      return NextResponse.json({ error: 'Invalid rule id' }, { status: 400 });
    }
    const ok = deleteRule(ruleId);
    if (!ok) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: String((err && err.message) || err) },
      { status: 500 }
    );
  }
}

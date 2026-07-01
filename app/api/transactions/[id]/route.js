import { NextResponse } from 'next/server';
import { safeErrorMessage } from '@/lib/api-helpers';
import { getDb } from '@/lib/db';
import { patchTransaction } from '@/lib/queries';

// GET /api/transactions/:id — 單筆交易明細。
// SQL 模式參考原 src/server.js 第 372-389 行：t.* JOIN accounts LEFT JOIN sources + correction_count 子查詢。
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const txnId = Number(id);
    // audit：[id] 動態段落不保證為數字（原 server.js 靠正則保護），這裡顯式檢查擋 NaN/字串。
    if (!Number.isFinite(txnId)) {
      return NextResponse.json(
        { error: 'Invalid transaction id' },
        { status: 400 }
      );
    }
    const db = getDb();
    const txn = db
      .prepare(
        `
        SELECT t.*,
          a.name AS account_name,
          s.description AS source_description,
          (
            SELECT COUNT(*)
            FROM correction_log cl
            WHERE cl.transaction_id = t.id
          ) AS correction_count
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN sources s ON s.id = t.first_source_id
        WHERE t.id = ?
        `
      )
      .get(txnId);
    if (!txn) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }
    return NextResponse.json(txn);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 500 }
    );
  }
}

// PATCH /api/transactions/:id — 單筆人工修正（owner/category/necessity/memo 白名單欄位）。
// 寫入 + log 由 patchTransaction 包在同一 DB transaction（audit P2#7），這裡只透傳 status/body。
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const txnId = Number(id);
    if (!Number.isFinite(txnId)) {
      return NextResponse.json(
        { error: 'Invalid transaction id' },
        { status: 400 }
      );
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: '請求內容不是有效的 JSON' }, { status: 400 });
    }
    const result = patchTransaction(txnId, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 500 }
    );
  }
}

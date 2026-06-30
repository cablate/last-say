import { NextResponse } from 'next/server';
import { safeErrorMessage } from '@/lib/api-helpers';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

// scripts/seed-from-ledger.js 是 CJS（module.exports），且不在 Next 的 bundle 範圍。
// webpack 會把 createRequire(import.meta.url) 與其回傳值的動態 require 換成會丟
// MODULE_NOT_FOUND 的 stub，因此必須改用 __non_webpack_require__（webpack 不改寫）
// 取得原生 Node require；非 webpack 環境（例如直接以 node 跑測試）退回 createRequire。
const _require =
  typeof __non_webpack_require__ !== 'undefined'
    ? __non_webpack_require__
    : createRequire(import.meta.url);
const _seedModule = _require(path.join(process.cwd(), 'scripts', 'seed-from-ledger'));
const seedMain = _seedModule.main;

// audit P0#1：csvPath / sourcePath 白名單，僅允許 process.cwd() 下的 uploads / data / outputs。
const ALLOWED_BASES = ['uploads', 'data', 'outputs'];

function isAllowedPath(candidate) {
  if (!candidate || typeof candidate !== 'string') return false;
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, candidate);
  return ALLOWED_BASES.some((base) => {
    const dir = path.join(cwd, base);
    // 用 dir + path.sep 避免 prefix 假陽性（如 uploads-evil）。
    return resolved === dir || resolved.startsWith(dir + path.sep);
  });
}

// POST /api/import-ledger
// body: { csvPath | ledgerPath, csvContent, sourcePath | sourceIndexPath }
// audit P0#1：路徑白名單；csvContent 模式寫暫存檔並在 finally 清理。
export async function POST(request) {
  let tmpPath = null;
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: '請求內容不是有效的 JSON' }, { status: 400 });
    }
    let csvPath = body.csvPath || body.ledgerPath || null;
    const csvContent = body.csvContent;
    const sourcePath = body.sourcePath || body.sourceIndexPath || null;

    // csvContent 模式：寫暫存檔到 uploads/finance/import-<ts>.csv，不論成敗最後清理。
    if (csvContent) {
      const fileName = `import-${Date.now()}.csv`;
      tmpPath = path.join(process.cwd(), 'uploads', 'finance', fileName);
      await fs.mkdir(path.dirname(tmpPath), { recursive: true });
      await fs.writeFile(tmpPath, csvContent, 'utf8');
      csvPath = tmpPath;
    }

    if (!csvPath) {
      return NextResponse.json(
        { error: 'csvPath or csvContent required' },
        { status: 400 }
      );
    }

    // audit P0#1：白名單檢查（path.resolve + startsWith）。
    if (!isAllowedPath(csvPath)) {
      return NextResponse.json(
        { error: 'csvPath outside allowed directories' },
        { status: 400 }
      );
    }

    if (sourcePath && !isAllowedPath(sourcePath)) {
      return NextResponse.json(
        { error: 'sourcePath outside allowed directories' },
        { status: 400 }
      );
    }

    const stats = await seedMain({ ledgerPath: csvPath, sourcePath });
    return NextResponse.json({ ok: true, csvPath, stats });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 500 }
    );
  } finally {
    if (tmpPath) {
      try {
        await fs.unlink(tmpPath);
      } catch (_) {
        // best-effort cleanup；暫存檔可能已被 seed 讀走或不存在。
      }
    }
  }
}

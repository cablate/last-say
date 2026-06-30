// API 錯誤訊息淨化：開發環境保留細節方便除錯；正式環境不外露絕對路徑 / raw SQLite 訊息。
// 用法（route catch）：NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 })
// 搭配 server 端 console.error(err) 保留完整 trace。
function safeErrorMessage(err, fallback = '處理時發生錯誤，請稍後再試。') {
  if (process.env.NODE_ENV === 'development') {
    return String((err && err.message) || err);
  }
  return fallback;
}

module.exports = { safeErrorMessage };

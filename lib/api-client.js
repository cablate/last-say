// 同源 API client：fetch 同源 path，ok 回 json，不 ok 拋 ApiError 含 status 與 message。
// 金額/日期格式化請見 lib/format.js。

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

async function send(method, path, body, options = {}) {
  const init = { method, ...options }
  if (body !== undefined) {
    init.headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(path, init)
  if (!res.ok) {
    let message = `請求失敗：${res.status}`
    try {
      const data = await res.json()
      message = data.error || data.message || message
    } catch {
      // response 沒有 JSON body，沿用預設訊息
    }
    throw new ApiError(res.status, message)
  }
  // 204 No Content 或空 body 不解析
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// fetchJson(path) 做 GET。第二參數 options 可帶 signal 供 AbortController 使用。
export function fetchJson(path, options = {}) {
  return send("GET", path, undefined, options)
}

// patchJson(path, body) 做 PATCH 寫入並回 json。
export function patchJson(path, body) {
  return send("PATCH", path, body)
}

// postJson(path, body) 做 POST 寫入並回 json。
export function postJson(path, body) {
  return send("POST", path, body)
}

// deleteJson(path) 做 DELETE，回 json（或 null）。
export function deleteJson(path) {
  return send("DELETE", path, undefined)
}

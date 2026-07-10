# Security Policy

Last Say 處理高度敏感的個人財務資料。安全問題請不要公開貼出可利用細節或真實資料。

## 回報漏洞

請使用 GitHub repository 的 **Security → Report a vulnerability** 建立 private security advisory：

https://github.com/cablate/last-say/security/advisories/new

請提供受影響版本、重現步驟、可能影響與不含個資的最小證據。確認前請勿公開揭露。

## 部署邊界

- 預設只供單一使用者在 localhost 操作。
- API 目前沒有身份驗證、權限與多租戶隔離。
- 不要把 port `3127` 直接暴露到公網、區域網路或反向代理。
- `data/`、`uploads/`、`outputs/`、log 與 screenshot 都可能含財務資料，必須保持私密。
- 外部 AI 是否會把檔案送往雲端，取決於你選擇的 agent 與模型；請自行確認其資料政策。

目前只維護 `main` 最新版本。舊 commit 或自行修改的公開部署不在安全支援範圍內。

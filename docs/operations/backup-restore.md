# Backup And Restore

Last Say 的 backup/restore 是本機 operator 能力，不是 AI HTTP API。執行前先停止會寫入目標 DB 的服務，並明確指定路徑。不要省略 `--db` 或把 restore target 指向既有檔案。

## 建立備份

```powershell
node scripts/finance-backup.mjs --db D:\path\finance.sqlite --output D:\private-backups
```

預設為 DB-only bundle，manifest 會明確標示未包含原始來源檔。只有確定 output 是受保護的私密位置時才加 `--include-sources`。Last Say 不替 bundle 加密；磁碟、雲端同步與離線媒體的存取控制由使用者負責。

## 還原演練

```powershell
node scripts/finance-restore.mjs --input D:\private-backups\<bundle>\manifest.json --target D:\restore-test\finance.sqlite
```

Restore 只允許全新的 target，不會覆蓋既有 DB。先用還原庫啟動 Last Say，確認 health、schema version、交易筆數、append-only evidence、Data Center 與報表，再由人類決定是否切換正式路徑。AI 不得替使用者切換 active DB。

## Release Rehearsal

`npm run verify:release` 會對匿名 demo DB 執行 DB-only backup→new-path restore、`PRAGMA integrity_check`、交易與 change evidence 核對，完成後刪除暫存 bundle。這只證明程式路徑可用，不取代使用者自己的定期備份與還原演練。

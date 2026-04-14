---
description: Build, verify, and deploy the Cloudflare Worker safely
---

# Deploy Worker

部署 `worker/` 到 Cloudflare。包含部署前检查 + 部署后验证。

## 部署前检查

1. **TypeScript 编译**：
   ```bash
   cd worker
   npm run build
   ```
   失败 → 停止，让用户修。

2. **本地测试**（如果有）：
   ```bash
   npm run test
   ```

3. **检查待应用的 migrations**：
   ```bash
   ls migrations/
   ```
   对比 D1 远程库实际 schema，如有未应用的 migration，提醒用户：
   ```
   发现 migration 003 / 004 未应用到 remote。是否先应用？
   1. 先应用 migration 再部署 Worker（推荐）
   2. 仅部署 Worker（如果 Worker 代码不依赖新表）
   ```

4. **确认 wrangler.toml**：
   - `name` 是 `allyclaw-intelligence`（不和其他 Worker 冲突）
   - `database_id` 指向 `allyclaw-db`

## 部署

```bash
cd worker
npx wrangler deploy
```

## 部署后验证

1. **健康检查**：
   ```bash
   curl https://allyclaw-intelligence.<account>.workers.dev/api/health
   ```
   预期返回 `{"status":"ok"}`。

2. **关键 endpoint smoke test**（如果有新增）：
   - 列出新增的 routes
   - 用 curl 测每个 route 的最小请求

3. **看 tail 日志**（30 秒）：
   ```bash
   npx wrangler tail
   ```
   看是否有报错。

## 失败回滚

如果发现问题：

```bash
npx wrangler rollback
```

如果是 schema 变更引起的，**不要回滚 schema**（数据可能已写），先修代码再 forward 部署。

## 输出

完成后告诉用户：
- 新 Worker 版本号（wrangler 输出的 Version ID）
- 部署 URL
- 任何 smoke test 结果
- 如有 migration 未应用，给出后续步骤

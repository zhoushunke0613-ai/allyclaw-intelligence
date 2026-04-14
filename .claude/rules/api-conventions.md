# API Conventions

## URL 设计

- 所有路径 `/api/` 前缀
- kebab-case：`/api/skill-metrics`、`/api/optimization-suggestions`
- 资源用复数：`/api/suggestions`、不是 `/api/suggestion`
- 动作用动词：`/api/suggestions/:id/approve`

## 请求

- GET 用 query 参数，POST/PUT 用 JSON body
- 多团队筛选统一用 `?servers=a,b,c`（CSV）或 `?team_ids=a,b,c`
- 单值筛选用 `?server=x` 兼容
- 时间范围用 `?from=2026-04-01&to=2026-04-14`（ISO 8601）

## 响应格式

成功：

```json
{
  "items": [...],
  "total": 123,
  "page": 1,
  "page_size": 20
}
```

错误：

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests, retry after 30s",
    "retry_after": 30
  }
}
```

错误 `code` 必须是稳定字符串（不是 HTTP status），客户端可程序化判断。

## 状态码

- 200: 成功
- 201: 创建成功
- 400: 客户端入参错
- 401/403: 认证 / 授权问题
- 404: 资源不存在
- 409: 冲突（如重复创建）
- 429: 限流
- 500: 服务端错（必须记录到 audit_log）
- 503: 上游依赖（D1、LLM）暂时不可用

## 分页

```
GET /api/suggestions?page=1&page_size=20
```

- 默认 `page=1`、`page_size=20`
- `page_size` 上限 100，超过返回 400
- 总数始终返回（前端需要分页器）

## 鉴权

- MVP 用 Cloudflare Access 在 Worker 入口拦截
- Worker 内通过 `c.req.header('Cf-Access-Authenticated-User-Email')` 拿用户身份
- 权限校验：每个 handler 入口校验用户角色（参考 `int_role_permissions` 表）

## 跨域

- CORS 用 Hono 中间件统一处理
- 生产环境只允许白名单 origin（不要 `*`）
- 开发环境可放开 localhost

## 版本

- 暂不引入 `/api/v1/` 前缀
- 真要 break 时再加版本号
- 兼容性变更（加字段）不算 break

## 速率限制

每个 endpoint 默认配额：

| 类型 | 限制 |
|------|------|
| 查询类（GET） | 60 req/min/user |
| 写入类（POST/PUT） | 20 req/min/user |
| 报告生成 | 5 req/min/user |
| 批量导出 | 2 req/hour/user |

超限返回 429 + `Retry-After` header。

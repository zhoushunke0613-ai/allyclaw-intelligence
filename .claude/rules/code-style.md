# Code Style

## TypeScript

- 严格模式：`tsconfig.json` 必须 `strict: true`
- 不写 `any`，必须用具体类型；过渡阶段用 `unknown` + type guard
- 不用枚举（`enum`），用 `as const` 字面量联合类型
- 函数显式标注返回类型（即使能推断），可读性优先

```typescript
// ✓ Good
export function classifySession(text: string): Promise<Classification> { ... }

// ✗ Bad
export function classifySession(text) { ... }
```

## React (Frontend)

- 组件函数式 + Hooks，不用 class
- 文件名大驼峰 `ServerSelector.tsx`，hook 文件 `useServers.ts`
- Props 接口与组件同文件，命名 `<Component>Props`
- 状态管理优先用本地 `useState`，跨页用 React Query，不要随便引入 Zustand

## 命名

| 类型 | 风格 | 示例 |
|------|------|------|
| 类型/接口 | PascalCase | `OptimizationSuggestion` |
| 变量/函数 | camelCase | `getServerIds`, `currentServer` |
| 常量 | SCREAMING_SNAKE_CASE | `REBUILD_VERSION`, `MAX_RETRY` |
| 文件 | kebab-case (TS) / PascalCase (React) | `llm-adapter.ts`, `Dashboard.tsx` |
| D1 表 | snake_case + `int_` 前缀 | `int_skill_metrics_daily` |
| API 路径 | kebab-case | `/api/skill-metrics` |

## 注释

默认不写。只在以下情况写：

- 业务逻辑反直觉时（"为什么"，不是"做什么"）
- 涉及外部 API quirks 或限流
- TODO 标注必须带日期 + 作者：`// TODO(2026-04-14, zhou): 等 v2 API 上线后切换`

**不要写文档级注释**（参数列表、返回值描述）— TypeScript 类型已经表达了。

## 错误处理

- API 边界（route handler）必须 try/catch 并返回结构化错误
- 内部函数让异常向上传，不要每层都包一遍
- 不写 `catch (e) { console.log(e) }` — 要么 throw，要么记录到 `int_audit_log`

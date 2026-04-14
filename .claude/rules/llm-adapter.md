# LLM Adapter Rules

> 参考 DECISIONS §10：MVP 只用 Claude，但代码必须通过 Adapter 抽象。

## 核心原则

**业务代码不感知具体 Provider。**

```typescript
// ✓ 正确：通过 Adapter
import { getLLM } from '../llm/factory'
const llm = getLLM(env)
const result = await llm.classify({ text, taxonomy })

// ✗ 禁止：直接 import SDK
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
```

## 目录结构

```
worker/src/llm/
├── types.ts              # LLMProvider 接口定义
├── claude.ts             # Claude 实现（MVP 唯一实现）
├── openai.ts             # OpenAI 占位（标记 throw new Error('not implemented')）
├── factory.ts            # 根据 env.LLM_PROVIDER 返回实例
└── tasks/
    ├── classify.ts       # 业务任务示例
    ├── suggest.ts
    └── summarize.ts
```

## 接口必须包含

```typescript
export interface LLMProvider {
  readonly name: 'claude' | 'openai' | 'deepseek'
  complete(opts: CompleteOptions): Promise<CompleteResponse>
  classify(opts: ClassifyOptions): Promise<ClassifyResponse>
}
```

后续新增任务方法（`summarize`、`compare` 等）按需扩展接口。

## 模型名抽象

业务代码用抽象名，Adapter 内部映射：

```typescript
// ✓ 业务代码
await llm.complete({ model: 'classifier', ... })

// claude.ts 内部映射
const MODEL_MAP = {
  classifier: 'claude-haiku-4-5-20251001',
  suggester: 'claude-sonnet-4-6',
  summarizer: 'claude-haiku-4-5-20251001',
}
```

抽象名清单（统一管理在 `llm/types.ts`）：

| 抽象名 | 用途 | 默认成本档位 |
|--------|------|------------|
| `classifier` | 问题分类、标签 | 低（Haiku） |
| `summarizer` | 对话摘要、报告生成 | 低（Haiku） |
| `suggester` | 优化建议生成 | 高（Sonnet） |
| `analyzer` | 失败原因深度分析 | 高（Sonnet） |
| `evaluator` | A/B 实验结果评估 | 中（Sonnet） |

## Prompt 管理

- Prompt 文件独立放在 `worker/src/prompts/<task>.ts`
- 用 TypeScript 模板字符串导出，便于参数化
- 一个 Prompt 文件可被多个 Provider 复用（避免 OpenAI 时再写一遍）
- 大变更必须 bump version 字段，方便追溯效果差异

```typescript
// worker/src/prompts/classify.ts
export const CLASSIFY_PROMPT_V1 = (text: string, taxonomy: Category[]) => `
You are a question classifier...
Question: ${text}
Available categories: ${taxonomy.map(c => c.name).join(', ')}
`
export const CLASSIFY_VERSION = 'v1.0'
```

## 错误处理

Adapter 必须捕获 Provider 特有错误并转换为统一错误类型：

```typescript
class LLMError extends Error {
  constructor(
    message: string,
    public kind: 'rate_limit' | 'auth' | 'timeout' | 'invalid_response' | 'unknown',
    public provider: string,
    public retryable: boolean
  ) { super(message) }
}
```

业务代码只捕获 `LLMError`，不接触 Anthropic SDK 的原生异常。

## 何时启用 OpenAI

不要主动启用。除非：

- Claude API 持续宕机 > 1 小时（启用 fallback 模式）
- A/B 实验需要对比模型质量
- 实测证据显示某任务 GPT-4o 显著更好

启用时改 `factory.ts` + 添加 `OPENAI_API_KEY` 到 wrangler secret，业务代码不动。

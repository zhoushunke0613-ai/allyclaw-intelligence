# AllyClaw Intelligence — Frontend

React + Vite + TypeScript 工作台。

## 开发

```bash
npm install
npm run dev  # http://localhost:5173
```

## 构建

```bash
npm run build
```

## 部署（Phase 1 后）

部署到 Cloudflare Pages：

```bash
npx wrangler pages deploy dist --project-name allyclaw-intelligence-dashboard
```

## 目录

```
src/
├── components/     # 可复用组件
├── pages/          # 路由页面
│   ├── Overview.tsx
│   ├── Suggestions.tsx
│   ├── Skills.tsx
│   └── Reports.tsx
├── lib/            # API client, utils
└── hooks/          # 自定义 hooks
```

## Phase 规划

参考 [../docs/PRD.md](../docs/PRD.md) §15。Phase 2 开始实现工作台 UI。

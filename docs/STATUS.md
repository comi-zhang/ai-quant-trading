# AI 量化交易系统 — 工程状态

> 本文档是当前真实的工程状态，以代码与测试证据为准（不沿用旧 todo.md 的“全部完成”结论）。

## 安全边界（不可违反）

- **默认 paper-only**：`TRADING_MODE=paper`、`LIVE_TRADING_ENABLED=false`、`AUTO_TRADING_ENABLED=false`。
- 真实下单/撤单需要双开关（`TRADING_MODE=live` + `LIVE_TRADING_ENABLED=true`），且本仓库不含任何真实凭据。
- 所有 secret 只从环境变量读取（见 `.env.example`）；登录密码只接受 SHA-256 hash。
- 聊天中出现过的 Longbridge 测试凭据已暴露且 token 已过期，**必须轮换**，且从未写入本仓库。

## 架构

```
client (React + tRPC)  →  server/routers (tRPC, protected)
                             ↓
                     orderService（交易流水线唯一入口）
                       风控快照 → 幂等 → paper/live 执行 → 事务持久化 → 审计
                             ↓                ↓
                     riskEngine        LongbridgeGateway（唯一上游客户端）
                     (fail-closed)       官方契约签名/envelope/zod 校验
                             ↓
                     PostgreSQL (drizzle, 12 表, 迁移可重现)
```

### Longbridge 契约来源

仅使用官方来源：crates.io 上官方 Rust SDK `longport` 4.3.7 / `longport-httpcli` 4.3.7 源码
（REST 路径、请求/响应结构、HMAC-SHA256 签名算法、envelope、429 退避行为），
对应官方文档 https://open.longportapp.com/en/docs 。实现见 `server/services/longbridge/`。

## 数据库

- 统一 PostgreSQL：`drizzle/schema.ts`（12 表）+ `drizzle/0000_*.sql`（单一干净迁移）。
- 迁移验证：PGlite（WASM PostgreSQL）在集成测试中从空库执行全部迁移。
- 命令：`pnpm db:generate`（从 schema 生成迁移）、`pnpm db:migrate`（应用到 DATABASE_URL）。
- 回滚：当前为初始迁移，回滚 = drop schema；后续迁移将保持 up/down 说明。

## 验证命令

```bash
pnpm check        # 类型检查（当前：0 错误）
pnpm test         # 单元+契约+集成+授权测试（当前：107 通过）
pnpm build        # 生产构建
pnpm smoke:paper  # paper 冒烟（PGlite，无网络/无真实订单：12 项检查）
git diff --check
```

## 测试覆盖

| 层 | 文件 | 覆盖点 |
|---|---|---|
| 契约 | `server/services/longbridge/gateway.test.ts` (30) | 签名/envelope/错误分类/429 退避/symbol/状态映射/下单体/凭据不泄漏 |
| 风控 | `server/services/riskEngine.test.ts` (26) | 全部规则 + 0/负/NaN/超限/空仓/未知数据 fail-closed |
| 集成 | `server/services/orderService.test.ts` (9) | 迁移 + 交易闭环 + 幂等 + 撤单 + 对账 + kill switch |
| 授权 | `server/authz.test.ts` (20) | 匿名访问全部 protected 路由 → UNAUTHORIZED |
| 回测 | `server/services/backtesting.test.ts` (13) | 次日成交/成本/滑点/基准/确定性/现金约束 |
| 指标 | `server/services/indicators.test.ts` (8) | SMA/EMA/RSI/MACD/评分（数据不足=null） |
| 冒烟 | `scripts/paper-smoke.ts` (12) | 全新库完整 paper 闭环 |

## 已知限制 / 剩余债务

1. **live 交易未验收**：双开关存在但从未对真实券商调用（测试 token 已过期）；live 前必须完成 contract tests 对真实沙箱的只读验证 + 人工授权流程。
2. **基本面/舆情数据源未接入**：策略会标记 `dataQuality=degraded/insufficient`，不伪造 50 分。
3. **E2E（Playwright）未配置**：当前以 tRPC 授权集成测试替代；建议后续补齐登录/下单 dry-run/错误展示 E2E。
4. **回测为单标的、单向做多模型**：未含做空/多标的组合/分红拆股调整。
5. **paper 现金账本为单币种 USD**：未做汇率换算。
6. **调度器租约为单实例语义**：多实例部署需要以数据库 advisory lock 强化。
7. **覆盖率门禁未配置**（@vitest/coverage-v8 未安装）：测试以关键路径为目标，非百分比驱动。
8. **限流/CSRF**：tRPC 在同源 cookie 下工作，未加显式 CSRF token 与速率限制中间件。

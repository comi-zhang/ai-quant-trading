# AI量化交易系统 - 开发清单（2026-09-08 重写，以 docs/STATUS.md 为准）

## 阶段0 安全冻结 ✅
- [x] 删除硬编码登录凭据（oauth.ts），改为 AUTH_USERNAME/AUTH_PASSWORD_HASH(SHA-256)
- [x] secret scan：仅 1 处硬编码，已清除；.env 在 .gitignore
- [x] paper-only guard：tradingMode.ts 双开关，live 默认拒绝
- [x] 基线复现：check 4 错误/test 26+1失败/build 通过（已存档 .autocase/baseline）

## 阶段1 基础设施 ✅
- [x] 统一 PostgreSQL：schema(12表)/drizzle.config/node-postgres 驱动/单一干净迁移
- [x] 修复 ownerOpenId/ownerOpenID、maxDailyTrades serial bug、userId serial bug
- [x] 环境变量 zod 分层校验（env.ts），pnpm check 零错误
- [x] PGlite 临时库迁移验证（集成测试从空库跑真实迁移）

## 阶段2 Longbridge gateway ✅
- [x] 官方契约确认（crates.io longport/longport-httpcli 4.3.7 源码）
- [x] 删除 4 套重复客户端，单一 gateway + zod 校验 + symbol 边界规范化
- [x] 统一超时/429 指数退避/错误分类/envelope/日志不含凭据
- [x] 30 个 HTTP mock 契约测试（签名/下单体/撤单/状态映射/错误码）

## 阶段3 交易域 ✅
- [x] 12 表：users/accounts/account_cash/watchlist/positions/orders/fills/trades/ai_decisions/risk_config/job_runs/audit_events
- [x] 幂等：client_order_id 唯一约束，重复请求去重（有测试）
- [x] 状态机：pending_accept/accepted/rejected/partial_filled/filled/cancelling/cancelled/expired/unknown
- [x] 事务持久化：订单+成交+持仓+现金+trades(realizedPnl)+审计
- [x] 对账：paper 限价单价格到位成交；live 从券商同步

## 阶段4 风控 ✅
- [x] 风险配置服务端持久化 + 版本号 + 审计（risk 路由）
- [x] 一致性快照风控：现金/持仓/日统计/参考价新鲜度
- [x] 规则：单笔数量/单标的暴露/总暴露/现金/最小余额/日次数/日亏损熔断/可卖数量
- [x] fail closed：未知数据一律拒绝（26 个边界单测）
- [x] kill switch：tradingHalted 立即生效（有测试）

## 阶段5 策略/回测/调度 ✅（部分见债务）
- [x] 真实数据链：gateway 行情/K线 → 指标评分 → 决策持久化（含 inputs/dataQuality）
- [x] 移除固定 50 分/固定目标价/假新闻；缺数据标记不伪造
- [x] 回测：次日成交（消前视）/佣金/滑点/基准/确定性/现金约束
- [x] 调度器：job_runs 租约互斥/超时/指数退避/优雅关闭/默认不启动
- [ ] 基本面/舆情数据源接入（Alpha Vantage/NewsAPI 适配器）—— 债务
- [ ] 调度器多实例 advisory lock —— 债务

## 阶段6 前端 ✅
- [x] Dashboard/Trading/Risk 去除全部 mock/虚构收益/假决策
- [x] loading/error/empty/stale/数据时间戳全状态展示
- [x] 下单确认对话框（标的/方向/数量/估算金额/模式标识）
- [x] 限价单完整支持；订单状态机可见；失败不冒充成功
- [x] 账户/持仓/订单/决策全部 protected（20 个匿名授权测试）

## 阶段7-8 质量门禁（持续）
- [x] pnpm check 零错误 / pnpm test 107 通过 / pnpm build 通过
- [x] paper smoke 12/12（scripts/paper-smoke.ts）
- [ ] Playwright E2E —— 债务
- [ ] 覆盖率门禁 —— 债务（不追求数字，先保关键路径）
- [ ] CSRF/速率限制中间件 —— 债务

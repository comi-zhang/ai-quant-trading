import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  accountCash,
  accounts,
  auditEvents,
  fills,
  orders,
  positions,
  riskConfig,
  trades,
  type Account,
  type Order,
  type RiskConfig,
} from "../../drizzle/schema";
import { getDb, type Db } from "../db";
import { isAutoTradingEnabled, isLiveMode, assertLiveTradingAllowed } from "./tradingMode";
import { evaluateOrderRisk, type AccountSnapshot, type RiskDecision } from "./riskEngine";
import { executePaperOrder, canCancelPaperStatus } from "./longbridge/paperBroker";
import { GatewayError } from "./longbridge/client";
import { getDefaultGateway, type LongbridgeGateway } from "./longbridge/gateway";
import { normalizeSymbol } from "./longbridge/contract";

/** drizzle 事务/直连共用的最小查询接口 */
export type TxOrDb = Pick<Db, "select" | "insert" | "update" | "delete">;

/**
 * 交易流水线（唯一入口）
 * validated input -> authenticated account -> risk snapshot -> idempotency
 *   -> broker/paper request -> persist accepted order -> reconcile fills
 *   -> update position/trade/cash/audit
 *
 * 原则：
 * - 数据库不可用 = fail closed（没有持久化就没有交易）；
 * - HTTP 200 ≠ 下单成功：区分 accepted/rejected/partial/filled/cancelled/unknown；
 * - 每个状态变化写审计事件（不含敏感信息）。
 */

export interface OrderServiceDeps {
  db: Db;
  gateway?: LongbridgeGateway;
  now?: () => Date;
}

export interface SubmitOrderRequest {
  userId: number;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: number;
  limitPrice?: number;
  timeInForce: "day" | "gtc";
  clientOrderId?: string;
  aiDecisionId?: number;
  /** 自动交易标记（需要 AUTO_TRADING_ENABLED + 风险配置 enableAutoTrading） */
  automated?: boolean;
}

export interface OrderResult {
  id: number | null;
  clientOrderId: string;
  brokerOrderId: string | null;
  status: Order["status"];
  mode: "paper" | "live";
  duplicate: boolean;
  risk: RiskDecision;
  message: string;
}

const OPEN_STATUSES = ["pending_accept", "accepted", "partial_filled", "cancelling", "unknown"] as const;

const DEFAULT_RISK_LIMITS = {
  maxPositionSize: "10000",
  maxTotalExposure: "50000",
  maxOrderQuantity: 1000,
  maxDailyTrades: 20,
  maxDailyLoss: "2000",
  minAccountBalance: "5000",
  stopLossPercent: "2",
  takeProfitPercent: "5",
};

export class OrderService {
  private readonly db: Db;
  private readonly gateway?: LongbridgeGateway;
  private readonly now: () => Date;

  constructor(deps: OrderServiceDeps) {
    this.db = deps.db;
    this.gateway = deps.gateway;
    this.now = deps.now ?? (() => new Date());
  }

  // ---------- 配置与账户 ----------

  async getOrCreateRiskConfig(userId: number): Promise<RiskConfig> {
    const rows = await this.db.select().from(riskConfig).where(eq(riskConfig.userId, userId)).limit(1);
    if (rows[0]) return rows[0];
    const inserted = await this.db
      .insert(riskConfig)
      .values({ userId, ...DEFAULT_RISK_LIMITS })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return inserted[0];
    const retry = await this.db.select().from(riskConfig).where(eq(riskConfig.userId, userId)).limit(1);
    if (!retry[0]) throw new Error("无法创建风险配置");
    return retry[0];
  }

  private async getAccount(userId: number, mode: "paper" | "live"): Promise<Account> {
    const existing = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.mode, mode), eq(accounts.label, "default")))
      .limit(1);
    if (existing[0]) return existing[0];
    const inserted = await this.db
      .insert(accounts)
      .values({ userId, mode, label: "default" })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return inserted[0];
    const retry = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.mode, mode), eq(accounts.label, "default")))
      .limit(1);
    if (!retry[0]) throw new Error("无法创建账户");
    return retry[0];
  }

  // ---------- 快照 ----------

  private async buildSnapshot(account: Account, symbol: string): Promise<AccountSnapshot> {
    const now = this.now();
    const mode = account.mode;

    // 现金与持仓来源
    let availableCash: number | null = null;
    let snapshotPositions: AccountSnapshot["positions"] = [];

    if (mode === "live") {
      if (!this.gateway?.configured) {
        // live 模式无法获取券商快照：全部置 null，风控将 fail closed
        availableCash = null;
        snapshotPositions = [];
      } else {
        const bal = await this.gateway.getAccountBalance().catch(() => null);
        availableCash = bal?.availableCash ?? null;
        const brokerPositions = await this.gateway.getStockPositions().catch(() => null);
        snapshotPositions = (brokerPositions ?? []).map((p) => ({
          symbol: p.symbol,
          quantity: p.quantity ?? NaN,
          availableQuantity: p.availableQuantity ?? NaN,
          marketValue: null, // 暴露检查需要市值；live 下用参考价补齐见下
          avgPrice: p.costPrice ?? null,
        }));
      }
    } else {
      const cashRow = await this.getOrCreateCash(account.id);
      availableCash = Number(cashRow.cash);
      const rows = await this.db.select().from(positions).where(eq(positions.accountId, account.id));
      snapshotPositions = rows.map((p) => {
        const qty = Number(p.quantity);
        const price = p.currentPrice !== null ? Number(p.currentPrice) : null;
        return {
          symbol: p.symbol,
          quantity: qty,
          availableQuantity: Number(p.availableQuantity),
          marketValue: price !== null && Number.isFinite(price) ? qty * price : null,
          avgPrice: p.avgPrice !== null ? Number(p.avgPrice) : null,
        };
      });
    }

    // 参考价（订单标的）
    let referencePrice: number | null = null;
    let referencePriceAt: Date | null = null;
    if (this.gateway?.configured) {
      const quote = await this.gateway.getQuote(symbol).catch(() => null);
      if (quote?.lastDone != null) {
        referencePrice = quote.lastDone;
        referencePriceAt = now;
      }
    }
    // live 持仓市值用参考价/成本价补齐
    if (mode === "live") {
      snapshotPositions = snapshotPositions.map((p) => ({
        ...p,
        marketValue:
          p.marketValue ??
          (p.symbol === symbol && referencePrice !== null && Number.isFinite(p.quantity)
            ? p.quantity * referencePrice
            : p.avgPrice !== null && Number.isFinite(p.quantity)
              ? p.quantity * p.avgPrice
              : null),
      }));
    }

    // 当日统计
    const todayOrderRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.accountId, account.id), sql`${orders.createdAt} >= date_trunc('day', now())`));
    const todayOrderCount = todayOrderRows[0]?.count ?? 0;

    const lossRows = await this.db
      .select({ loss: sql<string>`coalesce(sum(-1 * ${trades.realizedPnl}), '0')` })
      .from(trades)
      .where(
        and(
          eq(trades.accountId, account.id),
          sql`${trades.executedAt} >= date_trunc('day', now())`,
          sql`${trades.realizedPnl} < 0`
        )
      );
    const todayRealizedLoss = Number(lossRows[0]?.loss ?? 0);

    return {
      availableCash,
      positions: snapshotPositions,
      todayOrderCount,
      todayRealizedLoss,
      referencePrice,
      referencePriceAt,
      snapshotAt: now,
    };
  }

  private async getOrCreateCash(accountId: number) {
    const rows = await this.db.select().from(accountCash).where(eq(accountCash.accountId, accountId)).limit(1);
    if (rows[0]) return rows[0];
    const inserted = await this.db
      .insert(accountCash)
      .values({ accountId })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return inserted[0];
    const retry = await this.db.select().from(accountCash).where(eq(accountCash.accountId, accountId)).limit(1);
    if (!retry[0]) throw new Error("无法初始化现金账本");
    return retry[0];
  }

  // ---------- 审计 ----------

  private async audit(event: {
    userId: number;
    accountId?: number | null;
    eventType: string;
    entityType?: string;
    entityId?: string;
    requestId?: string;
    payload?: Record<string, unknown>;
  }) {
    try {
      await this.db.insert(auditEvents).values({
        userId: event.userId,
        accountId: event.accountId ?? null,
        eventType: event.eventType,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        requestId: event.requestId ?? null,
        payload: event.payload ?? null,
      });
    } catch (err) {
      console.error("[Audit] 写入失败:", event.eventType, (err as Error).message);
    }
  }

  // ---------- 下单 ----------

  async submitOrder(req: SubmitOrderRequest): Promise<OrderResult> {
    const mode: "paper" | "live" = isLiveMode() ? "live" : "paper";
    const symbol = normalizeSymbol(req.symbol);
    const clientOrderId = req.clientOrderId ?? randomUUID();

    // 自动交易闸门
    if (req.automated && !isAutoTradingEnabled()) {
      return {
        id: null,
        clientOrderId,
        brokerOrderId: null,
        status: "rejected",
        mode,
        duplicate: false,
        risk: { allowed: false, violations: ["自动交易未启用（AUTO_TRADING_ENABLED=false）"], warnings: [] },
        message: "自动交易未启用",
      };
    }

    const account = await this.getAccount(req.userId, mode);
    const config = await this.getOrCreateRiskConfig(req.userId);

    // 幂等：同 clientOrderId 直接返回原订单
    const existing = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.accountId, account.id), eq(orders.clientOrderId, clientOrderId)))
      .limit(1);
    if (existing[0]) {
      return {
        id: existing[0].id,
        clientOrderId,
        brokerOrderId: existing[0].brokerOrderId,
        status: existing[0].status,
        mode,
        duplicate: true,
        risk: { allowed: true, violations: [], warnings: [] },
        message: "重复请求：返回已存在订单",
      };
    }

    // 风控快照与评估
    const snapshot = await this.buildSnapshot(account, symbol);
    const risk = evaluateOrderRisk(
      {
        symbol,
        side: req.side,
        orderType: req.orderType,
        quantity: req.quantity,
        limitPrice: req.limitPrice,
      },
      snapshot,
      config,
      { tradingHalted: config.tradingHalted, autoTrading: req.automated, now: this.now() }
    );

    if (!risk.allowed) {
      const [rejected] = await this.db
        .insert(orders)
        .values({
          accountId: account.id,
          clientOrderId,
          symbol,
          side: req.side,
          orderType: req.orderType,
          timeInForce: req.timeInForce,
          quantity: String(req.quantity),
          limitPrice: req.limitPrice !== undefined ? String(req.limitPrice) : null,
          status: "rejected",
          mode,
          aiDecisionId: req.aiDecisionId ?? null,
          rejectReason: risk.violations.join("; "),
          riskSnapshot: JSON.parse(JSON.stringify(snapshot)),
        })
        .returning();
      await this.audit({
        userId: req.userId,
        accountId: account.id,
        eventType: "order.rejected_by_risk",
        entityType: "order",
        entityId: String(rejected.id),
        requestId: clientOrderId,
        payload: { symbol, side: req.side, quantity: req.quantity, violations: risk.violations },
      });
      return {
        id: rejected.id,
        clientOrderId,
        brokerOrderId: null,
        status: "rejected",
        mode,
        duplicate: false,
        risk,
        message: `风控拒绝: ${risk.violations.join("; ")}`,
      };
    }

    // 执行（paper 本地 / live 上游）
    let brokerOrderId: string | null = null;
    let status: Order["status"] = "accepted";
    let execFills: { tradeId: string; quantity: number; price: number; tradeDoneAt: Date }[] = [];
    let message = "订单已接受";

    if (mode === "live") {
      assertLiveTradingAllowed("submitOrder"); // 双开关守卫，默认抛错
      if (!this.gateway) throw new Error("live 模式缺少 gateway");
      try {
        const resp = await this.gateway.submitOrder({
          symbol,
          side: req.side,
          orderType: req.orderType,
          quantity: req.quantity,
          limitPrice: req.limitPrice,
          timeInForce: req.timeInForce,
          remark: `cid:${clientOrderId.slice(0, 32)}`,
        });
        brokerOrderId = resp.orderId;
        status = "accepted";
      } catch (err) {
        if (err instanceof GatewayError) {
          status = "rejected";
          message = `券商拒绝: ${err.message}`;
        } else {
          // 网络等未知错误：不能确定券商是否收到 —— 标记 unknown 等待人工对账
          status = "unknown";
          message = `提交结果未知，等待对账: ${(err as Error).message}`;
        }
      }
    } else {
      const paper = executePaperOrder(
        {
          symbol,
          side: req.side,
          orderType: req.orderType,
          quantity: req.quantity,
          limitPrice: req.limitPrice,
          timeInForce: req.timeInForce,
        },
        snapshot.referencePrice,
        this.now()
      );
      brokerOrderId = paper.brokerOrderId;
      status = paper.status;
      execFills = paper.fills;
      message = paper.status === "filled" ? "订单已成交（paper）" : "订单已接受（paper）";
    }

    // 事务化持久化：订单 + 成交 + 持仓 + 现金
    const result = await this.db.transaction(async (tx) => {
      const [orderRow] = await tx
        .insert(orders)
        .values({
          accountId: account.id,
          clientOrderId,
          brokerOrderId,
          symbol,
          side: req.side,
          orderType: req.orderType,
          timeInForce: req.timeInForce,
          quantity: String(req.quantity),
          limitPrice: req.limitPrice !== undefined ? String(req.limitPrice) : null,
          status,
          mode,
          aiDecisionId: req.aiDecisionId ?? null,
          riskSnapshot: JSON.parse(JSON.stringify(snapshot)),
          submittedAt: this.now(),
          lastSyncAt: this.now(),
        })
        .returning();

      let filledQty = 0;
      let fillValue = 0;
      for (const f of execFills) {
        const [fillRow] = await tx
          .insert(fills)
          .values({
            orderId: orderRow.id,
            brokerTradeId: f.tradeId,
            symbol,
            side: req.side,
            quantity: String(f.quantity),
            price: String(f.price),
            tradeDoneAt: f.tradeDoneAt,
          })
          .onConflictDoNothing()
          .returning();
        if (!fillRow) continue; // 成交已入账（幂等）
        await this.applyFillToPortfolio(tx, account.id, orderRow.id, fillRow.id, {
          symbol,
          side: req.side,
          quantity: f.quantity,
          price: f.price,
          tradeDoneAt: f.tradeDoneAt,
        });
        filledQty += f.quantity;
        fillValue += f.quantity * f.price;
      }
      if (filledQty > 0) {
        await tx
          .update(orders)
          .set({
            filledQuantity: String(filledQty),
            avgFillPrice: String(fillValue / filledQty),
            status: filledQty >= req.quantity ? "filled" : "partial_filled",
            updatedAt: this.now(),
          })
          .where(eq(orders.id, orderRow.id));
        if (filledQty >= req.quantity) status = "filled";
        else status = "partial_filled";
      }
      return orderRow;
    });

    await this.audit({
      userId: req.userId,
      accountId: account.id,
      eventType: status === "filled" ? "order.filled" : status === "rejected" ? "order.rejected" : "order.submitted",
      entityType: "order",
      entityId: String(result.id),
      requestId: clientOrderId,
      payload: {
        symbol,
        side: req.side,
        orderType: req.orderType,
        quantity: req.quantity,
        limitPrice: req.limitPrice ?? null,
        status,
        mode,
        brokerOrderId,
      },
    });

    return {
      id: result.id,
      clientOrderId,
      brokerOrderId,
      status,
      mode,
      duplicate: false,
      risk,
      message,
    };
  }

  /** 成交入账：持仓均价/数量、现金、trades 记录（含 realizedPnl） */
  private async applyFillToPortfolio(
    tx: TxOrDb,
    accountId: number,
    orderId: number,
    fillId: number,
    fill: { symbol: string; side: "buy" | "sell"; quantity: number; price: number; tradeDoneAt: Date }
  ) {
    const posRows = await tx
      .select()
      .from(positions)
      .where(and(eq(positions.accountId, accountId), eq(positions.symbol, fill.symbol)))
      .limit(1);
    const pos = posRows[0];

    let realizedPnl = 0;
    // 必须使用 tx：事务内读写保持同一连接（否则单连接驱动会死锁）
    const cashRows = await tx.select().from(accountCash).where(eq(accountCash.accountId, accountId)).limit(1);
    const cash = Number(cashRows[0]?.cash ?? 0);
    const fillAmount = fill.quantity * fill.price;

    if (fill.side === "buy") {
      const oldQty = pos ? Number(pos.quantity) : 0;
      const oldAvg = pos ? Number(pos.avgPrice) : 0;
      const newQty = oldQty + fill.quantity;
      const newAvg = newQty > 0 ? (oldQty * oldAvg + fill.quantity * fill.price) / newQty : 0;
      if (pos) {
        await tx
          .update(positions)
          .set({
            quantity: String(newQty),
            availableQuantity: String(Number(pos.availableQuantity) + fill.quantity),
            avgPrice: String(newAvg),
            currentPrice: String(fill.price),
            updatedAt: this.now(),
          })
          .where(eq(positions.id, pos.id));
      } else {
        await tx.insert(positions).values({
          accountId,
          symbol: fill.symbol,
          quantity: String(fill.quantity),
          availableQuantity: String(fill.quantity),
          avgPrice: String(fill.price),
          currentPrice: String(fill.price),
        });
      }
      await tx
        .update(accountCash)
        .set({ cash: String(cash - fillAmount), updatedAt: this.now() })
        .where(eq(accountCash.accountId, accountId));
    } else {
      const oldQty = pos ? Number(pos.quantity) : 0;
      const oldAvg = pos ? Number(pos.avgPrice) : 0;
      if (!pos || oldQty < fill.quantity) {
        throw new Error(`持仓不足，无法入账卖出成交: 有 ${oldQty}，需 ${fill.quantity}`);
      }
      realizedPnl = (fill.price - oldAvg) * fill.quantity;
      const newQty = oldQty - fill.quantity;
      if (newQty <= 0) {
        await tx.delete(positions).where(eq(positions.id, pos.id));
      } else {
        await tx
          .update(positions)
          .set({
            quantity: String(newQty),
            availableQuantity: String(Math.max(0, Number(pos.availableQuantity) - fill.quantity)),
            currentPrice: String(fill.price),
            updatedAt: this.now(),
          })
          .where(eq(positions.id, pos.id));
      }
      await tx
        .update(accountCash)
        .set({ cash: String(cash + fillAmount), updatedAt: this.now() })
        .where(eq(accountCash.accountId, accountId));
    }

    await tx.insert(trades).values({
      accountId,
      orderId,
      fillId,
      symbol: fill.symbol,
      side: fill.side,
      quantity: String(fill.quantity),
      price: String(fill.price),
      totalAmount: fillAmount.toFixed(2),
      realizedPnl: realizedPnl.toFixed(2),
      executedAt: fill.tradeDoneAt,
    });
  }

  // ---------- 撤单 ----------

  async cancelOrder(params: { userId: number; orderId: number }): Promise<{ success: boolean; status: Order["status"]; message: string }> {
    const mode: "paper" | "live" = isLiveMode() ? "live" : "paper";
    const account = await this.getAccount(params.userId, mode);
    const rows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, params.orderId), eq(orders.accountId, account.id)))
      .limit(1);
    const order = rows[0];
    if (!order) {
      return { success: false, status: "unknown", message: "订单不存在或不属于当前账户" };
    }
    if (!(OPEN_STATUSES as readonly string[]).includes(order.status)) {
      return { success: false, status: order.status, message: `订单已处于终态: ${order.status}` };
    }

    if (order.mode === "live") {
      assertLiveTradingAllowed("cancelOrder");
      if (!order.brokerOrderId) {
        return { success: false, status: order.status, message: "订单缺少券商订单号，无法撤单" };
      }
      try {
        await this.gateway!.cancelOrder(order.brokerOrderId);
        await this.db.update(orders).set({ status: "cancelling", updatedAt: this.now() }).where(eq(orders.id, order.id));
        await this.audit({
          userId: params.userId,
          accountId: account.id,
          eventType: "order.cancel_requested",
          entityType: "order",
          entityId: String(order.id),
          payload: { brokerOrderId: order.brokerOrderId },
        });
        return { success: true, status: "cancelling", message: "撤单请求已提交" };
      } catch (err) {
        return { success: false, status: order.status, message: `撤单失败: ${(err as Error).message}` };
      }
    }

    // paper：本地状态机
    if (!canCancelPaperStatus(order.status)) {
      return { success: false, status: order.status, message: `当前状态不可撤销: ${order.status}` };
    }
    await this.db.update(orders).set({ status: "cancelled", updatedAt: this.now() }).where(eq(orders.id, order.id));
    await this.audit({
      userId: params.userId,
      accountId: account.id,
      eventType: "order.cancelled",
      entityType: "order",
      entityId: String(order.id),
      payload: { mode: "paper" },
    });
    return { success: true, status: "cancelled", message: "订单已撤销（paper）" };
  }

  // ---------- 对账 ----------

  /**
   * 对账开放订单：
   * - live: 从券商拉取最新状态与成交，更新本地；
   * - paper: 对 accepted 的限价单按最新参考价重新评估成交。
   * 返回更新的订单数；单个订单失败不中断其他订单。
   */
  async reconcileOpenOrders(userId: number): Promise<{ updated: number; errors: string[] }> {
    const mode: "paper" | "live" = isLiveMode() ? "live" : "paper";
    const account = await this.getAccount(userId, mode);
    const openOrders = await this.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.accountId, account.id),
          sql`${orders.status} IN ('pending_accept','accepted','partial_filled','cancelling','unknown')`
        )
      );

    let updated = 0;
    const errors: string[] = [];

    for (const order of openOrders) {
      try {
        if (order.mode === "live" && order.brokerOrderId && this.gateway?.configured) {
          const detail = await this.gateway.getOrderDetail(order.brokerOrderId);
          const newStatus = detail.status as Order["status"];
          await this.db
            .update(orders)
            .set({
              status: newStatus,
              filledQuantity: detail.executedQuantity !== null ? String(detail.executedQuantity) : order.filledQuantity,
              avgFillPrice: detail.executedPrice !== null ? String(detail.executedPrice) : order.avgFillPrice,
              rejectReason: newStatus === "rejected" ? (detail.message ?? order.rejectReason) : order.rejectReason,
              lastSyncAt: this.now(),
              updatedAt: this.now(),
            })
            .where(eq(orders.id, order.id));
          updated++;
        } else if (order.mode === "paper" && order.status === "accepted" && order.orderType === "limit") {
          // paper 限价单：有新参考价时评估成交
          let price: number | null = null;
          if (this.gateway?.configured) {
            const quote = await this.gateway.getQuote(order.symbol).catch(() => null);
            price = quote?.lastDone ?? null;
          }
          if (price !== null) {
            const paper = executePaperOrder(
              {
                symbol: order.symbol,
                side: order.side,
                orderType: "limit",
                quantity: Number(order.quantity),
                limitPrice: order.limitPrice !== null ? Number(order.limitPrice) : undefined,
                timeInForce: order.timeInForce,
              },
              price,
              this.now()
            );
            if (paper.status === "filled") {
              await this.db.transaction(async (tx) => {
                for (const f of paper.fills) {
                  const [fillRow] = await tx
                    .insert(fills)
                    .values({
                      orderId: order.id,
                      brokerTradeId: f.tradeId,
                      symbol: order.symbol,
                      side: order.side,
                      quantity: String(f.quantity),
                      price: String(f.price),
                      tradeDoneAt: f.tradeDoneAt,
                    })
                    .onConflictDoNothing()
                    .returning();
                  if (!fillRow) continue;
                  await this.applyFillToPortfolio(tx, account.id, order.id, fillRow.id, {
                    symbol: order.symbol,
                    side: order.side,
                    quantity: f.quantity,
                    price: f.price,
                    tradeDoneAt: f.tradeDoneAt,
                  });
                }
                await tx
                  .update(orders)
                  .set({
                    status: "filled",
                    filledQuantity: order.quantity,
                    avgFillPrice: String(price),
                    lastSyncAt: this.now(),
                    updatedAt: this.now(),
                  })
                  .where(eq(orders.id, order.id));
              });
              updated++;
            }
          }
        }
      } catch (err) {
        errors.push(`order ${order.id}: ${(err as Error).message}`);
      }
    }

    if (updated > 0) {
      await this.audit({
        userId,
        accountId: account.id,
        eventType: "orders.reconciled",
        payload: { updated, errorCount: errors.length },
      });
    }
    return { updated, errors };
  }

  // ---------- 查询 ----------

  async listOrders(userId: number, limit = 100) {
    const mode: "paper" | "live" = isLiveMode() ? "live" : "paper";
    const account = await this.getAccount(userId, mode);
    return this.db
      .select()
      .from(orders)
      .where(eq(orders.accountId, account.id))
      .orderBy(desc(orders.createdAt))
      .limit(limit);
  }

  async listTrades(userId: number, limit = 100) {
    const mode: "paper" | "live" = isLiveMode() ? "live" : "paper";
    const account = await this.getAccount(userId, mode);
    return this.db
      .select()
      .from(trades)
      .where(eq(trades.accountId, account.id))
      .orderBy(desc(trades.executedAt))
      .limit(limit);
  }

  async listPositions(userId: number) {
    const mode: "paper" | "live" = isLiveMode() ? "live" : "paper";
    const account = await this.getAccount(userId, mode);
    return this.db.select().from(positions).where(eq(positions.accountId, account.id));
  }

  async getAccountOverview(userId: number) {
    const mode: "paper" | "live" = isLiveMode() ? "live" : "paper";
    const account = await this.getAccount(userId, mode);
    const cashRow = await this.getOrCreateCash(account.id);
    const posRows = await this.db.select().from(positions).where(eq(positions.accountId, account.id));
    const positionsValue = posRows.reduce((sum, p) => {
      const qty = Number(p.quantity);
      const price = p.currentPrice !== null ? Number(p.currentPrice) : null;
      return price !== null && Number.isFinite(price) ? sum + qty * price : sum;
    }, 0);
    const cash = Number(cashRow.cash);
    return {
      mode,
      currency: cashRow.currency,
      cash,
      positionsValue,
      totalAssets: cash + positionsValue,
      positionCount: posRows.length,
      /** 数据是否完整（paper 本地账本总是完整的） */
      complete: true as boolean,
    };
  }
}

// ---------- 默认实例（生产/路由使用） ----------

export async function getOrderService(): Promise<OrderService | null> {
  const db = await getDb();
  if (!db) return null;
  return new OrderService({ db, gateway: getDefaultGateway() });
}

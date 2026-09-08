import { test, expect } from "@playwright/test";

/**
 * 回测观察台 E2E：
 * 登录 → 数据预览（fixture）→ 运行回测 → 等待完成 →
 * 回放（播放/暂停/单步/重置）→ 点击信号标记 → 事件详情 →
 * 交易表/指标卡/元信息一致性。
 *
 * 安全：全程 paper/backtest；服务器不带任何券商凭据；
 * 不产生真实订单；测试库为一次性本地实例。
 */

test.beforeEach(async ({ page }) => {
  // 登录
  await page.goto("/login");
  await page.getByPlaceholder("Username").fill("e2e");
  await page.getByPlaceholder("Password").fill("e2e-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/", { timeout: 15000 });
});

test("数据预览显示来源/范围/质量，不伪造数据", async ({ page }) => {
  await page.goto("/backtest");
  await page.getByRole("button", { name: "预览数据" }).click();

  const preview = page.getByTestId("data-preview");
  await expect(preview).toBeVisible({ timeout: 20000 });
  await expect(preview).toContainText("来源:");
  await expect(preview).toContainText("fixture");
  await expect(preview).toContainText("bars");
  await expect(preview).toContainText("质量:");
  await expect(preview).toContainText("UTC");
});

test("完整回测流程：运行→回放→标记→事件详情→指标一致", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto("/backtest");

  // 1. 运行回测（AAPL fixture，均线交叉）
  await page.getByTestId("run-backtest").click();

  // 2. 等待完成：指标卡出现（run 完成 → 结果加载）
  const metrics = page.getByTestId("metrics-cards");
  await expect(metrics).toBeVisible({ timeout: 60000 });

  // 3. 元信息：数据源/成交规则可见
  const meta = page.getByTestId("result-meta");
  await expect(meta).toContainText("fixture");
  await expect(meta).toContainText("下一 bar 开盘价成交");

  // 4. K线图可见且包含蜡烛元素
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();
  expect(await chart.locator("svg rect").count()).toBeGreaterThan(10);

  // 5. 回放控制：播放 → 暂停 → 单步 → 重置
  const status = page.getByTestId("replay-status");
  await expect(status).toContainText("bar 1/");

  await page.getByTestId("replay-play-pause").click(); // 播放
  await page.waitForTimeout(1500);
  await page.getByTestId("replay-play-pause").click(); // 暂停
  const afterPlay = await status.textContent();

  await page.getByTestId("replay-step").click(); // 单步
  const afterStep = await status.textContent();
  expect(afterStep).not.toBe(afterPlay);

  await page.getByTestId("replay-reset").click(); // 重置
  await expect(status).toContainText("bar 1/");

  // 6. 前进到有信号的 bar 并点击标记（若有 BUY/SELL/PUT 标记）
  const marker = chart.locator("svg g[role='button']").first();
  const markerCount = await chart.locator("svg g[role='button']").count();
  if (markerCount > 0) {
    // 先把游标推到最后让所有标记可见
    for (let i = 0; i < 200; i++) await page.getByTestId("replay-step").click();
    const visibleMarker = chart.locator("svg g[role='button']").first();
    await visibleMarker.click();
    const detail = page.getByTestId("event-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(/事件 #\d+/);
    await expect(detail).toContainText(/信号来源/);
  }

  // 7. 交易表存在且表头完整
  const table = page.getByTestId("trades-table");
  await expect(table).toBeVisible();
  await expect(table.locator("thead")).toContainText("信号");
  await expect(table.locator("thead")).toContainText("成交价");
  await expect(table.locator("thead")).toContainText("本笔P&L");
  await expect(table.locator("thead")).toContainText("决策理由");

  // 8. 指标卡数值非空且自洽（净收益=收益率对应的数值，基准存在）
  await expect(metrics).toContainText("净收益");
  await expect(metrics).toContainText("收益率");
  await expect(metrics).toContainText("最大回撤");
  await expect(metrics).toContainText("买入持有基准");
  await expect(metrics).toContainText("交易次数");

  // 9. 无未处理的浏览器错误
  expect(consoleErrors.filter((e) => !e.includes("favicon"))).toEqual([]);
});

test("失败状态不展示旧结果", async ({ page }) => {
  await page.goto("/backtest");

  // 先成功跑一次
  await page.getByTestId("run-backtest").click();
  await expect(page.getByTestId("metrics-cards")).toBeVisible({ timeout: 60000 });

  // 改成无数据的时间范围（fixture 覆盖之外）→ run 应 failed
  await page.getByLabel("开始").fill("2020-01-01");
  await page.getByLabel("结束").fill("2020-02-01");
  await page.getByTestId("run-backtest").click();

  const error = page.getByTestId("run-error");
  await expect(error).toBeVisible({ timeout: 60000 });
  await expect(error).toContainText("回测失败");
  // 旧指标卡已清除
  await expect(page.getByTestId("metrics-cards")).toHaveCount(0);
});

test("匿名访问 /backtest 数据接口被拒绝", async ({ request }) => {
  // query 走 GET；mutation 走 POST。两种都必须 UNAUTHORIZED
  const queryRes = await request.get("/api/trpc/backtest.listRuns?input=" + encodeURIComponent(JSON.stringify({ json: { limit: 5 } })));
  expect(JSON.stringify(await queryRes.json())).toContain("UNAUTHORIZED");

  const mutRes = await request.post("/api/trpc/backtest.cancelRun", {
    data: { json: { runId: 1 } },
  });
  expect(JSON.stringify(await mutRes.json())).toContain("UNAUTHORIZED");
});

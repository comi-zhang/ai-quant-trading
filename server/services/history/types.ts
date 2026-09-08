import { z } from "zod";

/**
 * 历史行情数据模型（类型化，前后端共享语义）
 */

export const periodSchema = z.enum(["day", "week", "month"]);
export type Period = z.infer<typeof periodSchema>;

export const dataSourceSchema = z.enum(["longbridge", "fixture"]);
export type DataSource = z.infer<typeof dataSourceSchema>;

export const qualityStatusSchema = z.enum(["ok", "partial", "degraded"]);
export type QualityStatus = z.infer<typeof qualityStatusSchema>;

export const historyBarSchema = z.object({
  /** ISO8601 UTC（日K为交易日 04:00 UTC = 美东 00:00） */
  timestamp: z.string(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  volume: z.number().min(0),
  turnover: z.number().min(0).optional(),
});
export type HistoryBar = z.infer<typeof historyBarSchema>;

export interface HistoryDataSet {
  symbol: string; // 规范化形，如 AAPL.US
  market: string; // US / HK / ...
  period: Period;
  bars: HistoryBar[]; // 时间升序
  source: DataSource;
  /** 数据拉取时间（ISO） */
  fetchedAt: string;
  timezone: "UTC";
  /** 数据内容版本（bars 内容 sha256 前 12 位）；同数据同版本 */
  dataVersion: string;
  qualityStatus: QualityStatus;
  /** 质量警告（缺口/异常/截断等），空数组=无警告 */
  warnings: string[];
  /** 实际覆盖时间范围 */
  actualRange: { start: string; end: string } | null;
}

/** 查询输入（服务端 zod 校验） */
export const historyQuerySchema = z
  .object({
    symbol: z.string().min(1).max(20),
    period: periodSchema.default("day"),
    startTime: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    endTime: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    source: dataSourceSchema.optional(),
  })
  .refine((v) => new Date(v.startTime).getTime() < new Date(v.endTime).getTime(), {
    message: "startTime 必须早于 endTime",
  })
  .refine(
    (v) => new Date(v.endTime).getTime() - new Date(v.startTime).getTime() <= 5 * 366 * 24 * 3600 * 1000,
    { message: "时间范围不能超过 5 年" }
  );
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export const MAX_BARS = 1500;

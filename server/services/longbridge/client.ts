import crypto from "crypto";
import axios, { type AxiosInstance } from "axios";
import { ENV } from "../../_core/env";

/**
 * Longbridge 签名 HTTP 客户端（与官方 SDK longport-httpcli 4.3.7 一致）
 *
 * 签名算法（官方 rust 源码 signature.rs）：
 *   signed_headers = "authorization;x-api-key;x-timestamp"
 *   signed_values  = "authorization:{token}\nx-api-key:{key}\nx-timestamp:{ts}\n"
 *   str_to_sign    = "{METHOD}|{path}|{query}|{signed_values}|{signed_headers}|" + sha1hex(body)?
 *   signature      = hex( HMAC-SHA256( "HMAC-SHA256|" + sha1hex(str_to_sign), app_secret ) )
 *   X-Api-Signature = "HMAC-SHA256 SignedHeaders={signed_headers}, Signature={signature}"
 *
 * 安全要求：任何日志都不得包含 token/app key/app secret/签名。
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface GatewayRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

/** 可注入的传输层（测试时替换，无需真实网络） */
export type Transport = (req: {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}) => Promise<RawResponse>;

// ---------- 错误分类 ----------
export type GatewayErrorKind =
  | "AUTH" // 鉴权失败/凭据缺失
  | "RATE_LIMIT" // 429
  | "UPSTREAM" // 5xx / 上游业务错误码
  | "NETWORK" // 连接/超时
  | "BAD_RESPONSE" // envelope 非法 / 反序列化失败
  | "CLIENT"; // 4xx 其他

export class GatewayError extends Error {
  constructor(
    readonly kind: GatewayErrorKind,
    message: string,
    readonly opts?: { status?: number; apiCode?: number; traceId?: string }
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

interface Envelope {
  code?: number;
  message?: string;
  data?: unknown;
}

const RETRY_COUNT = 3;
const RETRY_INITIAL_DELAY_MS = 300;

function sha1Hex(data: string): string {
  return crypto.createHash("sha1").update(data, "utf8").digest("hex");
}

function hmacSha256Hex(data: string, key: string): string {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest("hex");
}

/** 与官方 qs 序列化一致：按 key 排序、URL 编码 */
function toQueryString(query: Record<string, string | number | boolean | undefined> = {}): string {
  const entries = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, String(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

function buildSignature(params: {
  method: HttpMethod;
  path: string;
  queryString: string;
  bodyString?: string;
  accessToken: string;
  appKey: string;
  appSecret: string;
  timestamp: string;
}): string {
  const { method, path, queryString, bodyString, accessToken, appKey, appSecret, timestamp } = params;
  const signedHeaders = "authorization;x-api-key;x-timestamp";
  const signedValues = `authorization:${accessToken}\nx-api-key:${appKey}\nx-timestamp:${timestamp}\n`;
  let strToSign = `${method}|${path}|${queryString}|${signedValues}|${signedHeaders}|`;
  if (bodyString) {
    strToSign += sha1Hex(bodyString);
  }
  const finalStr = `HMAC-SHA256|${sha1Hex(strToSign)}`;
  const signature = hmacSha256Hex(finalStr, appSecret);
  return `HMAC-SHA256 SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

const axiosTransport =
  (client: AxiosInstance): Transport =>
  async ({ url, method, headers, body, timeoutMs }) => {
    try {
      const resp = await client.request({
        url,
        method,
        headers,
        data: body,
        timeout: timeoutMs,
        // 保持原始文本，envelope 由上层解析
        transformResponse: [(d) => d],
        responseType: "text",
        validateStatus: () => true,
      });
      const headersOut: Record<string, string> = {};
      for (const [k, v] of Object.entries(resp.headers ?? {})) {
        if (typeof v === "string") headersOut[k.toLowerCase()] = v;
      }
      return { status: resp.status, headers: headersOut, text: String(resp.data ?? "") };
    } catch (err) {
      throw new GatewayError("NETWORK", `网络请求失败: ${(err as Error).message}`);
    }
  };

export interface LongbridgeClientOptions {
  baseUrl?: string;
  accessToken?: string;
  appKey?: string;
  appSecret?: string;
  transport?: Transport;
  /** 测试时注入固定时间戳，保证签名可重现 */
  now?: () => number;
}

export class LongbridgeClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly transport: Transport;
  private readonly now: () => number;

  constructor(opts: LongbridgeClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? ENV.longbridgeHttpUrl).replace(/\/$/, "");
    this.accessToken = opts.accessToken ?? ENV.longbridgeAccessToken;
    this.appKey = opts.appKey ?? ENV.longbridgeAppKey;
    this.appSecret = opts.appSecret ?? ENV.longbridgeAppSecret;
    this.transport =
      opts.transport ??
      axiosTransport(axios.create({ maxRedirects: 0, decompress: true }));
    this.now = opts.now ?? (() => Date.now());
  }

  get configured(): boolean {
    return Boolean(this.accessToken && this.appKey && this.appSecret);
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new GatewayError("AUTH", "Longbridge 凭据未配置（ACCESS_TOKEN/APP_KEY/APP_SECRET）");
    }
  }

  private buildHeaders(method: HttpMethod, path: string, queryString: string, bodyString?: string) {
    const timestamp = Math.floor(this.now() / 1000).toString();
    return {
      Authorization: this.accessToken,
      "X-Api-Key": this.appKey,
      "X-Timestamp": timestamp,
      "X-Api-Signature": buildSignature({
        method,
        path,
        queryString,
        bodyString,
        accessToken: this.accessToken,
        appKey: this.appKey,
        appSecret: this.appSecret,
        timestamp,
      }),
      "Content-Type": "application/json; charset=utf-8",
    };
  }

  private parseEnvelope(raw: RawResponse): unknown {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw.text) as Envelope;
    } catch {
      if (raw.status === 200) {
        throw new GatewayError("BAD_RESPONSE", "上游返回非 JSON 响应", { status: raw.status });
      }
      throw new GatewayError(this.kindFromStatus(raw.status), `上游 HTTP ${raw.status}`, {
        status: raw.status,
      });
    }

    const traceId = raw.headers["x-trace-id"];
    if (typeof envelope.code !== "number") {
      if (raw.status === 200) {
        throw new GatewayError("BAD_RESPONSE", "上游响应缺少 code 字段", { status: raw.status, traceId });
      }
      throw new GatewayError(this.kindFromStatus(raw.status), `上游 HTTP ${raw.status}`, {
        status: raw.status,
        traceId,
      });
    }
    if (envelope.code !== 0) {
      const kind: GatewayErrorKind =
        envelope.code === 401 || raw.status === 401
          ? "AUTH"
          : raw.status === 429
            ? "RATE_LIMIT"
            : "UPSTREAM";
      // message 来自上游，可能含敏感信息：只透传 code，message 截断
      const msg = (envelope.message ?? "unknown").slice(0, 120);
      throw new GatewayError(kind, `Longbridge API 错误 code=${envelope.code}: ${msg}`, {
        status: raw.status,
        apiCode: envelope.code,
        traceId,
      });
    }
    return envelope.data;
  }

  private kindFromStatus(status: number): GatewayErrorKind {
    if (status === 401 || status === 403) return "AUTH";
    if (status === 429) return "RATE_LIMIT";
    if (status >= 500) return "UPSTREAM";
    return "CLIENT";
  }

  /** 单次请求（不重试） */
  async requestOnce<T = unknown>(req: GatewayRequest): Promise<T> {
    this.assertConfigured();
    const queryString = toQueryString(req.query);
    const bodyString = req.body === undefined ? undefined : JSON.stringify(req.body);
    const url = `${this.baseUrl}${req.path}${queryString ? `?${queryString}` : ""}`;
    const headers = this.buildHeaders(req.method, req.path, queryString, bodyString);

    const raw = await this.transport({
      url,
      method: req.method,
      headers,
      body: bodyString,
      timeoutMs: req.timeoutMs ?? 10_000,
    });

    if (raw.status === 429) {
      throw new GatewayError("RATE_LIMIT", "触发上游限流 (429)", { status: 429 });
    }
    return this.parseEnvelope(raw) as T;
  }

  /** 带 429 指数退避重试（与官方 SDK 行为一致） */
  async request<T = unknown>(req: GatewayRequest): Promise<T> {
    let delay = RETRY_INITIAL_DELAY_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestOnce<T>(req);
      } catch (err) {
        if (err instanceof GatewayError && err.kind === "RATE_LIMIT" && attempt < RETRY_COUNT) {
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
          continue;
        }
        throw err;
      }
    }
  }
}

let _defaultClient: LongbridgeClient | null = null;
/** 进程级默认客户端（读环境变量；测试请自行构造实例注入 transport） */
export function getDefaultClient(): LongbridgeClient {
  _defaultClient ??= new LongbridgeClient();
  return _defaultClient;
}

/** 测试辅助：重置默认客户端 */
export function resetDefaultClient(): void {
  _defaultClient = null;
}

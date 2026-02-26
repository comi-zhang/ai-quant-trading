import axios from "axios";
import crypto from "crypto";
import { ENV } from "../_core/env";

const LONGBRIDGE_API_URL = "https://openapi.longportapp.com";

type HttpMethod = "GET" | "POST" | "DELETE";

type QueryValue = string | number | boolean | null | undefined;

interface LongbridgeRequestOptions {
  method: HttpMethod;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  timeoutMs?: number;
}

interface LongbridgeEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

function toQueryString(query: Record<string, QueryValue> = {}): string {
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.append(key, value);
  }
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

function assertLongbridgeCredentials() {
  if (!ENV.longbridgeAccessToken) {
    throw new Error("LONGBRIDGE_ACCESS_TOKEN is not configured");
  }
  if (!ENV.longbridgeAppKey) {
    throw new Error("LONGBRIDGE_APP_KEY is not configured");
  }
  if (!ENV.longbridgeAppSecret) {
    throw new Error("LONGBRIDGE_APP_SECRET is not configured");
  }
}

function buildHeaders(
  method: HttpMethod,
  pathWithQuery: string,
  bodyString: string
): Record<string, string> {
  assertLongbridgeCredentials();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = `${method}|${pathWithQuery}|${bodyString}|${ENV.longbridgeAccessToken}|${timestamp}`;
  const signature = crypto
    .createHmac("sha256", ENV.longbridgeAppSecret)
    .update(payload)
    .digest("base64");

  return {
    Authorization: ENV.longbridgeAccessToken,
    "X-Api-Key": ENV.longbridgeAppKey,
    "X-Api-Signature": signature,
    "X-Timestamp": timestamp,
    "Content-Type": "application/json; charset=utf-8",
  };
}

function unwrapEnvelope<T>(payload: unknown): T {
  const envelope = payload as LongbridgeEnvelope<T>;
  if (typeof envelope?.code === "number") {
    if (envelope.code !== 0) {
      throw new Error(`Longbridge API error ${envelope.code}: ${envelope.message ?? "unknown"}`);
    }
    return envelope.data as T;
  }
  return payload as T;
}

export async function longbridgeRequest<T>({
  method,
  path,
  query,
  body,
  timeoutMs = 10000,
}: LongbridgeRequestOptions): Promise<T> {
  const pathWithQuery = `${path}${toQueryString(query)}`;
  const bodyString = body === undefined ? "" : JSON.stringify(body);
  const headers = buildHeaders(method, pathWithQuery, bodyString);
  const url = `${LONGBRIDGE_API_URL}${pathWithQuery}`;

  const response = await axios.request({
    url,
    method,
    data: body,
    timeout: timeoutMs,
    headers,
  });

  return unwrapEnvelope<T>(response.data);
}

export function normalizeLongbridgeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    return normalized;
  }
  if (normalized.includes(".")) {
    return normalized;
  }
  return `${normalized}.US`;
}

export function displaySymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized.includes(".")) {
    return normalized;
  }
  return normalized.split(".")[0] ?? normalized;
}

export function numberValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

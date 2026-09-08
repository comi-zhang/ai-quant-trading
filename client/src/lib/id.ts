/** 浏览器环境的幂等键生成（优先 crypto.randomUUID） */
export function randomUUID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // 兜底：时间戳 + 随机数（仅用于幂等键，非安全用途）
  return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

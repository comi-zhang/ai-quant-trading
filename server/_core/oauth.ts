import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { createHash, timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// Simple username/password auth for single user
// 凭据只从环境变量读取：AUTH_USERNAME + AUTH_PASSWORD_HASH（SHA-256 hex）。
// 未配置时登录端点直接拒绝，绝不存在默认/硬编码凭据。
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function registerSimpleAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { username, password } = req.body ?? {};

    const expectedUser = ENV.authUsername;
    const expectedHash = ENV.authPasswordHash;
    if (!expectedUser || !expectedHash) {
      // 未配置登录凭据：fail closed
      res.status(503).json({ error: "Login is not configured on this server" });
      return;
    }

    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    const userOk = username === expectedUser;
    const passOk = safeEqualHex(sha256Hex(password), expectedHash.toLowerCase());

    if (userOk && passOk) {
      const sessionToken = await sdk.createSessionToken(`local:${expectedUser}`, {
        name: expectedUser,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true, name: expectedUser });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ success: true });
  });
}

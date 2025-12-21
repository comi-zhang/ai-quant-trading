import { describe, expect, it } from "vitest";
import axios from "axios";

describe("API Keys Validation", () => {
  it("should validate Alpha Vantage API key", async () => {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    expect(apiKey).toBeDefined();
    expect(apiKey).not.toBe("");

    // Test with a lightweight endpoint
    const response = await axios.get(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=${apiKey}`
    );

    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
    // If API key is invalid, Alpha Vantage returns an error message
    expect(response.data).not.toHaveProperty("Error Message");
    expect(response.data).not.toHaveProperty("Note"); // Rate limit message
  }, 30000);

  it("should validate Stock News API key", async () => {
    const apiKey = process.env.STOCK_NEWS_API_KEY;
    expect(apiKey).toBeDefined();
    expect(apiKey).not.toBe("");

    // Test with a lightweight endpoint
    const response = await axios.get(
      `https://stocknewsapi.com/api/v1?tickers=AAPL&items=1&token=${apiKey}`
    );

    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
    // If API key is invalid, Stock News API returns an error
    expect(response.data).not.toHaveProperty("error");
  }, 30000);

  it("should validate Marketaux API key", async () => {
    const apiKey = process.env.MARKETAUX_API_KEY;
    expect(apiKey).toBeDefined();
    expect(apiKey).not.toBe("");

    // Test with a lightweight endpoint
    const response = await axios.get(
      `https://api.marketaux.com/v1/news/all?symbols=AAPL&limit=1&api_token=${apiKey}`
    );

    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
    // If API key is invalid, Marketaux returns an error
    expect(response.data).not.toHaveProperty("error");
  }, 30000);

  it("should validate Longbridge API credentials", async () => {
    const appKey = process.env.LONGBRIDGE_APP_KEY;
    const appSecret = process.env.LONGBRIDGE_APP_SECRET;
    const accessToken = process.env.LONGBRIDGE_ACCESS_TOKEN;

    expect(appKey).toBeDefined();
    expect(appKey).not.toBe("");
    expect(appSecret).toBeDefined();
    expect(appSecret).not.toBe("");
    expect(accessToken).toBeDefined();
    expect(accessToken).not.toBe("");

    // Note: Longbridge API requires SDK for proper authentication
    // This test just verifies the credentials are present
    // Full validation will be done when SDK is integrated
  });
});

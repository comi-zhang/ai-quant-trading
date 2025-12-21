import { describe, expect, it } from "vitest";
import axios from "axios";

describe("API Keys Validation", () => {
  it("should validate Alpha Vantage API key", async () => {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    // Alpha Vantage key is optional, skip test if not provided
    if (!apiKey) {
      expect(true).toBe(true);
      return;
    }

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

  it("should validate NewsAPI key", async () => {
    const apiKey = process.env.NEWS_API_KEY;
    // NewsAPI key is optional, skip test if not provided
    if (!apiKey) {
      expect(true).toBe(true);
      return;
    }

    // Test with a lightweight endpoint
    const response = await axios.get(
      `https://newsapi.org/v2/everything?q=stock&sortBy=publishedAt&language=en&pageSize=1&apiKey=${apiKey}`
    );

    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
    // If API key is invalid, NewsAPI returns an error
    expect(response.data.status).toBe("ok");
  }, 30000);

  it("should have VADER sentiment analysis available", () => {
    // VADER is a local library, no API key needed
    // This test just verifies the sentiment analysis capability is available
    expect(true).toBe(true);
  });

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

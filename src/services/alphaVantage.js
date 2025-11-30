// src/services/alphaVantage.js
import fetch from "node-fetch";
import { API_KEY } from "../config.js";

/**
 * Fetch financial data from Alpha Vantage
 */
export async function fetchStatement(symbol, type) {
  let functionName;

  switch (type.toLowerCase()) {
    case "income":
      functionName = "INCOME_STATEMENT";
      break;
    case "balance":
      functionName = "BALANCE_SHEET";
      break;
    case "cashflow":
      functionName = "CASH_FLOW";
      break;
    default:
      throw new Error(`Unknown statement type: ${type}`);
  }

  const url = `https://www.alphavantage.co/query?function=${functionName}&symbol=${symbol}&apikey=${API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // NEW DEBUG LOG (CRITICAL)
    console.log(`API RESP (${symbol}, ${type}):`, JSON.stringify(data).slice(0,300));

    if (data.Note) {
      console.warn(`Alpha Vantage rate limit reached for ${symbol}`);
      return { annualReports: [] };
    }

    if (data.Information) {
      console.warn(`Alpha Vantage info for ${symbol}: ${data.Information}`);
      return { annualReports: [] };
    }

    if (!data.annualReports || data.annualReports.length === 0) {
      console.warn(`No annualReports for ${symbol} (${type})`);
      return { annualReports: [] };
    }

    return data;
  } catch (err) {
    console.error(`Error fetching ${type} for ${symbol}:`, err.message);
    return { annualReports: [] };
  }
}

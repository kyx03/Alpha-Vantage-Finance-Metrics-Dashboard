// src/services/alphaVantage.js

import fetch from "node-fetch";

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const BASE_URL = "https://www.alphavantage.co/query";

// Helper: safely parse numbers
const safeNum = (val) => {
  if (val === undefined || val === null || val === "") return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
};

export async function fetchStatement(symbol, type) {
  try {
    let func;
    switch (type) {
      case "income":
        func = "INCOME_STATEMENT";
        break;
      case "balance":
        func = "BALANCE_SHEET";
        break;
      case "cashflow":
        func = "CASH_FLOW";
        break;
      default:
        throw new Error("Unknown statement type");
    }

    const url = `${BASE_URL}?function=${func}&symbol=${symbol}&apikey=${API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    // If API returns note (rate limit), pass it through
    if (data.Note) return data;

    // Normalize all annualReports numbers
    if (data.annualReports) {
      data.annualReports = data.annualReports.map((report) => {
        const normalized = {};
        for (const key in report) {
          // Parse all numeric fields
          if (!isNaN(Number(report[key]))) {
            normalized[key] = safeNum(report[key]);
          } else {
            normalized[key] = report[key];
          }
        }
        return normalized;
      });
    }

    return data;
  } catch (err) {
    console.error(`fetchStatement ${symbol} ${type} failed:`, err.message);
    return null;
  }
}

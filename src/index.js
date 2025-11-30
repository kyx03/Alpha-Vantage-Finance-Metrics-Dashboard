// src/index.js

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { query, pool } from "./db/connection.js";   // <-- FIXED (pool added)
import { fetchStatement } from "./services/alphaVantage.js";

const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------
// Redirect root to dashboard
// ---------------------------
app.get("/", (req, res) => {
  res.redirect("/dashboard");
});

// ---------------------------
// /load endpoint
// Fetch financial statements from Alpha Vantage and insert into PostgreSQL
// ---------------------------
app.get("/load", async (req, res) => {
  const symbols = ["TEL", "ST", "DD"]; // companies to load
  const currentYear = new Date().getFullYear();
  const yearLimit = currentYear - 3; // last 3 years

  try {
    for (let symbol of symbols) {
      try {
        // Fetch statements
        const income = await fetchStatement(symbol, "income");
        const balance = await fetchStatement(symbol, "balance");
        const cashflow = await fetchStatement(symbol, "cashflow");

        // Validate API responses
        if (!income?.annualReports || !balance?.annualReports) {
          console.log(`${symbol}: No data returned from API`);
          continue;
        }

        // Insert company or get existing
        const companyRes = await query(
          `INSERT INTO companies (symbol, name) 
           VALUES ($1, $2) 
           ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name 
           RETURNING id`,
          [symbol, symbol]
        );
        const companyId = companyRes.rows[0].id;

        // Insert financial statements (last 3 years)
        for (let i = 0; i < income.annualReports.length; i++) {
          const year = parseInt(income.annualReports[i].fiscalDateEnding.slice(0, 4));
          if (year < yearLimit) continue;

          const revenue = parseInt(income.annualReports[i].totalRevenue) || 0;
          const netIncome = parseInt(income.annualReports[i].netIncome) || 0;
          const totalAssets = parseInt(balance.annualReports[i].totalAssets) || 0;
          const totalLiabilities = parseInt(balance.annualReports[i].totalLiabilities) || 0;

          await query(
            `INSERT INTO financial_statements
             (company_id, fiscal_year, revenue, net_income, total_assets, total_liabilities)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (company_id, fiscal_year) DO UPDATE SET
                revenue = EXCLUDED.revenue,
                net_income = EXCLUDED.net_income,
                total_assets = EXCLUDED.total_assets,
                total_liabilities = EXCLUDED.total_liabilities`,
            [companyId, year, revenue, netIncome, totalAssets, totalLiabilities]
          );
        }

        console.log(`${symbol}: Data loaded successfully`);
      } catch (err) {
        console.error(`Error loading ${symbol}:`, err.message);
      }

      // Wait 15 seconds to avoid hitting free tier API limit
      await new Promise((r) => setTimeout(r, 15000));
    }

    // ---------------------------
    // Save ETL timestamp AFTER all companies are processed
    // ---------------------------
    await pool.query("INSERT INTO etl_runs (run_timestamp) VALUES (NOW())");

    res.send("Data loaded");
  } catch (err) {
    console.error("ETL Failed:", err);
    res.status(500).send("ETL failed");
  }
});

// ---------------------------
// /etl/last endpoint
// Returns last ETL timestamp
// ---------------------------
app.get("/etl-last-run", async (req, res) => {
  try {
    const result = await query(`
      SELECT run_timestamp
      FROM etl_runs
      ORDER BY run_timestamp DESC
      LIMIT 1
    `);
    if (result.rows.length === 0) {
      return res.json({ lastRun: null });
    }
    res.json({ lastRun: result.rows[0].run_timestamp });
  } catch (err) {
    console.error("Error fetching last ETL run:", err);
    res.status(500).json({ error: "Failed to fetch last ETL run" });
  }
});

// ---------------------------
// /metrics endpoint
// Returns JSON of calculated metrics
// ---------------------------
app.get("/metrics", async (req, res) => {
  try {
    const result = await query(`
      SELECT c.symbol, c.name, f.fiscal_year, f.revenue, f.net_income, f.total_assets, f.total_liabilities
      FROM financial_statements f
      JOIN companies c ON f.company_id = c.id
      ORDER BY c.symbol, f.fiscal_year
    `);

    const rows = result.rows;

    // Calculate metrics
    const metrics = rows.map((row, i, arr) => {
      const prev = arr.find(
        (r) => r.symbol === row.symbol && r.fiscal_year === row.fiscal_year - 1
      );

      return {
        symbol: row.symbol,
        name: row.name,
        fiscal_year: row.fiscal_year,
        net_margin: row.revenue ? (row.net_income / row.revenue) * 100 : null,
        current_ratio: row.total_liabilities ? row.total_assets / row.total_liabilities : null,
        revenue_yoy:
          prev && prev.revenue ? ((row.revenue - prev.revenue) / prev.revenue) * 100 : null,
        net_income_yoy:
          prev && prev.net_income ? ((row.net_income - prev.net_income) / prev.net_income) * 100 : null,
      };
    });

    res.json(metrics);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching metrics");
  }
});

// ---------------------------
// /dashboard endpoint
// Serves HTML dashboard
// ---------------------------
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

// ---------------------------
// Start server
// ---------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

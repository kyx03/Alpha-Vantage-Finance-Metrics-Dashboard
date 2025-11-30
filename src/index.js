// src/index.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";
import { fetchStatement } from "./services/alphaVantage.js";

const { Pool } = pkg;
const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

// static
app.use(express.static(path.join(rootDir, "public")));

// DB pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// ---------------------------
// /load endpoint (FIXED)
// ---------------------------
app.get("/load", async (req, res) => {
  const symbols = ["TEL", "ST", "DD"];
  const currentYear = new Date().getFullYear();
  const yearLimit = currentYear - 3;

  try {
    for (let symbol of symbols) {
      try {
        const income = await fetchStatement(symbol, "income");
        const balance = await fetchStatement(symbol, "balance");
        const cashflow = await fetchStatement(symbol, "cashflow");

        if (!income?.annualReports || !balance?.annualReports) {
          console.log(`${symbol}: No API data`);
          continue;
        }

        // insert/update company
        const companyRes = await query(
          `INSERT INTO companies (symbol, name)
           VALUES ($1,$2)
           ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [symbol, symbol]
        );
        const companyId = companyRes.rows[0].id;

        // ---------------------------
        // FIX: match years properly
        // ---------------------------
        const incomeByYear = {};
        income.annualReports.forEach(r => {
          incomeByYear[parseInt(r.fiscalDateEnding.slice(0, 4))] = r;
        });

        const balanceByYear = {};
        balance.annualReports.forEach(r => {
          balanceByYear[parseInt(r.fiscalDateEnding.slice(0, 4))] = r;
        });

        // process only years appearing in income (primary source)
        for (const yearStr of Object.keys(incomeByYear)) {
          const year = parseInt(yearStr);
          if (year < yearLimit) continue;

          const inc = incomeByYear[year];
          const bal = balanceByYear[year];

          if (!bal) {
            console.log(`${symbol}: missing balance sheet for ${year}, skipping`);
            continue;
          }

          const revenue = parseInt(inc.totalRevenue) || 0;
          const netIncome = parseInt(inc.netIncome) || 0;
          const totalAssets = parseInt(bal.totalAssets) || 0;
          const totalLiabilities = parseInt(bal.totalLiabilities) || 0;

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

        console.log(`${symbol}: Loaded successfully`);
      } catch (err) {
        console.error(`Load error for ${symbol}:`, err.message);
      }

      await new Promise(r => setTimeout(r, 15000)); // keep
    }

    await pool.query("INSERT INTO etl_runs (run_timestamp) VALUES (NOW())");
    res.send("Data loaded");
  } catch (err) {
    console.error("ETL failed:", err);
    res.status(500).send("ETL failed");
  }
});

// Other routes unchanged…
app.get("/etl-last-run", async (req, res) => {
  try {
    const result = await query(`
      SELECT run_timestamp
      FROM etl_runs
      ORDER BY run_timestamp DESC
      LIMIT 1
    `);
    res.json({ lastRun: result.rows[0]?.run_timestamp || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch" });
  }
});

app.get("/metrics", async (req, res) => {
  try {
    const result = await query(`
      SELECT c.symbol, c.name, f.fiscal_year, f.revenue, f.net_income, f.total_assets, f.total_liabilities
      FROM financial_statements f
      JOIN companies c ON f.company_id = c.id
      ORDER BY c.symbol, f.fiscal_year
    `);

    const rows = result.rows;

    const metrics = rows.map((row, _, arr) => {
      const prev = arr.find(
        r => r.symbol === row.symbol && r.fiscal_year === row.fiscal_year - 1
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
          prev && prev.net_income ? ((row.net_income - prev.net_income) / prev.net_income) * 100 : null
      };
    });

    res.json(metrics);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching metrics");
  }
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(rootDir, "public", "dashboard.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(rootDir, "public", "dashboard.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

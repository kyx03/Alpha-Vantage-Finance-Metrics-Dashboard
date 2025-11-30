// src/index.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------- PostgreSQL pool ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // required on Render
});

// ----------- Serve static dashboard ----------
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// ----------- /metrics route ----------
app.get('/metrics', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT fs.fiscal_year, c.symbol,
             fs.revenue, fs.net_income, fs.total_assets, fs.total_liabilities,
             ROUND((fs.net_income/fs.revenue)*100, 2) AS net_margin,
             ROUND((fs.total_assets/fs.total_liabilities)::numeric, 2) AS current_ratio,
             -- simple YoY calculations (NULL for first year)
             LAG(fs.revenue) OVER (PARTITION BY c.symbol ORDER BY fs.fiscal_year) AS prev_revenue,
             LAG(fs.net_income) OVER (PARTITION BY c.symbol ORDER BY fs.fiscal_year) AS prev_net_income
      FROM financial_statements fs
      JOIN companies c ON c.id = fs.company_id
      ORDER BY c.symbol, fs.fiscal_year
    `);

    const rows = result.rows.map(r => ({
      fiscal_year: r.fiscal_year,
      symbol: r.symbol,
      revenue: Number(r.revenue),
      net_income: Number(r.net_income),
      total_assets: Number(r.total_assets),
      total_liabilities: Number(r.total_liabilities),
      net_margin: Number(r.net_margin),
      current_ratio: Number(r.current_ratio),
      revenue_yoy: r.prev_revenue ? ((r.revenue - r.prev_revenue)/r.prev_revenue*100).toFixed(2) : null,
      net_income_yoy: r.prev_net_income ? ((r.net_income - r.prev_net_income)/r.prev_net_income*100).toFixed(2) : null
    }));

    res.json(rows);
  } catch (err) {
    console.error('Error fetching metrics:', err);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// ----------- /load route (ETL) ----------
app.get('/load', async (req, res) => {
  try {
    // Example ETL logic here
    // 1. Fetch data from Alpha Vantage for all companies
    // 2. Insert/update financial_statements
    // 3. Record ETL run
    const now = new Date();

    await pool.query(`
      INSERT INTO etl_runs (run_timestamp)
      VALUES ($1)
    `, [now]);

    // Send response
    res.json({ message: 'ETL executed', timestamp: now });
  } catch (err) {
    console.error('ETL Failed:', err);
    res.status(500).json({ error: 'ETL failed', details: err.message });
  }
});

// ----------- Start server ----------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

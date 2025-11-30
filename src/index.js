import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// --- PostgreSQL setup ---
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false
});

// --- Serve static files ---
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// --- Metrics endpoint ---
app.get('/metrics', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.symbol, fs.fiscal_year,
             fs.revenue, fs.net_income, fs.total_assets, fs.total_liabilities,
             CASE WHEN fs.revenue IS NOT NULL AND fs.revenue != 0 THEN (fs.net_income / fs.revenue) * 100 END AS net_margin,
             CASE WHEN fs.total_liabilities IS NOT NULL AND fs.total_liabilities != 0 THEN (fs.total_assets / fs.total_liabilities) END AS current_ratio,
             LAG(fs.revenue) OVER (PARTITION BY c.id ORDER BY fs.fiscal_year) AS prev_revenue,
             LAG(fs.net_income) OVER (PARTITION BY c.id ORDER BY fs.fiscal_year) AS prev_net_income
      FROM financial_statements fs
      JOIN companies c ON c.id = fs.company_id
      ORDER BY c.symbol, fs.fiscal_year
    `);

   const rows = result.rows.map(r => ({
  symbol: r.symbol,
  fiscal_year: r.fiscal_year,
  revenue: r.revenue ? Number(r.revenue) : null,
  net_income: r.net_income ? Number(r.net_income) : null,
  total_assets: r.total_assets ? Number(r.total_assets) : null,
  total_liabilities: r.total_liabilities ? Number(r.total_liabilities) : null,
  net_margin: typeof r.net_margin === 'number' ? Number(r.net_margin.toFixed(2)) : null,
  current_ratio: typeof r.current_ratio === 'number' ? Number(r.current_ratio.toFixed(2)) : null,
  revenue_yoy: (r.prev_revenue && r.revenue) ? ((r.revenue - r.prev_revenue) / r.prev_revenue) * 100 : null,
  net_income_yoy: (r.prev_net_income && r.net_income) ? ((r.net_income - r.prev_net_income) / r.prev_net_income) * 100 : null
}));

    res.json(rows);
  } catch (err) {
    console.error('Error fetching metrics:', err);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// --- ETL endpoint ---
app.get('/load', async (req, res) => {
  try {
    const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!alphaKey) throw new Error('Missing ALPHA_VANTAGE_API_KEY');

    // Example: load for all companies in DB
    const { rows: companies } = await pool.query('SELECT id, symbol FROM companies');

    for (const c of companies) {
      try {
        // Fetch dummy data (replace with real API calls)
        const response = await fetch(`https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol=${c.symbol}&apikey=${alphaKey}`);
        const data = await response.json();

        // Pick latest fiscal year
        const fiscal = data.annualReports?.[0];
        if (!fiscal) continue;

        await pool.query(`
          INSERT INTO financial_statements (company_id, fiscal_year, revenue, net_income, total_assets, total_liabilities)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (company_id, fiscal_year) DO UPDATE
            SET revenue = EXCLUDED.revenue,
                net_income = EXCLUDED.net_income,
                total_assets = EXCLUDED.total_assets,
                total_liabilities = EXCLUDED.total_liabilities
        `, [
          c.id,
          Number(fiscal.fiscalDateEnding.split('-')[0]),
          Number(fiscal.totalRevenue),
          Number(fiscal.netIncome),
          Number(fiscal.totalAssets),
          Number(fiscal.totalLiabilities)
        ]);
      } catch (e) {
        console.error(`Failed to load ${c.symbol}:`, e);
      }
    }

    // Record ETL run
    await pool.query('INSERT INTO etl_runs (run_timestamp) VALUES (NOW())');

    res.json({ status: 'success', loaded_companies: companies.length });
  } catch (err) {
    console.error('ETL Failed:', err);
    res.status(500).json({ error: 'ETL failed', message: err.message });
  }
});

// --- Fallback to dashboard ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


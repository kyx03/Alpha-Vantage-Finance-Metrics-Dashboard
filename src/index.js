import express from 'express';
import fetch from 'node-fetch';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_API_KEY;

// Utility: safe number conversion
function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const num = Number(value.replace(/,/g, ''));
    return isNaN(num) ? null : num;
  }
  return Number(value);
}

// ETL endpoint
app.get('/load', async (req, res) => {
  try {
    const client = await pool.connect();

    // Fetch all companies
    const { rows: companies } = await client.query('SELECT id, symbol FROM companies');
    let inserted = 0;

    for (const company of companies) {
      try {
        const url = `https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol=${company.symbol}&apikey=${ALPHA_VANTAGE_KEY}`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (!data.annualReports || data.annualReports.length === 0) {
          console.warn(`No annual reports for ${company.symbol}`);
          continue;
        }

        for (const report of data.annualReports) {
          const fiscal_year = parseInt(report.fiscalDateEnding.split('-')[0]);
          const revenue = toNumber(report.totalRevenue);
          const net_income = toNumber(report.netIncome);
          const total_assets = toNumber(report.totalAssets);
          const total_liabilities = toNumber(report.totalLiabilities);

          await client.query(
            `INSERT INTO financial_statements (company_id, fiscal_year, revenue, net_income, total_assets, total_liabilities)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (company_id, fiscal_year) DO UPDATE
             SET revenue=EXCLUDED.revenue,
                 net_income=EXCLUDED.net_income,
                 total_assets=EXCLUDED.total_assets,
                 total_liabilities=EXCLUDED.total_liabilities`,
            [company.id, fiscal_year, revenue, net_income, total_assets, total_liabilities]
          );

          inserted++;
        }
      } catch (err) {
        console.error(`Failed to load data for ${company.symbol}:`, err.message);
      }
    }

    // Log ETL run
    await client.query(`INSERT INTO etl_runs (run_timestamp) VALUES (NOW())`);

    client.release();
    res.send(`ETL completed, inserted/updated ${inserted} rows.`);
  } catch (err) {
    console.error('ETL Failed:', err);
    res.status(500).send('ETL Failed: ' + err.message);
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

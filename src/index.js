// src/index.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import pkg from "pg";
import { fetchStatement } from "./services/alphaVantage.js";

const { Pool } = pkg;
const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

// serve static files
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

// Initialize database schema
async function initializeDatabase() {
  try {
    // Execute each CREATE TABLE statement separately to avoid multi-statement issues
    await query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL
      )
    `);
    
    await query(`
      CREATE TABLE IF NOT EXISTS financial_statements (
        company_id INT NOT NULL,
        fiscal_year INT NOT NULL,
        revenue NUMERIC,
        net_income NUMERIC,
        total_assets NUMERIC,
        total_liabilities NUMERIC,
        CONSTRAINT financial_statements_pkey PRIMARY KEY (company_id, fiscal_year),
        CONSTRAINT fk_company
          FOREIGN KEY (company_id)
          REFERENCES companies(id)
          ON DELETE CASCADE
      )
    `);
    
    await query(`
      CREATE TABLE IF NOT EXISTS etl_runs (
        id SERIAL PRIMARY KEY,
        run_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    console.log("Database schema initialized successfully");
  } catch (err) {
    console.error("Database initialization error:", err.message);
    throw err;
  }
}

// ---------------------------
// Helper: robust numeric parser
// ---------------------------
function safeNum(val) {
  if (val === undefined || val === null) return 0;
  // convert to string, remove commas and parentheses, trim
  const s = String(val).replace(/,/g, "").replace(/\(/g, "-").replace(/\)/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------
// /load endpoint (only minimally updated)
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
          console.log(`${symbol}: No API data (income or balance missing)`);
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

        if (!companyRes || !companyRes.rows || companyRes.rows.length === 0) {
          console.error(`${symbol}: failed to create/get company row, skipping symbol`);
          continue;
        }
        const companyId = companyRes.rows[0].id;

        // build lookup by year for income & balance
        const incomeByYear = {};
        income.annualReports.forEach(r => {
          const fy = r?.fiscalDateEnding ? parseInt(r.fiscalDateEnding.slice(0, 4)) : null;
          if (fy) incomeByYear[fy] = r;
        });

        const balanceByYear = {};
        balance.annualReports.forEach(r => {
          const fy = r?.fiscalDateEnding ? parseInt(r.fiscalDateEnding.slice(0, 4)) : null;
          if (fy) balanceByYear[fy] = r;
        });

        // iterate over income years (only last 3 will be inside annualReports.slice(0,3) typically)
        for (const yearStr of Object.keys(incomeByYear)) {
          const year = parseInt(yearStr);
          if (Number.isNaN(year) || year < yearLimit) continue;

          const inc = incomeByYear[year];
          const bal = balanceByYear[year];

          if (!bal) {
            console.log(`${symbol}: missing balance sheet for ${year}, skipping`);
            continue;
          }

          // Use safeNum to parse numeric fields (handles commas, parentheses, etc.)
          // NOTE: Alpha Vantage income reports do not always provide "totalRevenue" — grossProfit is used as a proxy.
          const revenue = safeNum(inc.grossProfit ?? inc.totalRevenue ?? 0);
          const netIncome = safeNum(inc.netIncome ?? 0);
          const totalAssets = safeNum(bal.totalAssets ?? 0);
          const totalLiabilities = safeNum(bal.totalLiabilities ?? 0);

          // Log values we will insert (helps debug why table stays empty)
          console.log(
            `${symbol} ${year} -> companyId=${companyId}, revenue=${revenue}, netIncome=${netIncome}, totalAssets=${totalAssets}, totalLiabilities=${totalLiabilities}`
          );

          try {
            const insertRes = await query(
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
            // insertRes doesn't directly show affected row count for INSERT without RETURNING,
            // but logging success is still helpful
            console.log(`${symbol} ${year}: insert/update attempted`);
          } catch (dbErr) {
            console.error(`${symbol} ${year}: DB insert failed:`, dbErr.message);
          }
        }

        console.log(`${symbol}: Loaded (ETL loop)`);
      } catch (err) {
        console.error(`Load error for ${symbol}:`, err && err.message ? err.message : err);
      }

      // Respect API rate limits
      await new Promise(r => setTimeout(r, 15000));
    }

    // record ETL run
    try {
      await pool.query("INSERT INTO etl_runs (run_timestamp) VALUES (NOW())");
    } catch (err) {
      console.error("Failed to record ETL run:", err.message);
    }

    res.send("Data loaded");
  } catch (err) {
    console.error("ETL failed:", err && err.message ? err.message : err);
    res.status(500).send("ETL failed");
  }
});

// ---------------------------
// other routes unchanged
// ---------------------------
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

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

// Validate required environment variables
function validateEnvironment() {
  if (!process.env.ALPHA_VANTAGE_API_KEY) {
    console.warn("⚠️  WARNING: ALPHA_VANTAGE_API_KEY is not set!");
    console.warn("⚠️  ETL functionality will not work until this is configured.");
    console.warn("⚠️  Please set ALPHA_VANTAGE_API_KEY in Replit Secrets.");
  }
  if (!process.env.DATABASE_URL) {
    console.error("❌ ERROR: DATABASE_URL is not set!");
    throw new Error("DATABASE_URL is required");
  }
}

// Initialize database and start server
validateEnvironment();
initializeDatabase().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
    if (!process.env.ALPHA_VANTAGE_API_KEY) {
      console.warn("⚠️  Remember to set ALPHA_VANTAGE_API_KEY to enable ETL functionality!");
    }
  });
}).catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// // src/index.js
// import express from "express";
// import path from "path";
// import { fileURLToPath } from "url";
// import { readFileSync } from "fs";
// import pkg from "pg";
// import { fetchStatement } from "./services/alphaVantage.js";

// const { Pool } = pkg;
// const app = express();
// app.use(express.json());

// const __dirname = path.dirname(fileURLToPath(import.meta.url));
// const rootDir = path.join(__dirname, "..");

// // serve static files
// app.use(express.static(path.join(rootDir, "public")));

// // DB pool
// const pool = new Pool({
//   connectionString: process.env.DATABASE_URL,
//   ssl: { rejectUnauthorized: false }
// });

// async function query(text, params) {
//   const client = await pool.connect();
//   try {
//     return await client.query(text, params);
//   } finally {
//     client.release();
//   }
// }

// // Initialize database schema
// async function initializeDatabase() {
//   try {
//     // Execute each CREATE TABLE statement separately to avoid multi-statement issues
//     await query(`
//       CREATE TABLE IF NOT EXISTS companies (
//         id SERIAL PRIMARY KEY,
//         symbol VARCHAR(10) UNIQUE NOT NULL,
//         name VARCHAR(255) NOT NULL
//       )
//     `);
    
//     await query(`
//       CREATE TABLE IF NOT EXISTS financial_statements (
//         company_id INT NOT NULL,
//         fiscal_year INT NOT NULL,
//         revenue NUMERIC,
//         net_income NUMERIC,
//         total_assets NUMERIC,
//         total_liabilities NUMERIC,
//         CONSTRAINT financial_statements_pkey PRIMARY KEY (company_id, fiscal_year),
//         CONSTRAINT fk_company
//           FOREIGN KEY (company_id)
//           REFERENCES companies(id)
//           ON DELETE CASCADE
//       )
//     `);
    
//     await query(`
//       CREATE TABLE IF NOT EXISTS etl_runs (
//         id SERIAL PRIMARY KEY,
//         run_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
//       )
//     `);
    
//     console.log("Database schema initialized successfully");
//   } catch (err) {
//     console.error("Database initialization error:", err.message);
//     throw err;
//   }
// }

// // ---------------------------
// // Helper: robust numeric parser
// // ---------------------------
// function safeNum(val) {
//   if (val === undefined || val === null) return 0;
//   // convert to string, remove commas and parentheses, trim
//   const s = String(val).replace(/,/g, "").replace(/\(/g, "-").replace(/\)/g, "").trim();
//   const n = Number(s);
//   return Number.isFinite(n) ? n : 0;
// }

// // ---------------------------
// // /load endpoint (only minimally updated)
// // ---------------------------
// app.get("/load", async (req, res) => {
//   const symbols = ["TEL", "ST", "DD"];
//   const currentYear = new Date().getFullYear();
//   const yearLimit = currentYear - 3;

//   try {
//     for (let symbol of symbols) {
//       try {
//         const income = await fetchStatement(symbol, "income");
//         const balance = await fetchStatement(symbol, "balance");
//         const cashflow = await fetchStatement(symbol, "cashflow");

//         if (!income?.annualReports || !balance?.annualReports) {
//           console.log(`${symbol}: No API data (income or balance missing)`);
//           continue;
//         }

//         // insert/update company
//         const companyRes = await query(
//           `INSERT INTO companies (symbol, name)
//            VALUES ($1,$2)
//            ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name
//            RETURNING id`,
//           [symbol, symbol]
//         );

//         if (!companyRes || !companyRes.rows || companyRes.rows.length === 0) {
//           console.error(`${symbol}: failed to create/get company row, skipping symbol`);
//           continue;
//         }
//         const companyId = companyRes.rows[0].id;

//         // build lookup by year for income & balance
//         const incomeByYear = {};
//         income.annualReports.forEach(r => {
//           const fy = r?.fiscalDateEnding ? parseInt(r.fiscalDateEnding.slice(0, 4)) : null;
//           if (fy) incomeByYear[fy] = r;
//         });

//         const balanceByYear = {};
//         balance.annualReports.forEach(r => {
//           const fy = r?.fiscalDateEnding ? parseInt(r.fiscalDateEnding.slice(0, 4)) : null;
//           if (fy) balanceByYear[fy] = r;
//         });

//         // iterate over income years (only last 3 will be inside annualReports.slice(0,3) typically)
//         for (const yearStr of Object.keys(incomeByYear)) {
//           const year = parseInt(yearStr);
//           if (Number.isNaN(year) || year < yearLimit) continue;

//           const inc = incomeByYear[year];
//           const bal = balanceByYear[year];

//           if (!bal) {
//             console.log(`${symbol}: missing balance sheet for ${year}, skipping`);
//             continue;
//           }

//           // Use safeNum to parse numeric fields (handles commas, parentheses, etc.)
//           // NOTE: Alpha Vantage income reports do not always provide "totalRevenue" — grossProfit is used as a proxy.
//           const revenue = safeNum(inc.grossProfit ?? inc.totalRevenue ?? 0);
//           const netIncome = safeNum(inc.netIncome ?? 0);
//           const totalAssets = safeNum(bal.totalAssets ?? 0);
//           const totalLiabilities = safeNum(bal.totalLiabilities ?? 0);

//           // Log values we will insert (helps debug why table stays empty)
//           console.log(
//             `${symbol} ${year} -> companyId=${companyId}, revenue=${revenue}, netIncome=${netIncome}, totalAssets=${totalAssets}, totalLiabilities=${totalLiabilities}`
//           );

//           try {
//             const insertRes = await query(
//               `INSERT INTO financial_statements
//                (company_id, fiscal_year, revenue, net_income, total_assets, total_liabilities)
//                VALUES ($1,$2,$3,$4,$5,$6)
//                ON CONFLICT (company_id, fiscal_year) DO UPDATE SET
//                  revenue = EXCLUDED.revenue,
//                  net_income = EXCLUDED.net_income,
//                  total_assets = EXCLUDED.total_assets,
//                  total_liabilities = EXCLUDED.total_liabilities`,
//               [companyId, year, revenue, netIncome, totalAssets, totalLiabilities]
//             );
//             // insertRes doesn't directly show affected row count for INSERT without RETURNING,
//             // but logging success is still helpful
//             console.log(`${symbol} ${year}: insert/update attempted`);
//           } catch (dbErr) {
//             console.error(`${symbol} ${year}: DB insert failed:`, dbErr.message);
//           }
//         }

//         console.log(`${symbol}: Loaded (ETL loop)`);
//       } catch (err) {
//         console.error(`Load error for ${symbol}:`, err && err.message ? err.message : err);
//       }

//       // Respect API rate limits
//       await new Promise(r => setTimeout(r, 15000));
//     }

//     // record ETL run
//     try {
//       await pool.query("INSERT INTO etl_runs (run_timestamp) VALUES (NOW())");
//     } catch (err) {
//       console.error("Failed to record ETL run:", err.message);
//     }

//     res.send("Data loaded");
//   } catch (err) {
//     console.error("ETL failed:", err && err.message ? err.message : err);
//     res.status(500).send("ETL failed");
//   }
// });

// // ---------------------------
// // other routes unchanged
// // ---------------------------
// app.get("/etl-last-run", async (req, res) => {
//   try {
//     const result = await query(`
//       SELECT run_timestamp
//       FROM etl_runs
//       ORDER BY run_timestamp DESC
//       LIMIT 1
//     `);
//     res.json({ lastRun: result.rows[0]?.run_timestamp || null });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to fetch" });
//   }
// });

// app.get("/metrics", async (req, res) => {
//   try {
//     const result = await query(`
//       SELECT c.symbol, c.name, f.fiscal_year, f.revenue, f.net_income, f.total_assets, f.total_liabilities
//       FROM financial_statements f
//       JOIN companies c ON f.company_id = c.id
//       ORDER BY c.symbol, f.fiscal_year
//     `);

//     const rows = result.rows;

//     const metrics = rows.map((row, _, arr) => {
//       const prev = arr.find(
//         r => r.symbol === row.symbol && r.fiscal_year === row.fiscal_year - 1
//       );

//       return {
//         symbol: row.symbol,
//         name: row.name,
//         fiscal_year: row.fiscal_year,
//         net_margin: row.revenue ? (row.net_income / row.revenue) * 100 : null,
//         current_ratio: row.total_liabilities ? row.total_assets / row.total_liabilities : null,
//         revenue_yoy:
//           prev && prev.revenue ? ((row.revenue - prev.revenue) / prev.revenue) * 100 : null,
//         net_income_yoy:
//           prev && prev.net_income ? ((row.net_income - prev.net_income) / prev.net_income) * 100 : null
//       };
//     });

//     res.json(metrics);
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Error fetching metrics");
//   }
// });

// app.get("/dashboard", (req, res) => {
//   res.sendFile(path.join(rootDir, "public", "dashboard.html"));
// });

// app.get("/", (req, res) => {
//   res.sendFile(path.join(rootDir, "public", "dashboard.html"));
// });

// const PORT = process.env.PORT || 5000;
// const HOST = '0.0.0.0';

// // Validate required environment variables
// function validateEnvironment() {
//   if (!process.env.ALPHA_VANTAGE_API_KEY) {
//     console.warn("⚠️  WARNING: ALPHA_VANTAGE_API_KEY is not set!");
//     console.warn("⚠️  ETL functionality will not work until this is configured.");
//     console.warn("⚠️  Please set ALPHA_VANTAGE_API_KEY in Replit Secrets.");
//   }
//   if (!process.env.DATABASE_URL) {
//     console.error("❌ ERROR: DATABASE_URL is not set!");
//     throw new Error("DATABASE_URL is required");
//   }
// }

// // Initialize database and start server
// validateEnvironment();
// initializeDatabase().then(() => {
//   app.listen(PORT, HOST, () => {
//     console.log(`Server running on ${HOST}:${PORT}`);
//     if (!process.env.ALPHA_VANTAGE_API_KEY) {
//       console.warn("⚠️  Remember to set ALPHA_VANTAGE_API_KEY to enable ETL functionality!");
//     }
//   });
// }).catch(err => {
//   console.error("Failed to start server:", err);
//   process.exit(1);
// });




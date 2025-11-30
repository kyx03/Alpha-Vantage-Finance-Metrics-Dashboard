# Finance Metrics Dashboard

## Overview
A full-stack ETL + analytics application that fetches financial data from Alpha Vantage API, stores it in PostgreSQL, and visualizes financial metrics in an interactive dashboard using Chart.js.

**Current State**: Successfully imported and configured for Replit environment
**Last Updated**: November 30, 2024

## Project Architecture

### Technology Stack
- **Backend**: Node.js/Express (API + ETL orchestrator)
- **Database**: PostgreSQL (Replit-managed Neon database)
- **Data Source**: Alpha Vantage API (financial statements)
- **Frontend**: Static HTML/CSS/JavaScript with Chart.js
- **Dependencies**: express, pg, node-fetch, nodemon

### Project Structure
```
.
├── public/
│   └── dashboard.html          # Frontend dashboard with Chart.js
├── src/
│   ├── db/
│   │   ├── connection.js       # Database connection utilities
│   │   └── schema.sql          # Database schema definitions
│   ├── services/
│   │   └── alphaVantage.js     # Alpha Vantage API client
│   ├── utils/
│   │   └── transform.js        # Data transformation utilities
│   ├── config.js               # Configuration management
│   └── index.js                # Main Express server
└── package.json
```

## Key Features

1. **ETL Pipeline** (`/load` endpoint)
   - Fetches income statements, balance sheets, and cash flow data
   - Stores data in PostgreSQL with upsert logic
   - Tracks ETL run history

2. **Metrics Computation** (`/metrics` endpoint)
   - Net Margin (Net Income / Revenue)
   - Current Ratio (Total Assets / Total Liabilities)
   - Revenue YoY Growth
   - Net Income YoY Growth

3. **Interactive Dashboard**
   - Real-time chart visualization
   - Manual ETL trigger button
   - ETL status indicator
   - Auto-refresh every 5 minutes

## Database Schema

**Tables:**
- `companies`: Company master data (id, symbol, name)
- `financial_statements`: Financial data (company_id, fiscal_year, revenue, net_income, total_assets, total_liabilities)
- `etl_runs`: ETL execution log (id, run_timestamp)

## Environment Variables

### Required
- `DATABASE_URL`: PostgreSQL connection string (auto-managed by Replit)
- `ALPHA_VANTAGE_API_KEY`: API key for Alpha Vantage (user must provide)
- `PORT`: Server port (set to 5000 for Replit)

### Auto-configured by Replit
- `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPORT`

## Setup Notes

### Replit-Specific Configuration
1. **Server binding**: Updated to `0.0.0.0:5000` for Replit's proxy
2. **Port configuration**: Uses PORT=5000 to work with Replit's webview
3. **Database**: Uses Replit's managed PostgreSQL (Neon-backed)
4. **Workflow**: Configured to run `npm run dev` with nodemon for auto-reload

### Database Initialization
- Schema is automatically initialized on server startup
- Tables are created with `IF NOT EXISTS` for safety
- Connection uses SSL with `rejectUnauthorized: false` for Neon compatibility

## Running the Application

1. **Start the server**: The workflow "Start application" runs `npm run dev`
2. **Access dashboard**: Navigate to the root URL `/` or `/dashboard`
3. **Trigger ETL**: Click "Run / Load (ETL)" button or visit `/load`
4. **View metrics**: Charts update automatically after ETL completes

## API Endpoints

- `GET /` - Dashboard homepage
- `GET /dashboard` - Dashboard page
- `GET /load` - Trigger ETL pipeline
- `GET /metrics` - Get computed financial metrics (JSON)
- `GET /etl-last-run` - Get last ETL execution timestamp

## Production Considerations

As documented in the dashboard:
1. **Scheduling**: Use n8n or cron for monthly ETL runs
2. **Rate Limits**: Alpha Vantage free tier has 5 calls/min, 25 calls/day
3. **Scaling**: Implement queue-based processing with key rotation for 100+ companies
4. **Data Delivery**: Sync to BigQuery → Google Sheets for executive access
5. **Monitoring**: Track API errors, data freshness, ETL success rates

## Recent Changes
- November 30, 2024: Imported from GitHub and configured for Replit
  - Updated server to bind to 0.0.0.0:5000
  - Configured workflow for webview on port 5000
  - Set up PostgreSQL database with schema
  - Created .gitignore for Node.js project
  - Added database initialization on server startup

## Important: Alpha Vantage API Key Required

**To enable ETL functionality, you must set your Alpha Vantage API key:**

1. Get a free API key from https://www.alphavantage.co/support/#api-key
2. In Replit, go to the "Secrets" tab (Tools → Secrets)
3. Add a new secret:
   - Key: `ALPHA_VANTAGE_API_KEY`
   - Value: Your API key from Alpha Vantage
4. Restart the workflow

Without this key, the dashboard will load but the "Run / Load (ETL)" button won't fetch any data.

## Next Steps
- ⚠️ **REQUIRED**: Add ALPHA_VANTAGE_API_KEY secret (see above)
- Optionally customize company symbols in `/load` endpoint (currently: TEL, ST, DD)
- Deploy to production when ready using the Deployment tab

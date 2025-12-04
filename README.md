Finance Metrics Dashboard
A full-stack ETL + analytics project using:
Node.js / Express (API + ETL orchestrator)
PostgreSQL (Docker) (data warehouse)
Alpha Vantage (financial data source)
Chart.js dashboard (front-end analytics)
Docker Compose (orchestration)

This project fetches financial statements for companies from Alpha Vantage, loads them into PostgreSQL, computes financial metrics (net margin, current ratio, revenue YoY, etc.), and visualizes them in a browser dashboard.

📦 Features

✔ ETL pipeline (/load) that fetches statements from Alpha Vantage
✔ PostgreSQL storage with ON CONFLICT upsert
✔ /metrics endpoint that returns computed metrics
✔ Interactive dashboard using Chart.js
✔ Manual ETL trigger button
✔ ETL status indicator
✔ Dockerized setup — one command to run everything
✔ Scalable design ready for production pipelines

🚀 Getting Started
1. Clone the Repository
git clone https://github.com/kyx03/Alpha-Vantage-Finance-Metrics-Dashboard.git
cd finance-dashboard

🔧 Environment Variables

Create a file named .env in the root of the project:

# Alpha Vantage
ALPHA_VANTAGE_API_KEY=YOUR_API_KEY_HERE

# Database
DB_HOST=finance_db
DB_USER=postgres
DB_PASS=postgres
DB_NAME=finance

Important: Without a valid Alpha Vantage API key, ETL will not load data.

🐳 Running with Docker (Recommended)

This project includes a ready-to-run docker-compose.yml.

1. Build and start everything
docker compose up --build

Services launched:

Service	Purpose
finance_app	Node.js ETL + API server
finance_db	PostgreSQL database
pgadmin (optional)	Web UI for DB debugging
Static Dashboard	Served at /dashboard

Once running:

➜ Dashboard
http://localhost:3000/dashboard

➜ Metrics API
http://localhost:3000/metrics

➜ Trigger ETL
http://localhost:3000/load

🗂 Database Setup
On first Docker run, PostgreSQL executes schema.sql automatically:

Tables created:

companies
financial_statements


To verify DB is working:
docker exec -it finance_db psql -U postgres -d finance


Inside Postgres:

SELECT * FROM companies;
SELECT * FROM financial_statements;

🧹 Resetting the Database

If you want a fresh start:

DELETE FROM financial_statements;
DELETE FROM companies;
or drop the whole DB:
docker compose down -v
docker compose up --build


This clears all volumes.

📊 Dashboard Overview

Available at:
/dashboard


It displays:

✓ Net Margin
✓ Current Ratio
✓ Revenue YoY
✓ Net Income YoY
✓ ETL last run timestamp
✓ Button to manually trigger ETL

Charts update after every /load call.

⚙ ETL Pipeline
Run ETL manually:
GET /load


The ETL does:

Reads companies table
Calls Alpha Vantage for each symbol
Inserts statements into financial_statements
Computes financial metrics
Dashboard refreshes metrics

🧪 Testing Endpoints
List metrics
curl http://localhost:3000/metrics

Run ETL
curl http://localhost:3000/load

🏗 Architecture
+-------------------+
|     Dashboard     |
|   (Chart.js UI)   |
+---------+---------+
          |
          v
+-------------------+      +-------------------+
|   Express API     | ---> | Alpha Vantage API |
|  /load /metrics   |      +-------------------+
+---------+---------+
          |
          v
+-------------------+
|    PostgreSQL     |
|  Financial Data    |
+-------------------+

🏭 Productionization (Explainers from Part 4)
1. Scheduling ETL (monthly)

With n8n:

[Cron Trigger → HTTP Request (/load) → Notify → Retry]
or Linux cron:
0 2 1 * * curl -fsS http://app/load

2. Handling API Rate Limits (25 calls/day)

For 100 companies:

Incremental updates only
Rotating API keys
Worker queue with throttling
Paid plan recommended

3. Delivering data to Google Sheets

Options:

Method	Pros	Cons
Direct Postgres connector	Live	Security overhead
Export CSV	Simple	Manual
Sync to BigQuery → Sheets	Scalable, secure	Requires GCP

Recommended: BigQuery → Sheets connector.

4. Monitoring

What breaks first:

API rate limits
Invalid data ("Note" / "Information" responses)
DB connection failures

Recommended alerts:

Slack/email warning for ETL failure
Log API error rate
Data freshness per company
Detect missing financial statement fields

❗ Troubleshooting
Dashboard shows no charts

✔ Check /metrics
✔ Ensure /load completed successfully
✔ Verify rows in financial_statements

ETL shows API limit error

✔ Generate new key
✔ Wait 24 hours
✔ Or rotate multiple keys

“relation does not exist”

✔ Run docker compose down -v
✔ Restart clean

🧑‍💻 Development (non-Docker)

Install dependencies:
npm install

Run API server:
npm start
Ensure PostgreSQL is running locally.

✔ You're Ready to Go!

Your project should now:

Fetch data
Store in PostgreSQL
Compute metrics
Show interactive charts

Running inside Docker

-- ===============================
-- DATABASE SCHEMA FOR FINANCE APP
-- ===============================

-- Drop tables (optional, only for fresh DB resets)
-- DROP TABLE IF EXISTS financial_statements CASCADE;
-- DROP TABLE IF EXISTS companies CASCADE;
-- DROP TABLE IF EXISTS etl_runs CASCADE;

-- =============
-- COMPANIES TABLE
-- =============
CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL
);

-- =====================================
-- FINANCIAL STATEMENTS TABLE
-- =====================================
CREATE TABLE IF NOT EXISTS financial_statements (
    company_id INT NOT NULL,
    fiscal_year INT NOT NULL,

    revenue NUMERIC,
    net_income NUMERIC,
    total_assets NUMERIC,
    total_liabilities NUMERIC,

    -- Required for ON CONFLICT (company_id, fiscal_year)
    CONSTRAINT financial_statements_pkey PRIMARY KEY (company_id, fiscal_year),

    -- Enforce company exists
    CONSTRAINT fk_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE CASCADE
);

------------------------------------------------------------
-- ETL RUN LOG TABLE
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etl_runs (
    id SERIAL PRIMARY KEY,
    run_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


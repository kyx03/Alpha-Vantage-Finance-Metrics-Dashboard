export const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
export const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASS || "postgres",
  database: process.env.DB_NAME || "finance"
};

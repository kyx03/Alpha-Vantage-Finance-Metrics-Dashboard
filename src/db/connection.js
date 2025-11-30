// import pg from "pg";
// import { DB_CONFIG } from "../config.js";

// const { Pool } = pg;

// export const pool = new Pool(DB_CONFIG);

// export async function query(sql, params) {
//   return pool.query(sql, params);
// }


import pg from "pg";

const connectionString = process.env.DATABASE_URL || process.env.DB_URL;
export const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
export const query = (text, params) => pool.query(text, params);


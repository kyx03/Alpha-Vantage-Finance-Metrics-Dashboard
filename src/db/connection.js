import pg from "pg";
import { DB_CONFIG } from "../config.js";

const { Pool } = pg;

export const pool = new Pool(DB_CONFIG);

export async function query(sql, params) {
  return pool.query(sql, params);
}

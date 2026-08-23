import { pool } from "./pool.js";
import { schemaSql } from "./schema.js";

await pool.query(schemaSql);
console.log("Database migration complete");
await pool.end();


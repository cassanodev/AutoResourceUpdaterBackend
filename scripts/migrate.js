import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise.js";

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  multipleStatements: true,
});
try {
  const sql = (await fs.readFile(path.resolve("migrations/001_billing.sql"), "utf8")).replace(/^\uFEFF/, "");
  await connection.query(sql);
  console.log("Migration 001_billing.sql applied successfully");
} finally {
  await connection.end();
}

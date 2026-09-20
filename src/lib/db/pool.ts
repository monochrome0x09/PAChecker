import "server-only";

import mysql from "mysql2/promise";
import { isDatabaseBridgeEnabled } from "./bridge";

const requiredEnv = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"] as const;

function getDbConfig() {
  const missing = requiredEnv.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing database environment variables: ${missing.join(", ")}`);
  }

  const port = Number(process.env.DB_PORT ?? "3306");
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("DB_PORT must be a positive integer");
  }

  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT ?? "3");
  if (!Number.isInteger(connectionLimit) || connectionLimit <= 0) {
    throw new Error("DB_CONNECTION_LIMIT must be a positive integer");
  }

  const sslMode = (process.env.DB_SSL_MODE ?? "disabled").trim().toLowerCase();
  if (sslMode !== "disabled" && sslMode !== "required") {
    throw new Error('DB_SSL_MODE must be either "disabled" or "required"');
  }

  const sslCa = process.env.DB_SSL_CA?.replace(/\\n/g, "\n").trim();

  return {
    host: process.env.DB_HOST!,
    port,
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
    connectionLimit,
    ssl:
      sslMode === "required"
        ? {
            rejectUnauthorized: true,
            ...(sslCa ? { ca: sslCa } : {}),
          }
        : undefined,
  };
}

const globalForDb = globalThis as unknown as {
  pacheckerPool?: mysql.Pool;
};

export function getPool() {
  if (isDatabaseBridgeEnabled()) {
    throw new Error("Direct database pools are disabled when the database bridge is active");
  }

  if (!globalForDb.pacheckerPool) {
    globalForDb.pacheckerPool = mysql.createPool({
      ...getDbConfig(),
      waitForConnections: true,
      queueLimit: 0,
      dateStrings: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }

  return globalForDb.pacheckerPool;
}

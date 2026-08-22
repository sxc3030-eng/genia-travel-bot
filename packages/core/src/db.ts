import { Pool, type QueryResultRow } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl });

export function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
  return pool.query<T>(text, params);
}

export async function assertDbConnection(): Promise<void> {
  await pool.query('SELECT 1');
}

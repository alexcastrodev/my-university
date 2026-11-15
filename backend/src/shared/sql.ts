/**
 * The rows an `UPDATE` or `DELETE ... RETURNING` gave back. TypeORM's `query` answers those two as
 * `[rows, affectedCount]` (and a `SELECT` or `INSERT` as just the rows), so `result.length` of one is always 2
 * and a "was anything changed?" check on it is always true. Use this for the first kind only.
 */
export function returnedRows<T = unknown>(result: unknown): T[] {
  return (result as [T[], number])[0];
}

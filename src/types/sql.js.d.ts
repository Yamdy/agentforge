declare module 'sql.js' {
  export interface Database {
    run(sql: string, params?: (string | number | boolean | null)[]): Database;
    exec(sql: string, params?: (string | number | boolean | null)[]): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
  }

  export interface QueryExecResult {
    columns: string[];
    values: (string | number | boolean | null)[][];
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  export default function initSqlJs(): Promise<SqlJsStatic>;
}

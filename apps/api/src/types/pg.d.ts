declare module "pg" {
  export interface PoolClient {
    query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }>;
    execute(sql: string, params?: any[]): Promise<void>;
    release(): void;
  }

  export interface Pool {
    query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }>;
    connect(): Promise<PoolClient>;
  }

  export class Pool {
    constructor(config?: any);
    query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}

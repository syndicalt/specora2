import os
import asyncpg

class PostgresClient:
    def __init__(self):
        self.dsn = os.getenv("DATABASE_URL", "postgresql://specora:specora@localhost/specora")
        self.pool = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(self.dsn)

    async def close(self):
        if self.pool:
            await self.pool.close()

    async def enqueue(self, job_type, payload):
        async with self.pool.acquire() as conn:
            return await conn.fetchval(
                "INSERT INTO jobs (type, payload, status) VALUES ($1, $2, 'pending') RETURNING id",
                job_type, payload
            )

    async def get_pending_jobs(self, limit=10):
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, type, payload FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1",
                limit
            )
            return [dict(row) for row in rows]

    async def mark_job_status(self, job_id, status):
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2",
                status, job_id
            )

postgres_client = PostgresClient()

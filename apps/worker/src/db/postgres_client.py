import os
import json
import asyncpg
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID


def to_json_safe(value):
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, list):
        return [to_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [to_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): to_json_safe(item) for key, item in value.items()}
    return value


def encode_json(value):
    if value is None:
        return None
    return json.dumps(to_json_safe(value))


def decode_json(value):
    if isinstance(value, str):
        try:
            return to_json_safe(json.loads(value))
        except json.JSONDecodeError:
            return value
    return to_json_safe(value)


def row_to_dict(row):
    data = dict(row)
    if "payload" in data:
        data["payload"] = decode_json(data["payload"])
    return to_json_safe(data)


class PostgresClient:
    def __init__(self):
        self.dsn = os.getenv("DATABASE_URL", "postgresql://specora:specora123@localhost/specora")
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
            return [row_to_dict(row) for row in rows]

    async def mark_job_status(self, job_id, status):
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2",
                status, job_id
            )

    async def create_discovery_job(self, source_id, file_path):
        async with self.pool.acquire() as conn:
            return await conn.fetchval(
                "INSERT INTO discovery_jobs (source_id, file_path, status) VALUES ($1, $2, 'pending') RETURNING id",
                source_id, file_path
            )

    async def get_pending_discovery_jobs(self, limit=10):
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, source_id, file_path FROM discovery_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1",
                limit
            )
            return [to_json_safe(dict(row)) for row in rows]

    async def mark_discovery_job_status(self, job_id, status, stats=None):
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE discovery_jobs SET status = $1, stats = $2::jsonb, updated_at = NOW() WHERE id = $3",
                status, encode_json(stats) if stats else None, job_id
            )

    async def get_reconciliation_rules(self):
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT ci_class, match_keys, conflict_strategy FROM reconciliation_rules ORDER BY priority DESC"
            )
            return [to_json_safe(dict(row)) for row in rows]

    async def log_reconciliation(self, discovery_job_id, ci_id, action, old_values=None, new_values=None):
        async with self.pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO reconciliation_logs (discovery_job_id, ci_id, action, old_values, new_values) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)",
                discovery_job_id, ci_id, action,
                encode_json(old_values) if old_values else None,
                encode_json(new_values) if new_values else None
            )

postgres_client = PostgresClient()

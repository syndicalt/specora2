import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture
def mock_asyncpg():
    with patch("src.db.postgres_client.asyncpg") as mock:
        yield mock


@pytest_asyncio.fixture
async def client(mock_asyncpg):
    from src.db.postgres_client import PostgresClient
    c = PostgresClient()
    mock_pool = AsyncMock()
    mock_asyncpg.create_pool = AsyncMock(return_value=mock_pool)
    await c.connect()
    return c


def make_acquire_mock(conn):
    acquire_cm = AsyncMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=False)
    return acquire_cm


@pytest.mark.asyncio
async def test_connect(mock_asyncpg):
    from src.db.postgres_client import PostgresClient
    c = PostgresClient()
    mock_pool = AsyncMock()
    mock_asyncpg.create_pool = AsyncMock(return_value=mock_pool)
    await c.connect()
    assert c.pool is mock_pool
    mock_asyncpg.create_pool.assert_awaited_once()


@pytest.mark.asyncio
async def test_close(client):
    await client.close()
    client.pool.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_enqueue(client):
    conn = AsyncMock()
    conn.fetchval = AsyncMock(return_value=1)
    client.pool.acquire = MagicMock(return_value=make_acquire_mock(conn))

    job_id = await client.enqueue("ingest_cmdb", {"items": []})
    assert job_id == 1
    conn.fetchval.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_pending_jobs(client):
    conn = AsyncMock()
    row = MagicMock()
    row.items.return_value = [("id", 1), ("type", "ingest_cmdb"), ("payload", {})]
    conn.fetch = AsyncMock(return_value=[row])
    client.pool.acquire = MagicMock(return_value=make_acquire_mock(conn))

    jobs = await client.get_pending_jobs(limit=5)
    assert len(jobs) == 1
    conn.fetch.assert_awaited_once_with(
        "SELECT id, type, payload FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1",
        5
    )


@pytest.mark.asyncio
async def test_mark_job_status(client):
    conn = AsyncMock()
    client.pool.acquire = MagicMock(return_value=make_acquire_mock(conn))

    await client.mark_job_status(1, "completed")
    conn.execute.assert_awaited_once()

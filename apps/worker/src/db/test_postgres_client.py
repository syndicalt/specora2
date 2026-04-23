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


@pytest.mark.asyncio
async def test_create_discovery_job(client):
    conn = AsyncMock()
    conn.fetchval = AsyncMock(return_value="dj-1")
    client.pool.acquire = MagicMock(return_value=make_acquire_mock(conn))

    job_id = await client.create_discovery_job("src-1", "/tmp/file.csv")
    assert job_id == "dj-1"
    conn.fetchval.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_pending_discovery_jobs(client):
    conn = AsyncMock()
    row = MagicMock()
    row.items.return_value = [("id", "dj-1"), ("source_id", "src-1"), ("file_path", "/tmp/file.csv")]
    conn.fetch = AsyncMock(return_value=[row])
    client.pool.acquire = MagicMock(return_value=make_acquire_mock(conn))

    jobs = await client.get_pending_discovery_jobs(limit=3)
    assert len(jobs) == 1
    conn.fetch.assert_awaited_once_with(
        "SELECT id, source_id, file_path FROM discovery_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1",
        3
    )


@pytest.mark.asyncio
async def test_mark_discovery_job_status(client):
    conn = AsyncMock()
    client.pool.acquire = MagicMock(return_value=make_acquire_mock(conn))

    await client.mark_discovery_job_status("dj-1", "completed", {"created": 5})
    conn.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_reconciliation_rules(client):
    conn = AsyncMock()
    row = MagicMock()
    row.items.return_value = [("ci_class", "Server"), ("match_keys", ["hostname"])]
    conn.fetch = AsyncMock(return_value=[row])
    client.pool.acquire = MagicMock(return_value=make_acquire_mock(conn))

    rules = await client.get_reconciliation_rules()
    assert len(rules) == 1
    conn.fetch.assert_awaited_once()


@pytest.mark.asyncio
async def test_log_reconciliation(client):
    conn = AsyncMock()
    client.pool.acquire = MagicMock(return_value=make_acquire_mock(conn))

    await client.log_reconciliation("dj-1", "ci-1", "created", None, {"name": "Web"})
    conn.execute.assert_awaited_once()

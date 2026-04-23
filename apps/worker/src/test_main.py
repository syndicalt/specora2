import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio

from src.main import process_jobs, serve


@pytest.fixture
def mock_postgres():
    with patch("src.main.postgres_client") as mock:
        mock.connect = AsyncMock()
        mock.close = AsyncMock()
        mock.get_pending_jobs = AsyncMock(return_value=[])
        mock.mark_job_status = AsyncMock()
        yield mock


@pytest.fixture
def mock_handle_ingest():
    with patch("src.main.handle_ingest_cmdb", new_callable=AsyncMock, return_value="completed") as mock:
        yield mock


@pytest.mark.asyncio
async def test_process_jobs_no_jobs(mock_postgres):
    mock_postgres.get_pending_jobs.return_value = []
    task = asyncio.create_task(process_jobs())
    await asyncio.sleep(0.1)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    mock_postgres.connect.assert_awaited_once()
    mock_postgres.get_pending_jobs.assert_awaited()


@pytest.mark.asyncio
async def test_process_jobs_ingest_cmdb(mock_postgres, mock_handle_ingest):
    mock_postgres.get_pending_jobs.side_effect = [
        [{"id": 1, "type": "ingest_cmdb", "payload": {"items": []}}],
        asyncio.CancelledError(),
    ]
    task = asyncio.create_task(process_jobs())
    try:
        await task
    except asyncio.CancelledError:
        pass
    mock_handle_ingest.assert_awaited_once_with({"items": []})
    mock_postgres.mark_job_status.assert_awaited_once_with(1, "completed")


@pytest.mark.asyncio
async def test_process_jobs_unknown_type(mock_postgres):
    mock_postgres.get_pending_jobs.side_effect = [
        [{"id": 2, "type": "unknown", "payload": {}}],
        asyncio.CancelledError(),
    ]
    task = asyncio.create_task(process_jobs())
    try:
        await task
    except asyncio.CancelledError:
        pass
    mock_postgres.mark_job_status.assert_awaited_once_with(2, "failed")


@pytest.mark.asyncio
async def test_process_jobs_handler_exception(mock_postgres, mock_handle_ingest):
    mock_handle_ingest.side_effect = Exception("boom")
    mock_postgres.get_pending_jobs.side_effect = [
        [{"id": 3, "type": "ingest_cmdb", "payload": {}}],
        asyncio.CancelledError(),
    ]
    task = asyncio.create_task(process_jobs())
    try:
        await task
    except asyncio.CancelledError:
        pass
    mock_postgres.mark_job_status.assert_awaited_once_with(3, "failed")


@pytest.mark.asyncio
async def test_process_jobs_poll_exception(mock_postgres):
    mock_postgres.get_pending_jobs.side_effect = Exception("db down")
    task = asyncio.create_task(process_jobs())
    await asyncio.sleep(0.1)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    mock_postgres.get_pending_jobs.assert_awaited()


@pytest.mark.asyncio
async def test_serve(mock_postgres):
    with patch("src.main.grpc_aio") as mock_grpc:
        mock_server = AsyncMock()
        mock_grpc.server.return_value = mock_server
        mock_server.wait_for_termination = AsyncMock(side_effect=asyncio.CancelledError())

        task = asyncio.create_task(serve())
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        mock_server.add_insecure_port.assert_called_once()
        mock_server.start.assert_awaited_once()
        mock_postgres.close.assert_awaited_once()

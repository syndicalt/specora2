import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio
import os

from src.main import process_jobs, process_discovery_jobs, serve


@pytest.fixture
def mock_postgres():
    with patch("src.main.postgres_client") as mock:
        mock.connect = AsyncMock()
        mock.close = AsyncMock()
        mock.get_pending_jobs = AsyncMock(return_value=[])
        mock.mark_job_status = AsyncMock()
        mock.get_pending_discovery_jobs = AsyncMock(return_value=[])
        mock.mark_discovery_job_status = AsyncMock()
        yield mock


@pytest.fixture
def mock_handle_ingest():
    with patch("src.main.handle_ingest_cmdb", new_callable=AsyncMock, return_value="completed") as mock:
        yield mock


@pytest.fixture
def mock_handle_discover():
    with patch("src.main.handle_discover_file", new_callable=AsyncMock, return_value={"created": 1}) as mock:
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
async def test_process_jobs_discovery_file(mock_postgres, mock_handle_discover):
    mock_postgres.get_pending_jobs.side_effect = [
        [{"id": 4, "type": "discovery", "payload": {"filePath": "/tmp/file.csv", "discoveryJobId": "dj-4"}}],
        asyncio.CancelledError(),
    ]
    task = asyncio.create_task(process_jobs())
    try:
        await task
    except asyncio.CancelledError:
        pass
    mock_handle_discover.assert_awaited_once_with("dj-4", "/tmp/file.csv")
    mock_postgres.mark_discovery_job_status.assert_awaited_once_with("dj-4", "completed", {"created": 1})
    mock_postgres.mark_job_status.assert_awaited_once_with(4, "completed")


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
async def test_process_jobs_discovery_pipeline(mock_postgres):
    mock_postgres.get_pending_jobs.side_effect = [
        [{"id": 3, "type": "discovery_pipeline", "payload": {"pipelineId": "pipe-1", "discoveryJobId": "dj-1", "preview": {"stagedRecords": 2}}}],
        asyncio.CancelledError(),
    ]
    task = asyncio.create_task(process_jobs())
    try:
        await task
    except asyncio.CancelledError:
        pass
    mock_postgres.mark_discovery_job_status.assert_awaited_once_with(
        "dj-1",
        "completed",
        {"pipelineId": "pipe-1", "preview": {"stagedRecords": 2}, "mode": "pipeline"},
    )
    mock_postgres.mark_job_status.assert_awaited_once_with(3, "completed")


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
async def test_process_discovery_jobs_no_jobs(mock_postgres):
    mock_postgres.get_pending_discovery_jobs.return_value = []
    task = asyncio.create_task(process_discovery_jobs())
    await asyncio.sleep(0.1)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    mock_postgres.get_pending_discovery_jobs.assert_awaited()


@pytest.mark.asyncio
async def test_process_discovery_jobs_success(mock_postgres, mock_handle_discover):
    mock_postgres.get_pending_discovery_jobs.side_effect = [
        [{"id": "dj-1", "file_path": "/tmp/file.csv"}],
        asyncio.CancelledError(),
    ]
    task = asyncio.create_task(process_discovery_jobs())
    try:
        await task
    except asyncio.CancelledError:
        pass
    mock_handle_discover.assert_awaited_once_with("dj-1", "/tmp/file.csv")
    mock_postgres.mark_discovery_job_status.assert_awaited_once_with("dj-1", "completed", {"created": 1})


@pytest.mark.asyncio
async def test_process_discovery_jobs_handler_exception(mock_postgres, mock_handle_discover):
    mock_handle_discover.side_effect = Exception("discover boom")
    mock_postgres.get_pending_discovery_jobs.side_effect = [
        [{"id": "dj-2", "file_path": "/tmp/file.csv"}],
        asyncio.CancelledError(),
    ]
    task = asyncio.create_task(process_discovery_jobs())
    try:
        await task
    except asyncio.CancelledError:
        pass
    mock_postgres.mark_discovery_job_status.assert_awaited_once_with("dj-2", "failed", {"error": "discover boom"})


@pytest.mark.asyncio
async def test_process_discovery_jobs_handler_exception_with_pathlight(mock_postgres, mock_handle_discover):
    mock_handle_discover.side_effect = Exception("discover boom")
    mock_postgres.get_pending_discovery_jobs.side_effect = [
        [{"id": "dj-2", "file_path": "/tmp/file.csv"}],
        asyncio.CancelledError(),
    ]
    trace_mock = MagicMock()
    trace_mock.end = AsyncMock()
    pathlight_mock = MagicMock()
    pathlight_mock.trace = AsyncMock(return_value=trace_mock)
    task = asyncio.create_task(process_discovery_jobs(pathlight_mock))
    try:
        await task
    except asyncio.CancelledError:
        pass
    trace_mock.end.assert_awaited_once()


@pytest.mark.asyncio
async def test_process_discovery_jobs_poll_exception(mock_postgres):
    mock_postgres.get_pending_discovery_jobs.side_effect = Exception("db down")
    task = asyncio.create_task(process_discovery_jobs())
    await asyncio.sleep(0.1)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    mock_postgres.get_pending_discovery_jobs.assert_awaited()


@pytest.mark.asyncio
async def test_process_jobs_with_pathlight(mock_postgres, mock_handle_ingest):
    mock_postgres.get_pending_jobs.side_effect = [
        [{"id": 1, "type": "ingest_cmdb", "payload": {"items": []}}],
        asyncio.CancelledError(),
    ]
    trace_mock = MagicMock()
    trace_mock.end = AsyncMock()
    pathlight_mock = MagicMock()
    pathlight_mock.trace = AsyncMock(return_value=trace_mock)
    task = asyncio.create_task(process_jobs(pathlight_mock))
    try:
        await task
    except asyncio.CancelledError:
        pass
    trace_mock.end.assert_awaited_once()


@pytest.mark.asyncio
async def test_process_jobs_with_pathlight_failure(mock_postgres, mock_handle_ingest):
    mock_handle_ingest.side_effect = Exception("boom")
    mock_postgres.get_pending_jobs.side_effect = [
        [{"id": 1, "type": "ingest_cmdb", "payload": {}}],
        asyncio.CancelledError(),
    ]
    trace_mock = MagicMock()
    trace_mock.end = AsyncMock()
    pathlight_mock = MagicMock()
    pathlight_mock.trace = AsyncMock(return_value=trace_mock)
    task = asyncio.create_task(process_jobs(pathlight_mock))
    try:
        await task
    except asyncio.CancelledError:
        pass
    trace_mock.end.assert_awaited_once()


@pytest.mark.asyncio
async def test_process_discovery_jobs_with_pathlight(mock_postgres, mock_handle_discover):
    mock_postgres.get_pending_discovery_jobs.side_effect = [
        [{"id": "dj-1", "file_path": "/tmp/file.csv"}],
        asyncio.CancelledError(),
    ]
    trace_mock = MagicMock()
    trace_mock.end = AsyncMock()
    pathlight_mock = MagicMock()
    pathlight_mock.trace = AsyncMock(return_value=trace_mock)
    task = asyncio.create_task(process_discovery_jobs(pathlight_mock))
    try:
        await task
    except asyncio.CancelledError:
        pass
    trace_mock.end.assert_awaited_once()


@pytest.mark.asyncio
async def test_serve(mock_postgres):
    with patch("src.main.grpc_aio") as mock_grpc:
        mock_server = MagicMock()
        mock_grpc.server.return_value = mock_server
        mock_server.wait_for_termination = AsyncMock(side_effect=asyncio.CancelledError())
        mock_server.start = AsyncMock()

        task = asyncio.create_task(serve())
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        mock_postgres.connect.assert_awaited_once()
        mock_server.add_insecure_port.assert_called_once()
        mock_server.start.assert_awaited_once()
        mock_postgres.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_serve_with_pathlight(mock_postgres):
    with patch("src.main.grpc_aio") as mock_grpc:
        mock_server = MagicMock()
        mock_grpc.server.return_value = mock_server
        mock_server.wait_for_termination = AsyncMock(side_effect=asyncio.CancelledError())
        mock_server.start = AsyncMock()
        with patch.dict(os.environ, {"PATHLIGHT_URL": "http://localhost:4100"}):
            task = asyncio.create_task(serve())
            await asyncio.sleep(0.05)
            try:
                await task
            except asyncio.CancelledError:
                pass

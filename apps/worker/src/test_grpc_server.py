import pytest
from unittest.mock import MagicMock, AsyncMock, patch
import json

from src.grpc_server import WorkerServiceServicer


@pytest.fixture
def servicer():
    return WorkerServiceServicer()


class TestIngestCMDB:
    @pytest.mark.asyncio
    async def test_ingest_cmdb_success(self, servicer):
        with patch("src.grpc_server.handle_ingest_cmdb", new_callable=AsyncMock, return_value="completed") as mock_handler:
            request = MagicMock()
            request.job_id = "job-123"
            request.payload = json.dumps({"items": []}).encode("utf-8")
            context = MagicMock()

            response = await servicer.IngestCMDB(request, context)

            mock_handler.assert_awaited_once_with({"items": []})
            assert response.status == "completed"
            assert response.job_id == "job-123"
            assert response.message == "Processed"

    @pytest.mark.asyncio
    async def test_ingest_cmdb_failed(self, servicer):
        with patch("src.grpc_server.handle_ingest_cmdb", new_callable=AsyncMock, return_value="failed") as mock_handler:
            request = MagicMock()
            request.job_id = "job-456"
            request.payload = json.dumps({"items": [{"id": "1"}]}).encode("utf-8")
            context = MagicMock()

            response = await servicer.IngestCMDB(request, context)

            assert response.status == "failed"

    @pytest.mark.asyncio
    async def test_ingest_cmdb_with_pathlight_trace(self):
        trace = MagicMock()
        trace.end = AsyncMock()
        pathlight = MagicMock()
        pathlight.trace = AsyncMock(return_value=trace)
        servicer = WorkerServiceServicer(pathlight=pathlight)

        with patch("src.grpc_server.handle_ingest_cmdb", new_callable=AsyncMock, return_value="completed"):
            request = MagicMock()
            request.job_id = "job-trace"
            request.source = "api"
            request.payload = json.dumps({"items": []}).encode("utf-8")
            context = MagicMock()

            response = await servicer.IngestCMDB(request, context)

            assert response.status == "completed"
            pathlight.trace.assert_awaited_once_with("grpc-ingest-cmdb", input={"job_id": "job-trace", "source": "api"})
            trace.end.assert_awaited_once_with(output={"status": "completed"})

    @pytest.mark.asyncio
    async def test_ingest_cmdb_records_trace_failure(self):
        trace = MagicMock()
        trace.end = AsyncMock()
        pathlight = MagicMock()
        pathlight.trace = AsyncMock(return_value=trace)
        servicer = WorkerServiceServicer(pathlight=pathlight)

        with patch("src.grpc_server.handle_ingest_cmdb", new_callable=AsyncMock, side_effect=RuntimeError("boom")):
            request = MagicMock()
            request.job_id = "job-error"
            request.source = "api"
            request.payload = json.dumps({"items": []}).encode("utf-8")
            context = MagicMock()

            with pytest.raises(RuntimeError):
                await servicer.IngestCMDB(request, context)

            trace.end.assert_awaited_once_with(status="failed", error="boom")


class TestRunGraphMaintenance:
    @pytest.mark.asyncio
    async def test_run_graph_maintenance(self, servicer):
        request = MagicMock()
        context = MagicMock()
        response = await servicer.RunGraphMaintenance(request, context)
        assert response.status == "ok"

    @pytest.mark.asyncio
    async def test_run_graph_maintenance_with_pathlight_trace(self):
        trace = MagicMock()
        trace.end = AsyncMock()
        pathlight = MagicMock()
        pathlight.trace = AsyncMock(return_value=trace)
        servicer = WorkerServiceServicer(pathlight=pathlight)

        request = MagicMock()
        request.task = "refresh-health"
        context = MagicMock()

        response = await servicer.RunGraphMaintenance(request, context)

        assert response.status == "ok"
        pathlight.trace.assert_awaited_once_with("grpc-graph-maintenance", input={"task": "refresh-health"})
        trace.end.assert_awaited_once_with(output={"status": "ok"})

    @pytest.mark.asyncio
    async def test_run_graph_maintenance_records_trace_failure(self):
        trace = MagicMock()
        trace.end = AsyncMock(side_effect=[RuntimeError("trace down"), None])
        pathlight = MagicMock()
        pathlight.trace = AsyncMock(return_value=trace)
        servicer = WorkerServiceServicer(pathlight=pathlight)

        request = MagicMock()
        request.task = "refresh-health"
        context = MagicMock()

        with pytest.raises(RuntimeError):
            await servicer.RunGraphMaintenance(request, context)
        assert trace.end.await_count == 2

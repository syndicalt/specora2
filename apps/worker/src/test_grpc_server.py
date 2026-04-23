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


class TestRunGraphMaintenance:
    @pytest.mark.asyncio
    async def test_run_graph_maintenance(self, servicer):
        request = MagicMock()
        context = MagicMock()
        response = await servicer.RunGraphMaintenance(request, context)
        assert response.status == "ok"

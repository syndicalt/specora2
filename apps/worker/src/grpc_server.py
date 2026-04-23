import json
from typing import Any

from src.proto import itops_pb2
from src.proto import itops_pb2_grpc
from src.handlers.ingest_cmdb import handle_ingest_cmdb


class WorkerServiceServicer(itops_pb2_grpc.WorkerServiceServicer):
    def __init__(self, pathlight: Any | None = None):
        self._pathlight = pathlight

    async def IngestCMDB(self, request, context):
        payload_data = json.loads(request.payload.decode("utf-8"))
        trace = None
        if self._pathlight:
            trace = await self._pathlight.trace(
                "grpc-ingest-cmdb",
                input={"job_id": request.job_id, "source": request.source},
            )
        try:
            status = await handle_ingest_cmdb(payload_data)
            if trace:
                await trace.end(output={"status": status})
            return itops_pb2.IngestCMDBResponse(
                job_id=request.job_id,
                status=status,
                message="Processed",
            )
        except Exception as e:
            if trace:
                await trace.end(status="failed", error=str(e))
            raise

    async def RunGraphMaintenance(self, request, context):
        trace = None
        if self._pathlight:
            trace = await self._pathlight.trace(
                "grpc-graph-maintenance",
                input={"task": request.task},
            )
        try:
            if trace:
                await trace.end(output={"status": "ok"})
            return itops_pb2.GraphMaintenanceResponse(status="ok")
        except Exception as e:
            if trace:
                await trace.end(status="failed", error=str(e))
            raise

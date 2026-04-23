import json
from src.proto import itops_pb2
from src.proto import itops_pb2_grpc
from src.handlers.ingest_cmdb import handle_ingest_cmdb

class WorkerServiceServicer(itops_pb2_grpc.WorkerServiceServicer):
    async def IngestCMDB(self, request, context):
        payload_data = json.loads(request.payload.decode("utf-8"))
        status = await handle_ingest_cmdb(payload_data)
        return itops_pb2.IngestCMDBResponse(
            job_id=request.job_id,
            status=status,
            message="Processed"
        )

    async def RunGraphMaintenance(self, request, context):
        return itops_pb2.GraphMaintenanceResponse(status="ok")

import asyncio
import os
from grpc import aio as grpc_aio
from src.grpc_server import WorkerServiceServicer
from src.proto import itops_pb2_grpc
from src.db.postgres_client import postgres_client
from src.handlers.ingest_cmdb import handle_ingest_cmdb

GRPC_PORT = os.getenv("GRPC_PORT", "50051")
POLL_INTERVAL = float(os.getenv("JOB_POLL_INTERVAL", "5"))

async def process_jobs():
    await postgres_client.connect()
    print("Job processor started")
    while True:
        try:
            jobs = await postgres_client.get_pending_jobs(limit=10)
            for job in jobs:
                job_id = job["id"]
                job_type = job["type"]
                payload = job["payload"]
                print(f"Processing job {job_id} ({job_type})")
                try:
                    if job_type == "ingest_cmdb":
                        status = await handle_ingest_cmdb(payload)
                    else:
                        print(f"Unknown job type: {job_type}")
                        status = "failed"
                    await postgres_client.mark_job_status(job_id, status)
                except Exception as e:
                    print(f"Job {job_id} failed: {e}")
                    await postgres_client.mark_job_status(job_id, "failed")
        except Exception as e:
            print(f"Job poll error: {e}")
        await asyncio.sleep(POLL_INTERVAL)

async def serve():
    server = grpc_aio.server()
    itops_pb2_grpc.add_WorkerServiceServicer_to_server(WorkerServiceServicer(), server)
    server.add_insecure_port(f"[::]:{GRPC_PORT}")
    await server.start()
    print(f"Worker gRPC server started on port {GRPC_PORT}")

    # Start background job processor
    job_task = asyncio.create_task(process_jobs())

    try:
        await server.wait_for_termination()
    finally:
        job_task.cancel()
        await postgres_client.close()

if __name__ == "__main__":  # pragma: no cover
    asyncio.run(serve())

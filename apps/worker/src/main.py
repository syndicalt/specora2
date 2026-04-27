import asyncio
import os
from grpc import aio as grpc_aio
from src.grpc_server import WorkerServiceServicer
from src.proto import itops_pb2_grpc
from src.db.postgres_client import postgres_client
from src.handlers.ingest_cmdb import handle_ingest_cmdb
from src.handlers.discover_file import handle_discover_file

GRPC_PORT = os.getenv("GRPC_PORT", "50051")
POLL_INTERVAL = float(os.getenv("JOB_POLL_INTERVAL", "5"))
TRACE_TIMEOUT = float(os.getenv("PATHLIGHT_TRACE_TIMEOUT", "2"))


async def start_trace(pathlight, name, input_data):
    if not pathlight:
        return None
    try:
        return await asyncio.wait_for(
            pathlight.trace(name, input=input_data),
            timeout=TRACE_TIMEOUT,
        )
    except Exception as e:
        print(f"Pathlight trace start skipped: {e}")
        return None


async def end_trace(trace, output):
    if not trace:
        return
    try:
        await asyncio.wait_for(trace.end(output=output), timeout=TRACE_TIMEOUT)
    except Exception as e:
        print(f"Pathlight trace end skipped: {e}")


async def process_jobs(pathlight=None):
    print("Job processor started")
    while True:
        try:
            jobs = await postgres_client.get_pending_jobs(limit=10)
            for job in jobs:
                job_id = job["id"]
                job_type = job["type"]
                payload = job["payload"]
                print(f"Processing job {job_id} ({job_type})")
                trace = await start_trace(pathlight, "process-job", {"job_id": job_id, "type": job_type})
                try:
                    if job_type == "ingest_cmdb":
                        status = await handle_ingest_cmdb(payload)
                    elif job_type == "discovery":
                        file_path = payload.get("filePath") or payload.get("file_path")
                        discovery_job_id = payload.get("discoveryJobId")
                        if file_path:
                            stats = await handle_discover_file(discovery_job_id, file_path)
                            await postgres_client.mark_discovery_job_status(discovery_job_id, "completed", stats)
                        status = "completed"
                    elif job_type == "discovery_pipeline":
                        discovery_job_id = payload.get("discoveryJobId")
                        stats = {
                            "pipelineId": payload.get("pipelineId"),
                            "preview": payload.get("preview", {}),
                            "mode": "pipeline",
                        }
                        if discovery_job_id:
                            await postgres_client.mark_discovery_job_status(discovery_job_id, "completed", stats)
                        status = "completed"
                    else:
                        print(f"Unknown job type: {job_type}")
                        status = "failed"
                    await postgres_client.mark_job_status(job_id, status)
                    await end_trace(trace, {"status": status})
                except Exception as e:
                    print(f"Job {job_id} failed: {e}")
                    await end_trace(trace, {"status": "failed", "error": str(e)})
                    await postgres_client.mark_job_status(job_id, "failed")
        except Exception as e:
            print(f"Job poll error: {e}")
        await asyncio.sleep(POLL_INTERVAL)


async def process_discovery_jobs(pathlight=None):
    print("Discovery job processor started")
    while True:
        try:
            jobs = await postgres_client.get_pending_discovery_jobs(limit=10)
            for job in jobs:
                job_id = job["id"]
                file_path = job["file_path"]
                print(f"Processing discovery job {job_id}")
                trace = await start_trace(pathlight, "discover-file", {"job_id": job_id, "file_path": file_path})
                try:
                    stats = await handle_discover_file(job_id, file_path)
                    await postgres_client.mark_discovery_job_status(job_id, "completed", stats)
                    await end_trace(trace, {"stats": stats})
                except Exception as e:
                    print(f"Discovery job {job_id} failed: {e}")
                    await end_trace(trace, {"status": "failed", "error": str(e)})
                    await postgres_client.mark_discovery_job_status(job_id, "failed", {"error": str(e)})
        except Exception as e:
            print(f"Discovery job poll error: {e}")
        await asyncio.sleep(POLL_INTERVAL)

async def serve():
    await postgres_client.connect()
    server = grpc_aio.server()

    pathlight = None
    pathlight_url = os.getenv("PATHLIGHT_URL")
    if pathlight_url:
        from pathlight import AsyncPathlight
        pathlight = AsyncPathlight(base_url=pathlight_url)
        print(f"Pathlight tracing enabled: {pathlight_url}")

    itops_pb2_grpc.add_WorkerServiceServicer_to_server(
        WorkerServiceServicer(pathlight=pathlight), server
    )
    server.add_insecure_port(f"[::]:{GRPC_PORT}")
    await server.start()
    print(f"Worker gRPC server started on port {GRPC_PORT}")

    # Start background job processors
    job_task = asyncio.create_task(process_jobs(pathlight))
    discovery_task = asyncio.create_task(process_discovery_jobs(pathlight))

    try:
        await server.wait_for_termination()
    finally:
        job_task.cancel()
        discovery_task.cancel()
        if pathlight:
            await pathlight.close()
        await postgres_client.close()

if __name__ == "__main__":  # pragma: no cover
    asyncio.run(serve())

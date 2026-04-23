import sys
import types
from unittest.mock import MagicMock

# Prevent heavy imports from loading real implementations during tests
sys.modules["grpc"] = MagicMock()
sys.modules["grpc.aio"] = MagicMock()
sys.modules["neo4j"] = MagicMock()
sys.modules["neo4j.GraphDatabase"] = MagicMock()
sys.modules["asyncpg"] = MagicMock()

# Set up proto modules as real module objects so imports resolve consistently
proto = types.ModuleType("src.proto")
sys.modules["src.proto"] = proto

itops_pb2 = types.ModuleType("src.proto.itops_pb2")
proto.itops_pb2 = itops_pb2
sys.modules["src.proto.itops_pb2"] = itops_pb2

itops_pb2_grpc = types.ModuleType("src.proto.itops_pb2_grpc")
proto.itops_pb2_grpc = itops_pb2_grpc
sys.modules["src.proto.itops_pb2_grpc"] = itops_pb2_grpc

class FakeWorkerServiceServicer:
    pass

itops_pb2_grpc.WorkerServiceServicer = FakeWorkerServiceServicer

def add_WorkerServiceServicer_to_server(servicer, server):
    pass

itops_pb2_grpc.add_WorkerServiceServicer_to_server = add_WorkerServiceServicer_to_server

class IngestCMDBResponse:
    def __init__(self, job_id, status, message):
        self.job_id = job_id
        self.status = status
        self.message = message

class GraphMaintenanceResponse:
    def __init__(self, status):
        self.status = status

itops_pb2.IngestCMDBResponse = IngestCMDBResponse
itops_pb2.GraphMaintenanceResponse = GraphMaintenanceResponse

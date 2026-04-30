import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { join } from "path";
import { promisify } from "util";

const PROTO_PATH = join(__dirname, "..", "..", "..", "..", "packages", "protobuf", "itops.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

type WorkerServiceClient = {
  IngestCMDB: grpc.requestCallback<Buffer>;
  RunGraphMaintenance: grpc.requestCallback<{ task: string }>;
};

type WorkerServiceConstructor = new (
  address: string,
  credentials: grpc.ChannelCredentials
) => WorkerServiceClient;

const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
  itops: { WorkerService: WorkerServiceConstructor };
};

const target = process.env.WORKER_GRPC_HOST || "localhost:50051";

const client = new proto.itops.WorkerService(target, grpc.credentials.createInsecure());

export const workerClient = {
  ingestCMDB: promisify(client.IngestCMDB.bind(client)) as unknown as (
    request: { job_id: string; source: string; payload: Buffer }
  ) => Promise<{ job_id: string; status: string; message: string }>,
  runGraphMaintenance: promisify(client.RunGraphMaintenance.bind(client)) as unknown as (
    request: { task: string }
  ) => Promise<{ status: string }>,
};

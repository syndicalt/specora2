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

const proto = grpc.loadPackageDefinition(packageDefinition) as any;

const target = process.env.WORKER_GRPC_HOST || "localhost:50051";

const client = new proto.itops.WorkerService(target, grpc.credentials.createInsecure());

export const workerClient = {
  ingestCMDB: promisify(client.IngestCMDB.bind(client)) as (
    request: { job_id: string; source: string; payload: Buffer }
  ) => Promise<{ job_id: string; status: string; message: string }>,
  runGraphMaintenance: promisify(client.RunGraphMaintenance.bind(client)) as (
    request: { task: string }
  ) => Promise<{ status: string }>,
};

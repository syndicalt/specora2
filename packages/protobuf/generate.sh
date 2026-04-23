#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Generate Python stubs for worker
python3 -m grpc_tools.protoc \
  -I. \
  --python_out=../../apps/worker/src/proto \
  --grpc_python_out=../../apps/worker/src/proto \
  ./itops.proto

echo "Proto generation complete."

FROM python:3.12-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

COPY apps/worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/worker/src ./src
COPY packages/protobuf/itops.proto ./proto/itops.proto

ENV PYTHONPATH=/app/src
CMD ["python", "-m", "src.main"]

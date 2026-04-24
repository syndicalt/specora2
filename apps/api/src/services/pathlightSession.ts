interface PathlightClient {
  _createTrace(data: Record<string, unknown>): Promise<any>;
  _updateTrace(id: string, data: Record<string, unknown>): Promise<any>;
  _createSpan(data: Record<string, unknown>): Promise<any>;
  _updateSpan(id: string, data: Record<string, unknown>): Promise<any>;
}

/**
 * A lightweight trace wrapper that supports resuming an existing trace by ID.
 * This is needed because Pathlight's native Trace class always creates a new trace.
 */
export class SessionTrace {
  private client: PathlightClient;
  private _id: string;
  private _startTime: number;

  constructor(client: PathlightClient, id: string, _name: string) {
    this.client = client;
    this._id = id;
    this._startTime = Date.now();
  }

  get id(): string {
    return this._id;
  }

  static async create(client: PathlightClient, name: string, input?: unknown, options?: { tags?: string[]; metadata?: unknown }): Promise<SessionTrace> {
    const result = await client._createTrace({
      name,
      input,
      tags: options?.tags,
      metadata: options?.metadata,
    });
    return new SessionTrace(client, result.id, name);
  }

  span(name: string, type: "llm" | "tool" | "retrieval" | "agent" | "chain" | "custom", options?: {
    parentSpanId?: string;
    model?: string;
    provider?: string;
    toolName?: string;
    toolArgs?: unknown;
    input?: unknown;
    metadata?: unknown;
  }): SessionSpan {
    return new SessionSpan(this.client, this._id, name, type, options);
  }

  async end(data?: { output?: unknown; status?: "completed" | "failed"; error?: string }): Promise<void> {
    const durationMs = Date.now() - this._startTime;
    await this.client._updateTrace(this._id, {
      status: data?.status || (data?.error ? "failed" : "completed"),
      output: data?.output,
      error: data?.error,
      totalDurationMs: durationMs,
    });
  }
}

export class SessionSpan {
  private client: PathlightClient;
  private traceId: string;
  private _id: string | null = null;
  private _startTime: number;
  private _initPromise: Promise<void>;

  constructor(
    client: PathlightClient,
    traceId: string,
    name: string,
    type: "llm" | "tool" | "retrieval" | "agent" | "chain" | "custom",
    options?: {
      parentSpanId?: string;
      model?: string;
      provider?: string;
      toolName?: string;
      toolArgs?: unknown;
      input?: unknown;
      metadata?: unknown;
    }
  ) {
    this.client = client;
    this.traceId = traceId;
    this._startTime = Date.now();
    this._initPromise = this._init(name, type, options);
  }

  private async _init(name: string, type: string, options?: any): Promise<void> {
    const result = await this.client._createSpan({
      traceId: this.traceId,
      name,
      type,
      ...options,
    });
    this._id = result.id;
  }

  get id(): Promise<string> {
    return this._initPromise.then(() => this._id!);
  }

  async end(data?: {
    status?: "completed" | "failed";
    error?: string;
    output?: unknown;
    toolResult?: unknown;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
  }): Promise<void> {
    await this._initPromise;
    const durationMs = Date.now() - this._startTime;
    await this.client._updateSpan(this._id!, {
      status: data?.status || (data?.error ? "failed" : "completed"),
      output: data?.output,
      error: data?.error,
      durationMs,
      inputTokens: data?.inputTokens,
      outputTokens: data?.outputTokens,
      cost: data?.cost,
      toolResult: data?.toolResult,
    });
  }
}

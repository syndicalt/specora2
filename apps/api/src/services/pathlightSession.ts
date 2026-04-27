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
    try {
      const result = await client._createTrace({
        name,
        input,
        tags: options?.tags,
        metadata: options?.metadata,
      });
      return new SessionTrace(client, result.id, name);
    } catch {
      return new SessionTrace(client, `local-${Date.now()}-${Math.random().toString(16).slice(2)}`, name);
    }
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
    if (this._id.startsWith("local-")) return;
    try {
      await this.client._updateTrace(this._id, {
        status: data?.status || (data?.error ? "failed" : "completed"),
        output: data?.output,
        error: data?.error,
        totalDurationMs: durationMs,
      });
    } catch {
      // Tracing is best-effort and must never break the product path.
    }
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
    if (this.traceId.startsWith("local-")) return;
    try {
      const result = await this.client._createSpan({
        traceId: this.traceId,
        name,
        type,
        ...options,
      });
      this._id = result.id;
    } catch {
      this._id = null;
    }
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
    if (!this._id) return;
    const durationMs = Date.now() - this._startTime;
    try {
      await this.client._updateSpan(this._id, {
        status: data?.status || (data?.error ? "failed" : "completed"),
        output: data?.output,
        error: data?.error,
        durationMs,
        inputTokens: data?.inputTokens,
        outputTokens: data?.outputTokens,
        cost: data?.cost,
        toolResult: data?.toolResult,
      });
    } catch {
      // Tracing is best-effort and must never break the product path.
    }
  }
}

import OpenAI from "openai";
import { FastifyInstance } from "fastify";
import { getProvaraConfig } from "./chat";

export type IntakeRouteId = "knowledge" | "catalog_request" | "incident" | "support_handoff" | "clarify";

export type IntakeRoute = {
  id: IntakeRouteId;
  label: string;
  endpoint: string;
  description: string;
  autoRoutable: boolean;
};

export type RouteScore = {
  route: IntakeRouteId;
  probability: number;
  rationale: string;
  missingFields?: string[];
};

export type RouteDecision = {
  routes: IntakeRoute[];
  scores: RouteScore[];
  winner: RouteScore;
  autoRoute: boolean;
  provider: "provara" | "openai" | "heuristic";
};

const AUTO_ROUTE_MIN_PROBABILITY = 0.78;
const AUTO_ROUTE_MIN_MARGIN = 0.16;

export const INTAKE_ROUTES: IntakeRoute[] = [
  {
    id: "knowledge",
    label: "Deflect with Knowledge",
    endpoint: "knowledge-core_answer",
    description: "Use governed knowledge when the user asks how-to, policy, guidance, or a known fix question.",
    autoRoutable: true,
  },
  {
    id: "catalog_request",
    label: "Create Catalog Request",
    endpoint: "customer-portal_submit_request",
    description: "Create a request for access, software, hardware, procurement, approvals, onboarding, or planned service fulfillment.",
    autoRoutable: true,
  },
  {
    id: "incident",
    label: "Create Incident",
    endpoint: "incident-manager_create_incident",
    description: "Create an incident when something is broken, unavailable, degraded, risky, urgent, or actively impacting work.",
    autoRoutable: true,
  },
  {
    id: "support_handoff",
    label: "Request Support Handoff",
    endpoint: "customer-portal_request_support_handoff",
    description: "Escalate to live chat, callback, or phone routing when confidence is low, urgency is high, or the user asks for a person.",
    autoRoutable: true,
  },
  {
    id: "clarify",
    label: "Ask Clarifying Question",
    endpoint: "customer-portal_resolve_intent",
    description: "Ask one focused question when no route has enough confidence or required inputs are missing.",
    autoRoutable: false,
  },
];

const ROUTE_IDS = INTAKE_ROUTES.map((route) => route.id);
const ROUTE_ID_SET = new Set<string>(ROUTE_IDS);

function clampProbability(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function resolveRouteId(rawRoute: unknown, rationale?: unknown): IntakeRouteId | null {
  const routeText = String(rawRoute || "").trim();
  if (ROUTE_ID_SET.has(routeText)) return routeText as IntakeRouteId;
  const rationaleText = String(rationale || "").toLowerCase();
  const combined = `${routeText} ${rationaleText}`.toLowerCase();
  const mentions = ROUTE_IDS.filter((route) => new RegExp(`\\b${route.replace("_", "[_ -]?")}\\b`).test(combined));
  if (mentions.length === 1) return mentions[0];
  for (const route of ROUTE_IDS) {
    if (rationaleText.includes(route.replace("_", " "))) return route;
  }
  return null;
}

type RawRouteScore = {
  route?: unknown;
  probability?: unknown;
  rationale?: unknown;
  missingFields?: unknown;
};

function normalizeScores(scores: RawRouteScore[]): RouteScore[] {
  const byRoute = new Map<IntakeRouteId, RouteScore>();
  for (const route of INTAKE_ROUTES) {
    byRoute.set(route.id, { route: route.id, probability: 0.02, rationale: "Not selected by classifier." });
  }
  for (const score of scores) {
    const routeId = resolveRouteId(score?.route, score?.rationale);
    if (!routeId) continue;
    byRoute.set(routeId, {
      route: routeId,
      probability: clampProbability(score.probability),
      rationale: String(score.rationale || "Classifier score."),
      missingFields: Array.isArray(score.missingFields) ? score.missingFields.map(String) : [],
    });
  }
  return Array.from(byRoute.values()).sort((a, b) => b.probability - a.probability);
}

function heuristicScores(message: string, urgency?: string): RouteScore[] {
  const text = message.toLowerCase();
  const incident = /can't|cannot|down|broken|error|issue|outage|slow|latency|not working|failed|degraded|unavailable/.test(text);
  const access = /access|permission|role|login|entitlement|unlock|password/.test(text);
  const request = /laptop|monitor|keyboard|mouse|hardware|device|software|license|install|application|request|need|provision/.test(text);
  const knowledge = /how do|how can|what is|where is|policy|guide|runbook|instructions|docs/.test(text);
  const support = /call|phone|human|agent|representative|help desk|callback|talk to/.test(text);
  const highUrgency = urgency === "critical" || urgency === "high";

  return normalizeScores([
    {
      route: "incident",
      probability: incident ? (highUrgency ? 0.9 : 0.82) : 0.08,
      rationale: incident ? "Language indicates a broken or degraded service." : "No clear break/fix signal.",
    },
    {
      route: "catalog_request",
      probability: !incident && (access || request) ? 0.84 : access || request ? 0.42 : 0.12,
      rationale: access || request ? "Language indicates planned fulfillment or access." : "No clear fulfillment signal.",
    },
    {
      route: "knowledge",
      probability: knowledge ? 0.82 : 0.14,
      rationale: knowledge ? "Language indicates a how-to or policy question." : "Not primarily a knowledge question.",
    },
    {
      route: "support_handoff",
      probability: support ? 0.8 : incident && highUrgency ? 0.62 : 0.08,
      rationale: support ? "User asked for human or phone support." : "No explicit handoff request.",
    },
    {
      route: "clarify",
      probability: incident || access || request || knowledge || support ? 0.1 : 0.64,
      rationale: "Used when route confidence is insufficient.",
    },
  ]);
}

function parseJsonObject(text: string): { scores?: RawRouteScore[] } {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response did not contain JSON");
    return JSON.parse(match[0]);
  }
}

async function scoreWithProvara(message: string, urgency?: string): Promise<RouteScore[] | null> {
  const config = getProvaraConfig();
  if (!config) return null;
  const baseUrl = config.url.replace(/\/?v1\/?$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.key}`,
  };
  if (config.tenantId) headers["X-Tenant-ID"] = config.tenantId;
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.PORTAL_ROUTING_PROVARA_MODEL || process.env.PROVARA_MODEL || "provara-router",
      temperature: 0.05,
      requires_structured_output: true,
      messages: buildRoutingMessages(message, urgency),
    }),
  });
  if (!response.ok) throw new Error(`Provara routing error ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content || "{}";
  return normalizeScores(parseJsonObject(content).scores || []);
}

async function scoreWithOpenAI(message: string, urgency?: string): Promise<RouteScore[] | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: process.env.PORTAL_ROUTING_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4o",
    temperature: 0.05,
    messages: buildRoutingMessages(message, urgency),
  });
  const content = completion.choices[0]?.message?.content || "{}";
  return normalizeScores(parseJsonObject(content).scores || []);
}

function buildRoutingMessages(message: string, urgency?: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content: `You are Specora's intake router. Score every route as a probability from 0 to 1.
Return JSON only. The "route" field MUST be exactly one concrete route id, never a union or pipe-delimited list.
Valid route ids: ${ROUTE_IDS.join(", ")}
Example shape: {"scores":[{"route":"incident","probability":0.9,"rationale":"short","missingFields":[]},{"route":"catalog_request","probability":0.1,"rationale":"short","missingFields":[]}]}
Routes:
${INTAKE_ROUTES.map((route) => `- ${route.id}: endpoint=${route.endpoint}; ${route.description}`).join("\n")}
Prefer incident for broken/degraded/unavailable services. Prefer catalog_request for planned fulfillment. Prefer knowledge for how-to/policy. Prefer support_handoff when the user asks for human/call support or urgency is high. Prefer clarify when signals are ambiguous.`,
    },
    { role: "user", content: JSON.stringify({ message, urgency: urgency || "medium" }) },
  ];
}

export async function scoreIntakeRoutes(
  _fastify: FastifyInstance,
  input: { message: string; urgency?: string; forceHeuristic?: boolean }
): Promise<RouteDecision> {
  let provider: RouteDecision["provider"] = "heuristic";
  let scores: RouteScore[] | null = null;

  if (!input.forceHeuristic && process.env.NODE_ENV !== "test") {
    try {
      scores = await scoreWithProvara(input.message, input.urgency);
      if (scores) provider = "provara";
    } catch {
      scores = null;
    }
    if (!scores) {
      try {
        scores = await scoreWithOpenAI(input.message, input.urgency);
        if (scores) provider = "openai";
      } catch {
        scores = null;
      }
    }
  }

  const normalized = normalizeScores(scores || heuristicScores(input.message, input.urgency));
  const winner = normalized[0];
  const runnerUp = normalized[1];
  const route = INTAKE_ROUTES.find((candidate) => candidate.id === winner.route);
  const autoRoute = !!route?.autoRoutable
    && winner.probability >= AUTO_ROUTE_MIN_PROBABILITY
    && winner.probability - (runnerUp?.probability || 0) >= AUTO_ROUTE_MIN_MARGIN;

  return { routes: INTAKE_ROUTES, scores: normalized, winner, autoRoute, provider };
}

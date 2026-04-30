import OpenAI from "openai";
import type { FastifyInstance } from "fastify";
import type { Record as Neo4jRecord } from "neo4j-driver";

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function getProvaraConfig(): { url: string; key: string } | null {
  const url = process.env.PROVARA_URL;
  const key = process.env.PROVARA_API_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function callLlm(prompt: string): Promise<string> {
  const openai = getOpenAI();
  const provara = getProvaraConfig();

  if (!openai && !provara) {
    throw new Error("No LLM configured");
  }

  const systemPrompt = `You are a Neo4j Cypher expert specializing in CMDB (Configuration Management Database) validation.
You analyze graph topologies and suggest Cypher queries to find structural anomalies.

Rules for your responses:
1. ONLY return valid Cypher queries - no explanations, no markdown
2. Each query should find CIs that violate a structural pattern
3. Queries must return: ciId, ciName, ciClass
4. Use only these relationship types: PART_OF, DEPENDS_ON, HOSTED_ON, MANAGED_BY, OWNED_BY, LOCATED_AT
5. Use only these CI classes: BusinessService, ApplicationService, TechnicalService, Server, Database, Application, NetworkGear, User, Group, Location
6. Return exactly 3 queries, separated by ---\n`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: prompt },
  ];

  if (provara) {
    const baseUrl = provara.url.replace(/\/?v1\/?$/, "");
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provara.key}`,
      },
      body: JSON.stringify({
        model: "provara-router",
        messages,
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      throw new Error(`Provara error ${response.status}`);
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || "";
  }

  const completion = await openai!.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.2,
  });

  return completion.choices[0].message.content || "";
}

export interface GeneratedRule {
  name: string;
  cypher: string;
  explanation: string;
}

export async function generateRules(fastify: FastifyInstance): Promise<GeneratedRule[]> {
  const session = fastify.neo4j.session();
  let graphSample: string;

  try {
    const classResult = await session.run(
      `MATCH (n:ConfigurationItem) RETURN n.class as class, count(n) as count ORDER BY count DESC`
    );
    const classDist = classResult.records.map((r: Neo4jRecord) => ({
      class: r.get("class"),
      count: r.get("count").toNumber(),
    }));

    const relResult = await session.run(
      `MATCH (a)-[r]->(b)
       RETURN a.class as fromClass, type(r) as relType, b.class as toClass, count(*) as count
       ORDER BY count DESC LIMIT 20`
    );
    const relPatterns = relResult.records.map((r: Neo4jRecord) => ({
      from: r.get("fromClass"),
      rel: r.get("relType"),
      to: r.get("toClass"),
      count: r.get("count").toNumber(),
    }));

    const sampleResult = await session.run(
      `MATCH (n:ConfigurationItem)
       RETURN n.class as class, n.name as name, n.id as id
       LIMIT 30`
    );
    const samples = sampleResult.records.map((r: Neo4jRecord) => ({
      class: r.get("class"),
      name: r.get("name"),
      id: r.get("id"),
    }));

    graphSample = [
      `Class distribution: ${JSON.stringify(classDist)}`,
      `Relationship patterns: ${JSON.stringify(relPatterns)}`,
      `Sample nodes: ${JSON.stringify(samples)}`,
    ].join("\n\n");
  } finally {
    await session.close();
  }

  const prompt = [
    "Analyze this CMDB graph sample and suggest 3 Cypher queries to find structural completeness issues or anomalies.",
    "",
    graphSample,
    "",
    "For each query, provide:",
    "- A short name (1 line)",
    "- The Cypher query (must return ciId, ciName, ciClass)",
    "- A brief explanation of what anomaly it detects",
    "",
    "Format each rule as:",
    "NAME: <name>",
    "CYPHER:",
    "<query>",
    "EXPLANATION: <explanation>",
    "",
    "Separate rules with ---",
  ].join("\n");

  const response = await callLlm(prompt);

  const rules: GeneratedRule[] = [];
  const sections = response.split(/---+/).map((s) => s.trim()).filter(Boolean);

  for (const section of sections) {
    const nameMatch = section.match(/NAME:\s*(.+)/i);
    const cypherMatch = section.match(/CYPHER:\s*\n?([\s\S]+?)(?=EXPLANATION:|$)/i);
    const explanationMatch = section.match(/EXPLANATION:\s*(.+)/i);

    if (nameMatch && cypherMatch) {
      rules.push({
        name: nameMatch[1].trim(),
        cypher: cypherMatch[1].trim(),
        explanation: explanationMatch ? explanationMatch[1].trim() : "",
      });
    }
  }

  return rules;
}

export async function executeGeneratedRule(
  fastify: FastifyInstance,
  cypher: string
): Promise<Array<{ ciId: string; ciName: string; ciClass: string }>> {
  const session = fastify.neo4j.session();
  try {
    const normalized = cypher.trim().toUpperCase();
    if (!normalized.startsWith("MATCH")) {
      throw new Error("Only MATCH queries are allowed");
    }
    if (normalized.includes("DELETE") || normalized.includes("CREATE") || normalized.includes("SET")) {
      throw new Error("Mutating queries are not allowed");
    }

    const result = await session.run(cypher);
    return result.records.map((r: Neo4jRecord) => ({
      ciId: r.get("ciId"),
      ciName: r.get("ciName"),
      ciClass: r.get("ciClass"),
    }));
  } finally {
    await session.close();
  }
}

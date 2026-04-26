import { FastifyInstance } from "fastify";
import { registerTool } from "@specora/sdk";
import { emit } from "../eventBus";
import { assignRecordNumberToRow } from "../numberSequences";

export function registerAssetCommandTools() {
function assetConfidence(parts: Array<unknown>) {
  const present = parts.filter((part) => part !== undefined && part !== null && String(part).trim() !== "").length;
  return Math.round(Math.min(0.96, 0.35 + present * 0.1) * 100) / 100;
}

function normalizeSoftware(value?: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/microsoft corporation|inc\.?|llc|software|edition|license/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

registerTool<FastifyInstance>("asset-command", {
  name: "create_asset",
  description: "Create or upsert an evidence-backed hardware, software, cloud, or financial asset record.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      category: { type: "string", enum: ["hardware", "software", "cloud", "contract", "consumable"] },
      assetType: { type: "string" },
      assetTag: { type: "string" },
      serialNumber: { type: "string" },
      manufacturer: { type: "string" },
      model: { type: "string" },
      location: { type: "string" },
      ciId: { type: "string" },
      cost: { type: "number" },
      purchaseOrder: { type: "string" },
      invoiceRef: { type: "string" },
    },
    required: ["name"],
  },
}, async (args, fastify) => {
  const a = args as any;
  const confidence = assetConfidence([a.assetTag, a.serialNumber, a.manufacturer, a.model, a.ciId, a.purchaseOrder]);
  const result = await fastify.pg.query(
    `INSERT INTO asset_records (name, category, asset_type, asset_tag, serial_number, manufacturer, model, location, ci_id, cost, purchase_order, invoice_ref, confidence, evidence_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
     ON CONFLICT (serial_number) DO UPDATE SET
       name = EXCLUDED.name,
       manufacturer = COALESCE(EXCLUDED.manufacturer, asset_records.manufacturer),
       model = COALESCE(EXCLUDED.model, asset_records.model),
       location = COALESCE(EXCLUDED.location, asset_records.location),
       ci_id = COALESCE(EXCLUDED.ci_id, asset_records.ci_id),
       confidence = GREATEST(asset_records.confidence, EXCLUDED.confidence),
       updated_at = NOW()
     RETURNING *`,
    [a.name, a.category || "hardware", a.assetType || "device", a.assetTag || null, a.serialNumber || null, a.manufacturer || null, a.model || null, a.location || null, a.ciId || null, a.cost || null, a.purchaseOrder || null, a.invoiceRef || null, confidence]
  );
  const asset = await assignRecordNumberToRow(fastify, "asset_records", result.rows[0]);
  await fastify.pg.query(
    `INSERT INTO asset_evidence (asset_id, evidence_type, source, source_ref, payload, confidence) VALUES ($1, 'asset.create', $2, $3, $4, $5)`,
    [asset.id, a.source || "manual", a.sourceRef || null, JSON.stringify(a), confidence]
  );
  emit("asset.created", { assetId: asset.id, name: asset.name, category: asset.category });
  return asset;
});

registerTool<FastifyInstance>("asset-command", {
  name: "list_assets",
  description: "List assets with optional category, status, lifecycle, CI, or location filters.",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string" },
      status: { type: "string" },
      lifecycleState: { type: "string" },
      ciId: { type: "string" },
      location: { type: "string" },
      limit: { type: "integer" },
    },
  },
}, async (args, fastify) => {
  const { category, status, lifecycleState, ciId, location, limit = 100 } = args as any;
  const params: any[] = [];
  let sql = `SELECT * FROM asset_records WHERE 1=1`;
  if (category) { params.push(category); sql += ` AND category = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  if (lifecycleState) { params.push(lifecycleState); sql += ` AND lifecycle_state = $${params.length}`; }
  if (ciId) { params.push(ciId); sql += ` AND ci_id = $${params.length}`; }
  if (location) { params.push(location); sql += ` AND location = $${params.length}`; }
  params.push(Math.min(Number(limit) || 100, 250));
  sql += ` ORDER BY status = 'inbox' DESC, evidence_score ASC, updated_at DESC LIMIT $${params.length}`;
  const result = await fastify.pg.query(sql, params);
  return result.rows;
});

registerTool<FastifyInstance>("asset-command", {
  name: "get_asset_details",
  description: "Get asset details with evidence, scan history, software usage, and open exceptions.",
  parameters: {
    type: "object",
    properties: { assetId: { type: "string" } },
    required: ["assetId"],
  },
}, async (args, fastify) => {
  const { assetId } = args as any;
  const assetResult = await fastify.pg.query(`SELECT * FROM asset_records WHERE id = $1`, [assetId]);
  if (!assetResult.rows.length) return { error: "Asset not found" };
  const [evidence, scans, usage, exceptions] = await Promise.all([
    fastify.pg.query(`SELECT * FROM asset_evidence WHERE asset_id = $1 ORDER BY created_at DESC LIMIT 50`, [assetId]),
    fastify.pg.query(`SELECT * FROM asset_scan_events WHERE asset_id = $1 ORDER BY created_at DESC LIMIT 50`, [assetId]),
    fastify.pg.query(`SELECT * FROM software_usage WHERE asset_id = $1 ORDER BY last_seen_at DESC LIMIT 50`, [assetId]),
    fastify.pg.query(`SELECT * FROM asset_exceptions WHERE asset_id = $1 AND status = 'open' ORDER BY severity, created_at DESC`, [assetId]),
  ]);
  return { ...assetResult.rows[0], evidence: evidence.rows, scans: scans.rows, usage: usage.rows, exceptions: exceptions.rows };
});

registerTool<FastifyInstance>("asset-command", {
  name: "ingest_procurement",
  description: "Ingest purchase order, invoice, receiving, or procurement system payloads and create expected asset or entitlement candidates.",
  parameters: {
    type: "object",
    properties: {
      source: { type: "string" },
      externalRef: { type: "string" },
      vendor: { type: "string" },
      purchaseOrder: { type: "string" },
      items: { type: "array", items: { type: "object", properties: {} } },
    },
  },
}, async (args, fastify) => {
  const { source = "procurement", externalRef, vendor, purchaseOrder, items = [] } = args as any;
  const created = [];
  for (const item of Array.isArray(items) ? items : []) {
    const isSoftware = String(item.category || item.type || "").toLowerCase().includes("software") || item.publisher;
    if (isSoftware) {
      const contract = await fastify.pg.query(
        `INSERT INTO asset_contracts (name, vendor, contract_type, source, source_ref, extracted_summary, ai_confidence)
         VALUES ($1, $2, 'software', $3, $4, $5, 0.55) RETURNING *`,
        [item.contractName || `${vendor || item.publisher || "Vendor"} procurement`, vendor || item.publisher || null, source, externalRef || purchaseOrder || null, item.description || null]
      );
      const ent = await fastify.pg.query(
        `INSERT INTO software_entitlements (contract_id, publisher, product, sku, metric, quantity, confidence, source_citation)
         VALUES ($1, $2, $3, $4, $5, $6, 0.55, $7) RETURNING *`,
        [contract.rows[0].id, item.publisher || vendor || "Unknown", item.product || item.name || "Unknown software", item.sku || null, item.metric || "user", item.quantity || 1, purchaseOrder || externalRef || null]
      );
      created.push({ type: "entitlement", item: ent.rows[0] });
    } else {
      const asset = await (await import("@specora/sdk")).executeTool("asset-command_create_asset", {
        name: item.name || item.description || "Procured asset",
        category: "hardware",
        assetType: item.assetType || "device",
        serialNumber: item.serialNumber,
        manufacturer: item.manufacturer || vendor,
        model: item.model,
        cost: item.cost,
        purchaseOrder,
        invoiceRef: item.invoiceRef,
        source,
        sourceRef: externalRef || purchaseOrder,
      }, fastify);
      created.push({ type: "asset", item: asset });
    }
  }
  emit("asset.procurement_ingested", { count: created.length, source, externalRef });
  return { created, count: created.length };
});

registerTool<FastifyInstance>("asset-command", {
  name: "ingest_contract",
  description: "Create a contract and extract a first-pass entitlement suite from AI-parsed agreement text or line items.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      vendor: { type: "string" },
      documentName: { type: "string" },
      text: { type: "string" },
      entitlements: { type: "array", items: { type: "object", properties: {} } },
    },
    required: ["name"],
  },
}, async (args, fastify) => {
  const { name, vendor, documentName, text, entitlements = [] } = args as any;
  const contract = await fastify.pg.query(
    `INSERT INTO asset_contracts (name, vendor, contract_type, source, document_name, extracted_summary, ai_confidence)
     VALUES ($1, $2, 'software', 'document', $3, $4, $5) RETURNING *`,
    [name, vendor || null, documentName || null, text ? String(text).slice(0, 1200) : null, text ? 0.68 : 0.45]
  );
  const rows = [];
  const parsed = Array.isArray(entitlements) && entitlements.length ? entitlements : [{
    publisher: vendor || "Unknown",
    product: name,
    metric: "user",
    quantity: 0,
    sourceCitation: text ? String(text).slice(0, 240) : "Manual review required",
  }];
  for (const ent of parsed) {
    const result = await fastify.pg.query(
      `INSERT INTO software_entitlements (contract_id, publisher, product, sku, metric, quantity, rights, constraints, confidence, source_citation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [contract.rows[0].id, ent.publisher || vendor || "Unknown", ent.product || name, ent.sku || null, ent.metric || "user", ent.quantity || 0, JSON.stringify(ent.rights || {}), JSON.stringify(ent.constraints || {}), ent.confidence || 0.62, ent.sourceCitation || null]
    );
    rows.push(result.rows[0]);
  }
  emit("asset.contract_ingested", { contractId: contract.rows[0].id, entitlementCount: rows.length });
  return { contract: contract.rows[0], entitlements: rows };
});

registerTool<FastifyInstance>("asset-command", {
  name: "record_scan",
  description: "Record a barcode, QR, RFID, NFC, or photo-assisted mobile scan event and optionally update asset custody/location.",
  parameters: {
    type: "object",
    properties: {
      value: { type: "string" },
      scanType: { type: "string" },
      action: { type: "string" },
      location: { type: "string" },
      condition: { type: "string" },
      assetId: { type: "string" },
      serialNumber: { type: "string" },
      assetTag: { type: "string" },
      payload: { type: "object", properties: {} },
    },
    required: ["value"],
  },
}, async (args, fastify) => {
  const a = args as any;
  let assetId = a.assetId;
  if (!assetId && (a.serialNumber || a.assetTag || a.value)) {
    const found = await fastify.pg.query(
      `SELECT id FROM asset_records WHERE serial_number = $1 OR asset_tag = $2 OR asset_tag = $3 LIMIT 1`,
      [a.serialNumber || a.value, a.assetTag || a.value, a.value]
    );
    assetId = found.rows[0]?.id;
  }
  const scan = await fastify.pg.query(
    `INSERT INTO asset_scan_events (asset_id, scan_type, value, action, location, condition, scanned_by, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [assetId || null, a.scanType || "barcode", a.value, a.action || "verify", a.location || null, a.condition || null, a._userId || null, JSON.stringify(a.payload || {})]
  );
  if (assetId && a.location) {
    await fastify.pg.query(`UPDATE asset_records SET location = $1, status = CASE WHEN status = 'inbox' THEN 'verified' ELSE status END, updated_at = NOW() WHERE id = $2`, [a.location, assetId]);
  }
  emit("asset.scanned", { assetId, value: a.value, action: a.action || "verify" });
  return scan.rows[0];
});

registerTool<FastifyInstance>("asset-command", {
  name: "record_software_usage",
  description: "Record discovered install, SaaS assignment, user activity, device usage, or consumption evidence.",
  parameters: {
    type: "object",
    properties: {
      publisher: { type: "string" },
      product: { type: "string" },
      version: { type: "string" },
      metric: { type: "string" },
      quantity: { type: "number" },
      assetId: { type: "string" },
      ciId: { type: "string" },
      source: { type: "string" },
      sourceRef: { type: "string" },
    },
    required: ["publisher", "product"],
  },
}, async (args, fastify) => {
  const a = args as any;
  const result = await fastify.pg.query(
    `INSERT INTO software_usage (publisher, product, normalized_product, version, metric, quantity, asset_id, ci_id, source, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [a.publisher, a.product, normalizeSoftware(`${a.publisher} ${a.product}`), a.version || null, a.metric || "install", a.quantity || 1, a.assetId || null, a.ciId || null, a.source || "discovery", a.sourceRef || null]
  );
  emit("asset.software_usage_recorded", { usageId: result.rows[0].id, publisher: a.publisher, product: a.product });
  return result.rows[0];
});

registerTool<FastifyInstance>("asset-command", {
  name: "reconcile_sam",
  description: "Reconcile software usage against entitlements and create under-license, over-license, and no-entitlement exceptions.",
  parameters: {
    type: "object",
    properties: {
      publisher: { type: "string" },
      product: { type: "string" },
    },
  },
}, async (args, fastify) => {
  const { publisher, product, _userId } = args as any;
  const entitlements = await fastify.pg.query(
    `SELECT publisher, product, metric, SUM(quantity) as quantity, SUM(consumed) as consumed, MIN(id::text) as entitlement_id
     FROM software_entitlements
     WHERE status = 'active'
       AND ($1::text IS NULL OR LOWER(publisher) = LOWER($1))
       AND ($2::text IS NULL OR LOWER(product) = LOWER($2))
     GROUP BY publisher, product, metric`,
    [publisher || null, product || null]
  );
  const usage = await fastify.pg.query(
    `SELECT publisher, product, metric, SUM(quantity) as quantity, MIN(id::text) as usage_id
     FROM software_usage
     WHERE ($1::text IS NULL OR LOWER(publisher) = LOWER($1))
       AND ($2::text IS NULL OR LOWER(product) = LOWER($2))
     GROUP BY publisher, product, metric`,
    [publisher || null, product || null]
  );
  const run = await fastify.pg.query(
    `INSERT INTO asset_reconciliation_runs (type, status, summary, created_by) VALUES ('sam', 'completed', 'SAM reconciliation completed', $1) RETURNING *`,
    [_userId || null]
  );
  const exceptions = [];
  const entitlementMap = new Map(entitlements.rows.map((row: any) => [`${normalizeSoftware(row.publisher)}|${normalizeSoftware(row.product)}|${row.metric}`, row]));
  for (const row of usage.rows) {
    const key = `${normalizeSoftware(row.publisher)}|${normalizeSoftware(row.product)}|${row.metric}`;
    const ent = entitlementMap.get(key);
    const used = Number(row.quantity || 0);
    const entitled = Number(ent?.quantity || 0);
    if (!ent || entitled === 0) {
      const ex = await fastify.pg.query(
        `INSERT INTO asset_exceptions (run_id, usage_id, type, severity, title, detail, financial_impact)
         VALUES ($1, $2, 'no_entitlement', 'high', $3, $4, $5) RETURNING *`,
        [run.rows[0].id, row.usage_id, `No entitlement for ${row.publisher} ${row.product}`, `${used} ${row.metric} usage has no entitlement evidence`, used * 250]
      );
      exceptions.push(ex.rows[0]);
    } else if (used > entitled) {
      const ex = await fastify.pg.query(
        `INSERT INTO asset_exceptions (run_id, entitlement_id, usage_id, type, severity, title, detail, financial_impact)
         VALUES ($1, $2, $3, 'under_licensed', 'critical', $4, $5, $6) RETURNING *`,
        [run.rows[0].id, ent.entitlement_id, row.usage_id, `Under-licensed ${row.publisher} ${row.product}`, `${used} used vs ${entitled} entitled`, (used - entitled) * 250]
      );
      exceptions.push(ex.rows[0]);
    } else if (entitled - used > 0) {
      const ex = await fastify.pg.query(
        `INSERT INTO asset_exceptions (run_id, entitlement_id, usage_id, type, severity, title, detail, financial_impact)
         VALUES ($1, $2, $3, 'over_licensed', 'medium', $4, $5, $6) RETURNING *`,
        [run.rows[0].id, ent.entitlement_id, row.usage_id, `Over-licensed ${row.publisher} ${row.product}`, `${entitled - used} unused ${row.metric} entitlements`, (entitled - used) * 120]
      );
      exceptions.push(ex.rows[0]);
    }
  }
  const risk = exceptions.reduce((sum: number, ex: any) => sum + (ex.severity === "critical" ? 25 : ex.severity === "high" ? 15 : 5), 0);
  const savings = exceptions.filter((ex: any) => ex.type === "over_licensed").reduce((sum: number, ex: any) => sum + Number(ex.financial_impact || 0), 0);
  await fastify.pg.query(`UPDATE asset_reconciliation_runs SET risk_score = $1, savings_estimate = $2, summary = $3 WHERE id = $4`, [
    risk,
    savings,
    `${exceptions.length} exception${exceptions.length === 1 ? "" : "s"} found`,
    run.rows[0].id,
  ]);
  emit("asset.sam_reconciled", { runId: run.rows[0].id, exceptionCount: exceptions.length, risk, savings });
  return { run: { ...run.rows[0], risk_score: risk, savings_estimate: savings }, exceptions };
});

registerTool<FastifyInstance>("asset-command", {
  name: "dashboard",
  description: "Return asset, contract, entitlement, usage, savings, and exception summary for the command center.",
  parameters: { type: "object", properties: {} },
}, async (_args, fastify) => {
  const [assets, contracts, entitlements, usage, exceptions, runs] = await Promise.all([
    fastify.pg.query(`SELECT COUNT(*)::int as count FROM asset_records`),
    fastify.pg.query(`SELECT COUNT(*)::int as count FROM asset_contracts`),
    fastify.pg.query(`SELECT COUNT(*)::int as count, COALESCE(SUM(quantity), 0)::numeric as quantity FROM software_entitlements`),
    fastify.pg.query(`SELECT COUNT(*)::int as count, COALESCE(SUM(quantity), 0)::numeric as quantity FROM software_usage`),
    fastify.pg.query(`SELECT COUNT(*)::int as count, COALESCE(SUM(financial_impact), 0)::numeric as impact FROM asset_exceptions WHERE status = 'open'`),
    fastify.pg.query(`SELECT * FROM asset_reconciliation_runs ORDER BY created_at DESC LIMIT 5`),
  ]);
  return {
    assets: assets.rows[0],
    contracts: contracts.rows[0],
    entitlements: entitlements.rows[0],
    usage: usage.rows[0],
    exceptions: exceptions.rows[0],
    recentRuns: runs.rows,
  };
});

registerTool<FastifyInstance>("asset-command", {
  name: "list_exceptions",
  description: "List open ITAM exceptions such as missing assets, no entitlement, under-license, over-license, duplicate serials, and stale custody.",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string" },
      severity: { type: "string" },
      type: { type: "string" },
      limit: { type: "integer" },
    },
  },
}, async (args, fastify) => {
  const { status = "open", severity, type, limit = 100 } = args as any;
  const params: any[] = [status];
  let sql = `SELECT * FROM asset_exceptions WHERE status = $1`;
  if (severity) { params.push(severity); sql += ` AND severity = $${params.length}`; }
  if (type) { params.push(type); sql += ` AND type = $${params.length}`; }
  params.push(Math.min(Number(limit) || 100, 250));
  sql += ` ORDER BY severity = 'critical' DESC, severity = 'high' DESC, financial_impact DESC, created_at DESC LIMIT $${params.length}`;
  const result = await fastify.pg.query(sql, params);
  return result.rows;
});
}

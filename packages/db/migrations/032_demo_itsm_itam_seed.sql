-- Deterministic demo operations seed.
-- Neo4j CIs are loaded by packages/db/src/seed.ts; this migration links Postgres
-- ITSM/ITAM records to those stable demo CI IDs.

INSERT INTO discovery_sources (id, name, type, config, created_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Datacenter collector', 'agent', '{"schedule":"*/15 * * * *","scope":["prod"],"owner":"Platform Operations"}', NOW() - INTERVAL '14 days'),
  ('a0000000-0000-4000-8000-000000000002', 'Enterprise software inventory', 'upload', '{"format":"csv","normalization":"software_usage","owner":"IT Asset Management"}', NOW() - INTERVAL '9 days')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  config = EXCLUDED.config;

INSERT INTO discovery_jobs (id, source_id, file_path, status, stats, created_at, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', NULL, 'completed', '{"created":24,"updated":381,"unchanged":4182,"errors":0}', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours'),
  ('a0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000002', '/uploads/software-inventory.csv', 'completed', '{"created":3,"updated":92,"exceptions":4}', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO UPDATE SET
  source_id = EXCLUDED.source_id,
  file_path = EXCLUDED.file_path,
  status = EXCLUDED.status,
  stats = EXCLUDED.stats,
  updated_at = EXCLUDED.updated_at;

INSERT INTO change_requests (
  id, ci_id, title, description, status, requester_id, approver_id,
  scheduled_at, planned_start_at, planned_end_at, risk_score, blast_radius, priority, created_at, updated_at
) VALUES
  (
    'b0000000-0000-4000-8000-000000000001',
    'demo-applicationservice-0001',
    'Increase checkout API capacity',
    'Scale checkout API workers and add queue backpressure before the seasonal launch window.',
    'approved',
    '550e8400-e29b-41d4-a716-446655440001',
    '550e8400-e29b-41d4-a716-446655440001',
    NOW() + INTERVAL '2 days',
    NOW() + INTERVAL '2 days',
    NOW() + INTERVAL '2 days 2 hours',
    68,
    42,
    'medium',
    NOW() - INTERVAL '3 days',
    NOW() - INTERVAL '6 hours'
  ),
  (
    'b0000000-0000-4000-8000-000000000002',
    'demo-database-0001',
    'Patch customer ledger database cluster',
    'Apply vendor security update to primary and replica database nodes.',
    'pending_approval',
    '550e8400-e29b-41d4-a716-446655440004',
    NULL,
    NOW() + INTERVAL '5 days',
    NOW() + INTERVAL '5 days',
    NOW() + INTERVAL '5 days 3 hours',
    82,
    57,
    'high',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 hour'
  )
ON CONFLICT (id) DO UPDATE SET
  ci_id = EXCLUDED.ci_id,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  requester_id = EXCLUDED.requester_id,
  approver_id = EXCLUDED.approver_id,
  scheduled_at = EXCLUDED.scheduled_at,
  planned_start_at = EXCLUDED.planned_start_at,
  planned_end_at = EXCLUDED.planned_end_at,
  risk_score = EXCLUDED.risk_score,
  blast_radius = EXCLUDED.blast_radius,
  priority = EXCLUDED.priority,
  updated_at = EXCLUDED.updated_at;

INSERT INTO change_request_cis (change_request_id, ci_id, role, distance, direction, contribution) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'demo-applicationservice-0001', 'primary', 0, 'self', 1.0),
  ('b0000000-0000-4000-8000-000000000001', 'demo-server-0001', 'affected', 1, 'downstream', 0.64),
  ('b0000000-0000-4000-8000-000000000001', 'demo-database-0001', 'affected', 2, 'downstream', 0.47),
  ('b0000000-0000-4000-8000-000000000002', 'demo-database-0001', 'primary', 0, 'self', 1.0),
  ('b0000000-0000-4000-8000-000000000002', 'demo-businessservice-0001', 'affected', 2, 'upstream', 0.71)
ON CONFLICT (change_request_id, ci_id) DO UPDATE SET
  role = EXCLUDED.role,
  distance = EXCLUDED.distance,
  direction = EXCLUDED.direction,
  contribution = EXCLUDED.contribution;

INSERT INTO change_request_approvers (change_request_id, user_id, role, approved_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', '550e8400-e29b-41d4-a716-446655440001', 'change_manager', NOW() - INTERVAL '6 hours'),
  ('b0000000-0000-4000-8000-000000000002', '550e8400-e29b-41d4-a716-446655440001', 'approver', NULL)
ON CONFLICT (change_request_id, user_id) DO UPDATE SET
  role = EXCLUDED.role,
  approved_at = EXCLUDED.approved_at;

INSERT INTO change_request_comments (id, change_request_id, user_id, content, created_at) VALUES
  ('b0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000001', '550e8400-e29b-41d4-a716-446655440001', 'CAB approved with a rollback checkpoint after the first capacity step.', NOW() - INTERVAL '6 hours'),
  ('b0000000-0000-4000-8000-000000000102', 'b0000000-0000-4000-8000-000000000002', '550e8400-e29b-41d4-a716-446655440004', 'Waiting on service owner confirmation for ledger reporting dependency.', NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO UPDATE SET
  content = EXCLUDED.content,
  created_at = EXCLUDED.created_at;

INSERT INTO incidents (
  id, source, external_ref, title, description, service, ci_id, status, severity, priority,
  assignment_group, owner_id, commander_id, ai_state, ai_confidence, ai_summary, ai_next_action,
  ai_decision, auto_remediation_allowed, detected_at, acknowledged_at, resolved_at, created_at, updated_at
) VALUES
  (
    'c0000000-0000-4000-8000-000000000001',
    'monitoring',
    'alert-checkout-latency-001',
    'Checkout latency spike',
    'p95 latency exceeded SLO for the checkout API after queue depth increased.',
    'Digital Commerce',
    'demo-applicationservice-0001',
    'mitigating',
    'high',
    1,
    'Platform Operations',
    '550e8400-e29b-41d4-a716-446655440001',
    '550e8400-e29b-41d4-a716-446655440001',
    'action_recommended',
    0.86,
    'Likely queue saturation on checkout workers; related capacity change is already approved.',
    'Execute low-risk worker scale-out and monitor queue drain for 15 minutes.',
    'request-approval',
    TRUE,
    NOW() - INTERVAL '45 minutes',
    NOW() - INTERVAL '38 minutes',
    NULL,
    NOW() - INTERVAL '45 minutes',
    NOW() - INTERVAL '8 minutes'
  ),
  (
    'c0000000-0000-4000-8000-000000000002',
    'discovery',
    'disc-db-backup-002',
    'Ledger backup age exceeded policy',
    'Discovery observed backup metadata older than the production policy threshold.',
    'Financial Operations',
    'demo-database-0001',
    'resolved',
    'medium',
    2,
    'Database Operations',
    '550e8400-e29b-41d4-a716-446655440004',
    NULL,
    'resolved',
    0.79,
    'Backup job schedule drifted after maintenance and was restarted successfully.',
    'Create prevention candidate for backup schedule drift.',
    'auto-resolved',
    TRUE,
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '2 days 20 minutes',
    NOW() - INTERVAL '1 day 23 hours',
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '1 day 23 hours'
  )
ON CONFLICT (source, external_ref) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  service = EXCLUDED.service,
  ci_id = EXCLUDED.ci_id,
  status = EXCLUDED.status,
  severity = EXCLUDED.severity,
  priority = EXCLUDED.priority,
  assignment_group = EXCLUDED.assignment_group,
  owner_id = EXCLUDED.owner_id,
  commander_id = EXCLUDED.commander_id,
  ai_state = EXCLUDED.ai_state,
  ai_confidence = EXCLUDED.ai_confidence,
  ai_summary = EXCLUDED.ai_summary,
  ai_next_action = EXCLUDED.ai_next_action,
  ai_decision = EXCLUDED.ai_decision,
  auto_remediation_allowed = EXCLUDED.auto_remediation_allowed,
  acknowledged_at = EXCLUDED.acknowledged_at,
  resolved_at = EXCLUDED.resolved_at,
  updated_at = EXCLUDED.updated_at;

INSERT INTO incident_cis (incident_id, ci_id, role, distance) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'demo-applicationservice-0001', 'primary', 0),
  ('c0000000-0000-4000-8000-000000000001', 'demo-server-0001', 'suspect', 1),
  ('c0000000-0000-4000-8000-000000000001', 'demo-database-0001', 'dependency', 2),
  ('c0000000-0000-4000-8000-000000000002', 'demo-database-0001', 'primary', 0)
ON CONFLICT (incident_id, ci_id) DO UPDATE SET
  role = EXCLUDED.role,
  distance = EXCLUDED.distance;

INSERT INTO incident_events (id, incident_id, type, message, actor_id, metadata, created_at) VALUES
  ('c0000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-000000000001', 'signal', 'Latency alert ingested from monitoring.', NULL, '{"source":"monitoring"}', NOW() - INTERVAL '45 minutes'),
  ('c0000000-0000-4000-8000-000000000102', 'c0000000-0000-4000-8000-000000000001', 'ai_triage', 'AI correlated the incident with an approved capacity change.', NULL, '{"changeRequestId":"b0000000-0000-4000-8000-000000000001"}', NOW() - INTERVAL '39 minutes'),
  ('c0000000-0000-4000-8000-000000000103', 'c0000000-0000-4000-8000-000000000002', 'resolution', 'Backup job restarted and next run completed.', '550e8400-e29b-41d4-a716-446655440004', '{"durationMinutes":54}', NOW() - INTERVAL '1 day 23 hours')
ON CONFLICT (id) DO UPDATE SET
  message = EXCLUDED.message,
  metadata = EXCLUDED.metadata,
  created_at = EXCLUDED.created_at;

INSERT INTO incident_actions (
  id, incident_id, name, kind, status, risk_level, confidence, requires_approval, approved_by, result, created_at, updated_at
) VALUES
  ('c0000000-0000-4000-8000-000000000201', 'c0000000-0000-4000-8000-000000000001', 'Scale checkout API workers by 20%', 'scale', 'proposed', 'medium', 0.84, TRUE, NULL, NULL, NOW() - INTERVAL '37 minutes', NOW() - INTERVAL '37 minutes'),
  ('c0000000-0000-4000-8000-000000000202', 'c0000000-0000-4000-8000-000000000002', 'Restart ledger backup scheduler', 'restart', 'executed', 'low', 0.81, FALSE, NULL, 'Scheduler restarted; next backup completed.', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day 23 hours')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  result = EXCLUDED.result,
  updated_at = EXCLUDED.updated_at;

INSERT INTO incident_postmortems (id, incident_id, status, summary, root_cause, prevention_items, generated_by, created_at, updated_at) VALUES
  ('c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-000000000002', 'draft', 'Ledger backup breach was detected and remediated before customer impact.', 'Backup scheduler drifted after a maintenance restart.', '[{"title":"Monitor backup scheduler drift","owner":"Database Operations"}]', '550e8400-e29b-41d4-a716-446655440004', NOW() - INTERVAL '1 day 22 hours', NOW() - INTERVAL '1 day 22 hours')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  summary = EXCLUDED.summary,
  root_cause = EXCLUDED.root_cause,
  prevention_items = EXCLUDED.prevention_items,
  updated_at = EXCLUDED.updated_at;

INSERT INTO knowledge_items (
  id, type, title, summary, content, status, audience, source, source_ref, owner_id,
  service, ci_id, tags, trust_score, health_score, ai_confidence, reuse_count,
  deflection_count, last_validated_at, published_at, created_at, updated_at
) VALUES
  (
    'd0000000-0000-4000-8000-000000000001',
    'runbook',
    'Checkout API latency mitigation',
    'Safe steps to validate and scale checkout workers during latency events.',
    'Validate queue depth, confirm database health, scale checkout workers in 20% increments, then watch p95 latency and error rate for 15 minutes.',
    'published',
    'internal',
    'incident',
    'c0000000-0000-4000-8000-000000000001',
    '550e8400-e29b-41d4-a716-446655440001',
    'Digital Commerce',
    'demo-applicationservice-0001',
    ARRAY['incident','runbook','checkout','ai-ready'],
    0.91,
    0.86,
    0.88,
    17,
    6,
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '10 days',
    NOW() - INTERVAL '12 days',
    NOW() - INTERVAL '2 days'
  ),
  (
    'd0000000-0000-4000-8000-000000000002',
    'known_error',
    'Ledger backup scheduler drift after maintenance',
    'Known failure mode for backup scheduler drift on database maintenance restarts.',
    'If backup age exceeds policy after maintenance, verify scheduler process state, restart scheduler, and confirm a completed backup artifact.',
    'published',
    'internal',
    'postmortem',
    'c0000000-0000-4000-8000-000000000301',
    '550e8400-e29b-41d4-a716-446655440004',
    'Financial Operations',
    'demo-database-0001',
    ARRAY['known-error','database','backup','prevention'],
    0.88,
    0.83,
    0.82,
    9,
    3,
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day'
  )
ON CONFLICT (id) DO UPDATE SET
  type = EXCLUDED.type,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  content = EXCLUDED.content,
  status = EXCLUDED.status,
  audience = EXCLUDED.audience,
  source = EXCLUDED.source,
  source_ref = EXCLUDED.source_ref,
  owner_id = EXCLUDED.owner_id,
  service = EXCLUDED.service,
  ci_id = EXCLUDED.ci_id,
  tags = EXCLUDED.tags,
  trust_score = EXCLUDED.trust_score,
  health_score = EXCLUDED.health_score,
  ai_confidence = EXCLUDED.ai_confidence,
  reuse_count = EXCLUDED.reuse_count,
  deflection_count = EXCLUDED.deflection_count,
  last_validated_at = EXCLUDED.last_validated_at,
  published_at = EXCLUDED.published_at,
  updated_at = EXCLUDED.updated_at;

INSERT INTO knowledge_links (knowledge_id, target_type, target_id, relationship) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'incident', 'c0000000-0000-4000-8000-000000000001', 'mitigates'),
  ('d0000000-0000-4000-8000-000000000001', 'change_request', 'b0000000-0000-4000-8000-000000000001', 'supports'),
  ('d0000000-0000-4000-8000-000000000002', 'incident', 'c0000000-0000-4000-8000-000000000002', 'explains')
ON CONFLICT (knowledge_id, target_type, target_id, relationship) DO NOTHING;

INSERT INTO knowledge_feedback (id, knowledge_id, user_id, helpful, outcome, comment, context, created_at) VALUES
  ('d0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000001', '550e8400-e29b-41d4-a716-446655440001', TRUE, 'assisted', 'Runbook matched the incident context and gave usable next steps.', '{"incidentId":"c0000000-0000-4000-8000-000000000001"}', NOW() - INTERVAL '34 minutes')
ON CONFLICT (id) DO UPDATE SET
  helpful = EXCLUDED.helpful,
  outcome = EXCLUDED.outcome,
  comment = EXCLUDED.comment,
  context = EXCLUDED.context,
  created_at = EXCLUDED.created_at;

INSERT INTO knowledge_gaps (query, context, status, demand_count, proposed_knowledge_id, created_at, updated_at) VALUES
  ('How do we validate Microsoft E5 device entitlement rights after contract upload?', '{"app":"asset-command","service":"IT Asset Management"}', 'open', 4, NULL, NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 hours')
ON CONFLICT (query) DO UPDATE SET
  context = EXCLUDED.context,
  status = EXCLUDED.status,
  demand_count = EXCLUDED.demand_count,
  updated_at = EXCLUDED.updated_at;

INSERT INTO knowledge_events (id, knowledge_id, type, message, actor_id, metadata, created_at) VALUES
  ('d0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000001', 'validated', 'AI and incident commander validated runbook usefulness during checkout latency incident.', '550e8400-e29b-41d4-a716-446655440001', '{"confidence":0.88}', NOW() - INTERVAL '34 minutes'),
  ('d0000000-0000-4000-8000-000000000202', 'd0000000-0000-4000-8000-000000000002', 'published', 'Known error generated from incident postmortem.', '550e8400-e29b-41d4-a716-446655440004', '{"source":"postmortem"}', NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO UPDATE SET
  message = EXCLUDED.message,
  metadata = EXCLUDED.metadata,
  created_at = EXCLUDED.created_at;

INSERT INTO prevention_records (
  id, title, description, status, category, priority, service, ci_id, owner_id,
  recurrence_count, impact_score, confidence, estimated_hours_saved, verified_reduction_pct,
  known_error_id, created_at, updated_at, resolved_at
) VALUES
  (
    'e0000000-0000-4000-8000-000000000001',
    'Prevent ledger backup schedule drift',
    'Automate drift detection and scheduler self-healing after maintenance windows.',
    'monitoring',
    'known_error',
    2,
    'Financial Operations',
    'demo-database-0001',
    '550e8400-e29b-41d4-a716-446655440004',
    3,
    72,
    0.81,
    12,
    35,
    'd0000000-0000-4000-8000-000000000002',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '4 hours',
    NULL
  ),
  (
    'e0000000-0000-4000-8000-000000000002',
    'Reduce checkout latency recurrence',
    'Use incident and discovery signals to predict queue saturation before SLO breach.',
    'candidate',
    'recurring_incident',
    1,
    'Digital Commerce',
    'demo-applicationservice-0001',
    '550e8400-e29b-41d4-a716-446655440001',
    5,
    91,
    0.77,
    20,
    NULL,
    NULL,
    NOW() - INTERVAL '40 minutes',
    NOW() - INTERVAL '20 minutes',
    NULL
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  category = EXCLUDED.category,
  priority = EXCLUDED.priority,
  service = EXCLUDED.service,
  ci_id = EXCLUDED.ci_id,
  owner_id = EXCLUDED.owner_id,
  recurrence_count = EXCLUDED.recurrence_count,
  impact_score = EXCLUDED.impact_score,
  confidence = EXCLUDED.confidence,
  estimated_hours_saved = EXCLUDED.estimated_hours_saved,
  verified_reduction_pct = EXCLUDED.verified_reduction_pct,
  known_error_id = EXCLUDED.known_error_id,
  updated_at = EXCLUDED.updated_at;

INSERT INTO prevention_evidence (prevention_id, source_type, source_id, summary, weight) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'incident', 'c0000000-0000-4000-8000-000000000002', 'Backup scheduler drift produced a policy breach.', 1.0),
  ('e0000000-0000-4000-8000-000000000001', 'knowledge', 'd0000000-0000-4000-8000-000000000002', 'Known error gives verified detection and restart steps.', 0.8),
  ('e0000000-0000-4000-8000-000000000002', 'incident', 'c0000000-0000-4000-8000-000000000001', 'Checkout latency incident can become preventable with queue saturation prediction.', 1.0)
ON CONFLICT (prevention_id, source_type, source_id) DO UPDATE SET
  summary = EXCLUDED.summary,
  weight = EXCLUDED.weight;

INSERT INTO prevention_actions (id, prevention_id, type, title, status, target_app, target_id, result, created_at, updated_at) VALUES
  ('e0000000-0000-4000-8000-000000000101', 'e0000000-0000-4000-8000-000000000001', 'automation', 'Create scheduler drift monitor', 'in_progress', 'health-monitor', NULL, 'Monitor rule drafted from postmortem evidence.', NOW() - INTERVAL '18 hours', NOW() - INTERVAL '4 hours'),
  ('e0000000-0000-4000-8000-000000000102', 'e0000000-0000-4000-8000-000000000002', 'knowledge', 'Draft predictive queue saturation guide', 'proposed', 'knowledge-core', 'd0000000-0000-4000-8000-000000000001', NULL, NOW() - INTERVAL '25 minutes', NOW() - INTERVAL '25 minutes')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  result = EXCLUDED.result,
  updated_at = EXCLUDED.updated_at;

INSERT INTO prevention_events (id, prevention_id, type, message, actor_id, metadata, created_at) VALUES
  ('e0000000-0000-4000-8000-000000000201', 'e0000000-0000-4000-8000-000000000001', 'created', 'Prevention candidate created from resolved incident and known error.', '550e8400-e29b-41d4-a716-446655440004', '{"sourceIncidentId":"c0000000-0000-4000-8000-000000000002"}', NOW() - INTERVAL '1 day'),
  ('e0000000-0000-4000-8000-000000000202', 'e0000000-0000-4000-8000-000000000002', 'created', 'AI proposed proactive checkout capacity prevention.', '550e8400-e29b-41d4-a716-446655440001', '{"sourceIncidentId":"c0000000-0000-4000-8000-000000000001"}', NOW() - INTERVAL '25 minutes')
ON CONFLICT (id) DO UPDATE SET
  message = EXCLUDED.message,
  metadata = EXCLUDED.metadata,
  created_at = EXCLUDED.created_at;

INSERT INTO asset_contracts (
  id, name, vendor, contract_type, status, source, source_ref, document_name,
  extracted_summary, ai_confidence, starts_at, ends_at, renewal_at, annual_cost, currency, created_at, updated_at
) VALUES
  (
    'f0000000-0000-4000-8000-000000000001',
    'Microsoft Enterprise Agreement FY26',
    'Microsoft',
    'software',
    'active',
    'document_ai',
    'MS-EA-FY26',
    'Microsoft-EA-FY26.pdf',
    'AI extracted M365 E5 and Visio entitlements with user metric constraints.',
    0.87,
    DATE '2026-01-01',
    DATE '2026-12-31',
    DATE '2026-10-01',
    420000,
    'USD',
    NOW() - INTERVAL '8 days',
    NOW() - INTERVAL '1 day'
  ),
  (
    'f0000000-0000-4000-8000-000000000002',
    'Dell ProSupport Fleet Coverage',
    'Dell',
    'hardware',
    'active',
    'procurement',
    'PO-2026-0442',
    'Dell-ProSupport-Fleet.pdf',
    'Covers production application servers and replacement parts.',
    0.73,
    DATE '2026-02-01',
    DATE '2029-01-31',
    DATE '2028-10-31',
    86000,
    'USD',
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '2 days'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  vendor = EXCLUDED.vendor,
  contract_type = EXCLUDED.contract_type,
  status = EXCLUDED.status,
  source = EXCLUDED.source,
  source_ref = EXCLUDED.source_ref,
  document_name = EXCLUDED.document_name,
  extracted_summary = EXCLUDED.extracted_summary,
  ai_confidence = EXCLUDED.ai_confidence,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  renewal_at = EXCLUDED.renewal_at,
  annual_cost = EXCLUDED.annual_cost,
  updated_at = EXCLUDED.updated_at;

INSERT INTO asset_records (
  id, asset_tag, serial_number, name, category, asset_type, status, lifecycle_state,
  manufacturer, model, assigned_to, owner_group, location, ci_id, cost, currency,
  purchase_order, invoice_ref, contract_id, warranty_expires_at, acquisition_date,
  confidence, evidence_score, created_at, updated_at
) VALUES
  (
    'f0000000-0000-4000-8000-000000000101',
    'SPC-SRV-0001',
    'SRV0001SPECORA',
    'prod-checkout-worker-01',
    'hardware',
    'server',
    'active',
    'in_service',
    'Dell',
    'PowerEdge R760',
    NULL,
    'Platform Operations',
    'Dallas DC1',
    'demo-server-0001',
    11800,
    'USD',
    'PO-2026-0442',
    'INV-88391',
    'f0000000-0000-4000-8000-000000000002',
    DATE '2029-01-31',
    DATE '2026-02-10',
    0.92,
    0.88,
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '2 hours'
  ),
  (
    'f0000000-0000-4000-8000-000000000102',
    'SPC-LAP-0104',
    'LAP0104SPECORA',
    'Alice Chen laptop',
    'hardware',
    'laptop',
    'active',
    'assigned',
    'Lenovo',
    'ThinkPad X1 Carbon',
    '550e8400-e29b-41d4-a716-446655440001',
    'Security Engineering',
    'Chicago HQ',
    NULL,
    2100,
    'USD',
    'PO-2026-0104',
    'INV-77104',
    NULL,
    DATE '2029-03-15',
    DATE '2026-03-15',
    0.89,
    0.76,
    NOW() - INTERVAL '40 days',
    NOW() - INTERVAL '4 hours'
  )
ON CONFLICT (id) DO UPDATE SET
  asset_tag = EXCLUDED.asset_tag,
  serial_number = EXCLUDED.serial_number,
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  asset_type = EXCLUDED.asset_type,
  status = EXCLUDED.status,
  lifecycle_state = EXCLUDED.lifecycle_state,
  manufacturer = EXCLUDED.manufacturer,
  model = EXCLUDED.model,
  assigned_to = EXCLUDED.assigned_to,
  owner_group = EXCLUDED.owner_group,
  location = EXCLUDED.location,
  ci_id = EXCLUDED.ci_id,
  cost = EXCLUDED.cost,
  purchase_order = EXCLUDED.purchase_order,
  invoice_ref = EXCLUDED.invoice_ref,
  contract_id = EXCLUDED.contract_id,
  warranty_expires_at = EXCLUDED.warranty_expires_at,
  acquisition_date = EXCLUDED.acquisition_date,
  confidence = EXCLUDED.confidence,
  evidence_score = EXCLUDED.evidence_score,
  updated_at = EXCLUDED.updated_at;

INSERT INTO software_entitlements (
  id, contract_id, publisher, product, sku, metric, quantity, consumed,
  rights, constraints, status, confidence, source_citation, starts_at, ends_at, created_at, updated_at
) VALUES
  (
    'f0000000-0000-4000-8000-000000000201',
    'f0000000-0000-4000-8000-000000000001',
    'Microsoft',
    'M365 E5',
    'M365-E5-USR',
    'user',
    750,
    690,
    '{"included":["Office","Teams","Defender","Power BI Pro"]}',
    '{"territory":"US","requiresNamedUser":true}',
    'active',
    0.88,
    'Section 2.1 user subscription licenses',
    DATE '2026-01-01',
    DATE '2026-12-31',
    NOW() - INTERVAL '8 days',
    NOW() - INTERVAL '1 day'
  ),
  (
    'f0000000-0000-4000-8000-000000000202',
    'f0000000-0000-4000-8000-000000000001',
    'Microsoft',
    'Visio Plan 2',
    'VISIO-P2-USR',
    'user',
    50,
    68,
    '{"included":["Visio desktop","Visio web"]}',
    '{"requiresNamedUser":true}',
    'active',
    0.84,
    'Appendix B Visio add-on subscriptions',
    DATE '2026-01-01',
    DATE '2026-12-31',
    NOW() - INTERVAL '8 days',
    NOW() - INTERVAL '1 day'
  )
ON CONFLICT (id) DO UPDATE SET
  contract_id = EXCLUDED.contract_id,
  publisher = EXCLUDED.publisher,
  product = EXCLUDED.product,
  sku = EXCLUDED.sku,
  metric = EXCLUDED.metric,
  quantity = EXCLUDED.quantity,
  consumed = EXCLUDED.consumed,
  rights = EXCLUDED.rights,
  constraints = EXCLUDED.constraints,
  status = EXCLUDED.status,
  confidence = EXCLUDED.confidence,
  source_citation = EXCLUDED.source_citation,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  updated_at = EXCLUDED.updated_at;

INSERT INTO software_usage (
  id, publisher, product, normalized_product, version, metric, quantity, user_id,
  asset_id, ci_id, source, source_ref, last_seen_at, created_at
) VALUES
  ('f0000000-0000-4000-8000-000000000301', 'Microsoft', 'M365 E5', 'M365 E5', NULL, 'user', 1, '550e8400-e29b-41d4-a716-446655440001', 'f0000000-0000-4000-8000-000000000102', NULL, 'discovery', 'a0000000-0000-4000-8000-000000000012', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '1 day'),
  ('f0000000-0000-4000-8000-000000000302', 'Microsoft', 'Visio Plan 2', 'Visio Plan 2', NULL, 'user', 68, NULL, NULL, NULL, 'discovery', 'a0000000-0000-4000-8000-000000000012', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '1 day'),
  ('f0000000-0000-4000-8000-000000000303', 'Oracle', 'Database Enterprise Edition', 'Oracle Database Enterprise Edition', '19c', 'install', 1, NULL, NULL, 'demo-database-0001', 'discovery', 'a0000000-0000-4000-8000-000000000012', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO UPDATE SET
  quantity = EXCLUDED.quantity,
  asset_id = EXCLUDED.asset_id,
  ci_id = EXCLUDED.ci_id,
  source_ref = EXCLUDED.source_ref,
  last_seen_at = EXCLUDED.last_seen_at;

INSERT INTO asset_evidence (
  id, asset_id, contract_id, entitlement_id, evidence_type, source, source_ref, payload, confidence, created_at
) VALUES
  ('f0000000-0000-4000-8000-000000000401', 'f0000000-0000-4000-8000-000000000101', 'f0000000-0000-4000-8000-000000000002', NULL, 'purchase', 'procurement', 'PO-2026-0442', '{"invoice":"INV-88391","matchedBy":"serial_number"}', 0.9, NOW() - INTERVAL '2 days'),
  ('f0000000-0000-4000-8000-000000000402', NULL, 'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000202', 'contract_extraction', 'document_ai', 'MS-EA-FY26', '{"clause":"Appendix B","metric":"user"}', 0.84, NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO UPDATE SET
  payload = EXCLUDED.payload,
  confidence = EXCLUDED.confidence,
  created_at = EXCLUDED.created_at;

INSERT INTO asset_scan_events (
  id, asset_id, scan_type, value, action, location, condition, scanned_by, payload, created_at
) VALUES
  ('f0000000-0000-4000-8000-000000000501', 'f0000000-0000-4000-8000-000000000101', 'discovery', 'SRV0001SPECORA', 'verify', 'Dallas DC1', 'operational', NULL, '{"ciId":"demo-server-0001"}', NOW() - INTERVAL '2 hours'),
  ('f0000000-0000-4000-8000-000000000502', 'f0000000-0000-4000-8000-000000000102', 'barcode', 'SPC-LAP-0104', 'verify', 'Chicago HQ', 'good', '550e8400-e29b-41d4-a716-446655440001', '{"mobileReady":true}', NOW() - INTERVAL '4 hours')
ON CONFLICT (id) DO UPDATE SET
  asset_id = EXCLUDED.asset_id,
  action = EXCLUDED.action,
  location = EXCLUDED.location,
  condition = EXCLUDED.condition,
  payload = EXCLUDED.payload,
  created_at = EXCLUDED.created_at;

INSERT INTO asset_reconciliation_runs (id, type, status, summary, risk_score, savings_estimate, created_by, created_at) VALUES
  ('f0000000-0000-4000-8000-000000000601', 'sam', 'completed', 'SAM reconciliation found one under-licensed product and one missing entitlement.', 76, 0, '550e8400-e29b-41d4-a716-446655440001', NOW() - INTERVAL '5 hours')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  summary = EXCLUDED.summary,
  risk_score = EXCLUDED.risk_score,
  savings_estimate = EXCLUDED.savings_estimate,
  created_at = EXCLUDED.created_at;

INSERT INTO asset_exceptions (
  id, run_id, asset_id, entitlement_id, usage_id, type, severity, status,
  title, detail, financial_impact, created_at, updated_at
) VALUES
  (
    'f0000000-0000-4000-8000-000000000701',
    'f0000000-0000-4000-8000-000000000601',
    NULL,
    'f0000000-0000-4000-8000-000000000202',
    'f0000000-0000-4000-8000-000000000302',
    'under_licensed',
    'high',
    'open',
    'Visio Plan 2 usage exceeds entitlement',
    'Discovered usage is 68 users against 50 purchased seats.',
    5400,
    NOW() - INTERVAL '5 hours',
    NOW() - INTERVAL '5 hours'
  ),
  (
    'f0000000-0000-4000-8000-000000000702',
    'f0000000-0000-4000-8000-000000000601',
    NULL,
    NULL,
    'f0000000-0000-4000-8000-000000000303',
    'no_entitlement',
    'critical',
    'open',
    'Oracle Database usage has no entitlement',
    'Discovery found Oracle Database Enterprise Edition installed on ledger database CI without a matching entitlement.',
    47500,
    NOW() - INTERVAL '5 hours',
    NOW() - INTERVAL '5 hours'
  )
ON CONFLICT (id) DO UPDATE SET
  run_id = EXCLUDED.run_id,
  entitlement_id = EXCLUDED.entitlement_id,
  usage_id = EXCLUDED.usage_id,
  type = EXCLUDED.type,
  severity = EXCLUDED.severity,
  status = EXCLUDED.status,
  title = EXCLUDED.title,
  detail = EXCLUDED.detail,
  financial_impact = EXCLUDED.financial_impact,
  updated_at = EXCLUDED.updated_at;

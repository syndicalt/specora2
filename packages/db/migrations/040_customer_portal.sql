CREATE TABLE IF NOT EXISTS catalog_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(120) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(120) NOT NULL DEFAULT 'General',
    item_type VARCHAR(80) NOT NULL DEFAULT 'service_request',
    status VARCHAR(40) NOT NULL DEFAULT 'published',
    audience JSONB NOT NULL DEFAULT '[]',
    questions JSONB NOT NULL DEFAULT '[]',
    fulfillment JSONB NOT NULL DEFAULT '[]',
    related_knowledge_ids JSONB NOT NULL DEFAULT '[]',
    owner_group VARCHAR(255),
    fulfillment_group VARCHAR(255),
    ai_prompt TEXT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number VARCHAR(80) UNIQUE,
    requester_id UUID REFERENCES users(id),
    catalog_item_id UUID REFERENCES catalog_items(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    request_type VARCHAR(80) NOT NULL DEFAULT 'service_request',
    status VARCHAR(80) NOT NULL DEFAULT 'submitted',
    priority INT NOT NULL DEFAULT 3,
    source VARCHAR(80) NOT NULL DEFAULT 'portal',
    intent_summary TEXT,
    answers JSONB NOT NULL DEFAULT '{}',
    ai_resolution JSONB NOT NULL DEFAULT '{}',
    fulfillment_plan JSONB NOT NULL DEFAULT '[]',
    support_channel_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog_request_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES catalog_requests(id) ON DELETE CASCADE,
    type VARCHAR(80) NOT NULL,
    message TEXT NOT NULL,
    actor_id UUID REFERENCES users(id),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    channel_type VARCHAR(80) NOT NULL,
    description TEXT,
    target VARCHAR(255),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    priority INT NOT NULL DEFAULT 100,
    rules JSONB NOT NULL DEFAULT '{}',
    integration_config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_handoffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID REFERENCES support_channels(id),
    requester_id UUID REFERENCES users(id),
    request_id UUID REFERENCES catalog_requests(id),
    incident_id UUID REFERENCES incidents(id),
    status VARCHAR(80) NOT NULL DEFAULT 'requested',
    reason TEXT,
    context JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_status_category ON catalog_items(status, category);
CREATE INDEX IF NOT EXISTS idx_catalog_requests_requester ON catalog_requests(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_channels_enabled ON support_channels(enabled, priority);

ALTER TABLE catalog_requests ADD CONSTRAINT catalog_requests_support_channel_fk
  FOREIGN KEY (support_channel_id) REFERENCES support_channels(id) NOT VALID;

INSERT INTO catalog_items (key, title, description, category, item_type, questions, fulfillment, owner_group, fulfillment_group, ai_prompt)
VALUES
  (
    'request-application-access',
    'Request Application Access',
    'Ask for access to an application or business service. Specora checks known guidance first, then routes approval and fulfillment.',
    'Access',
    'access_request',
    '[{"key":"application","label":"Application or service","type":"text","required":true},{"key":"accessLevel","label":"Access level","type":"select","options":["read","contributor","admin"],"required":true},{"key":"businessJustification","label":"Business justification","type":"textarea","required":true}]',
    '[{"type":"knowledge_deflection"},{"type":"approval","policy":"manager_or_owner"},{"type":"automation","tool":"identity.assign_access","fallback":"task"}]',
    'Identity Governance',
    'Identity Operations',
    'Resolve access intent, identify the application, ask only for missing access level and justification, then submit the access request.'
  ),
  (
    'request-hardware',
    'Request Hardware',
    'Request a laptop, peripheral, replacement, or loaner device with asset and procurement context.',
    'Hardware',
    'hardware_request',
    '[{"key":"hardwareType","label":"Hardware type","type":"select","options":["laptop","monitor","keyboard","mouse","loaner","replacement"],"required":true},{"key":"neededBy","label":"Needed by","type":"date"},{"key":"reason","label":"Reason","type":"textarea","required":true}]',
    '[{"type":"entitlement_check"},{"type":"asset_pool_check"},{"type":"procurement_or_fulfillment_task"}]',
    'IT Asset Management',
    'Endpoint Services',
    'Collect hardware need, urgency, location, and reason. Prefer available asset pool before procurement.'
  ),
  (
    'report-technology-issue',
    'Report a Technology Issue',
    'Start with knowledge and health checks, then create an incident only when self-service cannot resolve the issue.',
    'Help',
    'incident_intake',
    '[{"key":"impact","label":"What is affected?","type":"textarea","required":true},{"key":"urgency","label":"Urgency","type":"select","options":["low","medium","high","critical"],"required":true},{"key":"service","label":"Service or application","type":"text"}]',
    '[{"type":"knowledge_deflection"},{"type":"health_check"},{"type":"incident_create","when":"not_deflected"}]',
    'Service Desk',
    'Platform Operations',
    'Deflect with knowledge and service health first. Create an incident only when the user still needs human or automated support.'
  )
ON CONFLICT (key) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  questions = EXCLUDED.questions,
  fulfillment = EXCLUDED.fulfillment,
  updated_at = NOW();

INSERT INTO support_channels (name, channel_type, description, target, priority, rules, integration_config)
VALUES
  ('Service Desk Callback', 'callback', 'Offer a callback when AI confidence is low, urgency is high, or the user asks for human help.', 'service-desk-callback', 10, '{"urgency":["high","critical"],"intent":["incident_intake","access_request"]}', '{"adapter":"generic-callback","externalTargetEnv":"SERVICE_DESK_CALLBACK_URL"}'),
  ('Cisco UCM Help Desk Queue', 'phone', 'Placeholder adapter for Cisco UCM/contact-center routing with screen-pop context.', 'cisco-ucm-helpdesk', 20, '{"enabledWhen":"integration_configured"}', '{"adapter":"cisco-ucm","targetUrlEnv":"CISCO_UCM_URL","queueIdEnv":"CISCO_UCM_HELPDESK_QUEUE"}'),
  ('Portal Chat Escalation', 'chat', 'Escalate the conversation to a live support queue with the AI context packet attached.', 'portal-live-chat', 30, '{"intent":["any"]}', '{"adapter":"internal-chat"}')
ON CONFLICT DO NOTHING;

INSERT INTO number_sequences (app_id, table_name, record_type, prefix, next_value, padding)
VALUES ('customer-portal', 'catalog_requests', 'Catalog Request', 'REQ', 1, 6)
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO app_permissions (role, resource, action)
VALUES
  ('admin', 'customer-portal', 'read'),
  ('admin', 'customer-portal', 'write'),
  ('security_admin', 'customer-portal', 'read'),
  ('security_admin', 'customer-portal', 'write'),
  ('operator', 'customer-portal', 'read'),
  ('operator', 'customer-portal', 'write')
ON CONFLICT DO NOTHING;

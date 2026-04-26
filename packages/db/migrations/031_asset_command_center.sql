CREATE TABLE IF NOT EXISTS asset_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_tag VARCHAR(120),
    serial_number VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(80) NOT NULL DEFAULT 'hardware',
    asset_type VARCHAR(80) NOT NULL DEFAULT 'device',
    status VARCHAR(80) NOT NULL DEFAULT 'inbox',
    lifecycle_state VARCHAR(80) NOT NULL DEFAULT 'identified',
    manufacturer VARCHAR(255),
    model VARCHAR(255),
    assigned_to UUID REFERENCES users(id),
    owner_group VARCHAR(255),
    location VARCHAR(255),
    ci_id VARCHAR(255),
    cost NUMERIC(12, 2),
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    purchase_order VARCHAR(255),
    invoice_ref VARCHAR(255),
    contract_id UUID,
    warranty_expires_at TIMESTAMPTZ,
    acquisition_date TIMESTAMPTZ,
    disposal_date TIMESTAMPTZ,
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 0.50,
    evidence_score NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(asset_tag),
    UNIQUE(serial_number)
);

CREATE TABLE IF NOT EXISTS asset_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    vendor VARCHAR(255),
    contract_type VARCHAR(80) NOT NULL DEFAULT 'software',
    status VARCHAR(80) NOT NULL DEFAULT 'active',
    source VARCHAR(80) NOT NULL DEFAULT 'manual',
    source_ref VARCHAR(255),
    document_name VARCHAR(255),
    extracted_summary TEXT,
    ai_confidence NUMERIC(5, 2) NOT NULL DEFAULT 0,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    renewal_at TIMESTAMPTZ,
    annual_cost NUMERIC(12, 2),
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE asset_records
  ADD CONSTRAINT fk_asset_records_contract
  FOREIGN KEY (contract_id) REFERENCES asset_contracts(id);

CREATE TABLE IF NOT EXISTS software_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES asset_contracts(id) ON DELETE SET NULL,
    publisher VARCHAR(255) NOT NULL,
    product VARCHAR(255) NOT NULL,
    sku VARCHAR(255),
    metric VARCHAR(80) NOT NULL DEFAULT 'user',
    quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
    consumed NUMERIC(12, 2) NOT NULL DEFAULT 0,
    rights JSONB NOT NULL DEFAULT '{}',
    constraints JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(80) NOT NULL DEFAULT 'active',
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 0.50,
    source_citation TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS software_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher VARCHAR(255) NOT NULL,
    product VARCHAR(255) NOT NULL,
    normalized_product VARCHAR(255),
    version VARCHAR(120),
    metric VARCHAR(80) NOT NULL DEFAULT 'install',
    quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
    user_id UUID REFERENCES users(id),
    asset_id UUID REFERENCES asset_records(id) ON DELETE SET NULL,
    ci_id VARCHAR(255),
    source VARCHAR(80) NOT NULL DEFAULT 'discovery',
    source_ref VARCHAR(255),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID REFERENCES asset_records(id) ON DELETE CASCADE,
    contract_id UUID REFERENCES asset_contracts(id) ON DELETE CASCADE,
    entitlement_id UUID REFERENCES software_entitlements(id) ON DELETE CASCADE,
    evidence_type VARCHAR(80) NOT NULL,
    source VARCHAR(80) NOT NULL,
    source_ref VARCHAR(255),
    payload JSONB NOT NULL DEFAULT '{}',
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 0.50,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_scan_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID REFERENCES asset_records(id) ON DELETE SET NULL,
    scan_type VARCHAR(80) NOT NULL DEFAULT 'barcode',
    value VARCHAR(255) NOT NULL,
    action VARCHAR(80) NOT NULL DEFAULT 'verify',
    location VARCHAR(255),
    condition VARCHAR(80),
    scanned_by UUID REFERENCES users(id),
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_reconciliation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(80) NOT NULL DEFAULT 'sam',
    status VARCHAR(80) NOT NULL DEFAULT 'completed',
    summary TEXT,
    risk_score NUMERIC(8, 2) NOT NULL DEFAULT 0,
    savings_estimate NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID REFERENCES asset_reconciliation_runs(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES asset_records(id) ON DELETE SET NULL,
    entitlement_id UUID REFERENCES software_entitlements(id) ON DELETE SET NULL,
    usage_id UUID REFERENCES software_usage(id) ON DELETE SET NULL,
    type VARCHAR(80) NOT NULL,
    severity VARCHAR(80) NOT NULL DEFAULT 'medium',
    status VARCHAR(80) NOT NULL DEFAULT 'open',
    title VARCHAR(255) NOT NULL,
    detail TEXT,
    financial_impact NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_records_status ON asset_records(status);
CREATE INDEX IF NOT EXISTS idx_asset_records_category ON asset_records(category);
CREATE INDEX IF NOT EXISTS idx_asset_records_ci_id ON asset_records(ci_id);
CREATE INDEX IF NOT EXISTS idx_asset_contracts_vendor ON asset_contracts(vendor);
CREATE INDEX IF NOT EXISTS idx_entitlements_product ON software_entitlements(publisher, product);
CREATE INDEX IF NOT EXISTS idx_usage_product ON software_usage(publisher, product);
CREATE INDEX IF NOT EXISTS idx_asset_exceptions_status ON asset_exceptions(status, severity);
CREATE INDEX IF NOT EXISTS idx_asset_scan_value ON asset_scan_events(value);

INSERT INTO app_permissions (role, resource, action) VALUES
  ('viewer', 'asset-command', 'read'),
  ('operator', 'asset-command', 'read'),
  ('operator', 'asset-command', 'write'),
  ('admin', 'asset-command', 'read'),
  ('admin', 'asset-command', 'write'),
  ('admin', 'asset-command', 'govern'),
  ('security_admin', 'asset-command', 'read'),
  ('security_admin', 'asset-command', 'write'),
  ('security_admin', 'asset-command', 'govern'),
  ('incident_manager', 'asset-command', 'read'),
  ('change_manager', 'asset-command', 'read')
ON CONFLICT (role, resource, action) DO NOTHING;

COMMENT ON TABLE asset_records IS 'Evidence-backed hardware, software, cloud, and entitlement-adjacent asset records';
COMMENT ON TABLE software_entitlements IS 'SAM entitlement records extracted from contracts, purchases, and publisher data';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Core ITSM queue and timeline access paths.
CREATE INDEX IF NOT EXISTS idx_incidents_queue ON incidents(status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_severity_queue ON incidents(severity, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_owner ON incidents(owner_id);
CREATE INDEX IF NOT EXISTS idx_incidents_commander ON incidents(commander_id);
CREATE INDEX IF NOT EXISTS idx_incidents_requester_created ON incidents(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_events_actor ON incident_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_incident_actions_approved_by ON incident_actions(approved_by);
CREATE INDEX IF NOT EXISTS idx_incident_postmortems_incident ON incident_postmortems(incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_postmortems_generated_by ON incident_postmortems(generated_by);
CREATE INDEX IF NOT EXISTS idx_incident_roles_user ON incident_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_change_requests_status_created ON change_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_requests_planned_window ON change_requests(COALESCE(planned_start_at, scheduled_at), status);
CREATE INDEX IF NOT EXISTS idx_change_requests_approver ON change_requests(approver_id);
CREATE INDEX IF NOT EXISTS idx_change_request_comments_user ON change_request_comments(user_id);

-- Engage / Customer Portal work queues and request timelines.
CREATE INDEX IF NOT EXISTS idx_catalog_requests_queue ON catalog_requests(status, priority, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_catalog_requests_item ON catalog_requests(catalog_item_id);
CREATE INDEX IF NOT EXISTS idx_catalog_requests_support_channel ON catalog_requests(support_channel_id);
CREATE INDEX IF NOT EXISTS idx_catalog_request_events_request ON catalog_request_events(request_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_catalog_request_events_actor ON catalog_request_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_support_handoffs_channel ON support_handoffs(channel_id);
CREATE INDEX IF NOT EXISTS idx_support_handoffs_request ON support_handoffs(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_handoffs_incident ON support_handoffs(incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_handoffs_requester ON support_handoffs(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_handoffs_status ON support_handoffs(status, created_at DESC);

-- Knowledge command center and self-service search.
CREATE INDEX IF NOT EXISTS idx_knowledge_items_owner ON knowledge_items(owner_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_published_quality ON knowledge_items(status, trust_score DESC, reuse_count DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_events_knowledge ON knowledge_events(knowledge_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_knowledge_events_actor ON knowledge_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_feedback_user ON knowledge_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_proposed ON knowledge_gaps(proposed_knowledge_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_open_demand ON knowledge_gaps(status, demand_count DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_title_trgm ON knowledge_items USING GIN (LOWER(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_summary_trgm ON knowledge_items USING GIN (LOWER(COALESCE(summary, '')) gin_trgm_ops);
-- Full article-body search should move to a dedicated search index before enterprise-scale content volume.

-- Discovery pipeline execution, staging, and scheduler access paths.
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_source ON discovery_jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_status_created ON discovery_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_pipeline_schedules_last_job ON discovery_pipeline_schedules(last_discovery_job_id);
CREATE INDEX IF NOT EXISTS idx_discovery_staged_records_job_status ON discovery_staged_records(discovery_job_id, status);
CREATE INDEX IF NOT EXISTS idx_discovery_staged_relationships_job_status ON discovery_staged_relationships(discovery_job_id, status);
CREATE INDEX IF NOT EXISTS idx_reconciliation_logs_job ON reconciliation_logs(discovery_job_id);

-- Asset/SAM/HAM reconciliation joins and exception review.
CREATE INDEX IF NOT EXISTS idx_asset_records_assigned_to ON asset_records(assigned_to);
CREATE INDEX IF NOT EXISTS idx_asset_records_contract ON asset_records(contract_id);
CREATE INDEX IF NOT EXISTS idx_asset_records_lifecycle ON asset_records(lifecycle_state, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_evidence_asset ON asset_evidence(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_evidence_contract ON asset_evidence(contract_id);
CREATE INDEX IF NOT EXISTS idx_asset_evidence_entitlement ON asset_evidence(entitlement_id);
CREATE INDEX IF NOT EXISTS idx_asset_exceptions_run ON asset_exceptions(run_id);
CREATE INDEX IF NOT EXISTS idx_asset_exceptions_asset ON asset_exceptions(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_exceptions_entitlement ON asset_exceptions(entitlement_id);
CREATE INDEX IF NOT EXISTS idx_asset_exceptions_usage ON asset_exceptions(usage_id);
CREATE INDEX IF NOT EXISTS idx_asset_reconciliation_runs_created_by ON asset_reconciliation_runs(created_by);
CREATE INDEX IF NOT EXISTS idx_asset_scan_events_asset ON asset_scan_events(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_scan_events_scanned_by ON asset_scan_events(scanned_by);
CREATE INDEX IF NOT EXISTS idx_software_entitlements_contract ON software_entitlements(contract_id);
CREATE INDEX IF NOT EXISTS idx_software_usage_asset ON software_usage(asset_id);
CREATE INDEX IF NOT EXISTS idx_software_usage_user ON software_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_software_usage_ci_last_seen ON software_usage(ci_id, last_seen_at DESC);

-- DCIM floorplan, event, and capacity joins.
CREATE INDEX IF NOT EXISTS idx_dcim_power_paths_rack ON dcim_power_paths(rack_id);
CREATE INDEX IF NOT EXISTS idx_dcim_power_paths_site ON dcim_power_paths(site_id);
CREATE INDEX IF NOT EXISTS idx_dcim_events_site ON dcim_events(site_id);
CREATE INDEX IF NOT EXISTS idx_dcim_events_room ON dcim_events(room_id);
CREATE INDEX IF NOT EXISTS idx_dcim_events_asset ON dcim_events(asset_id);
CREATE INDEX IF NOT EXISTS idx_dcim_events_open_last_seen ON dcim_events(status, severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_dcim_racks_capacity ON dcim_racks(room_id, risk_score ASC, power_used_kw ASC, ru_used ASC);

-- Prevention Center joins and timelines.
CREATE INDEX IF NOT EXISTS idx_prevention_records_owner ON prevention_records(owner_id);
CREATE INDEX IF NOT EXISTS idx_prevention_records_known_error ON prevention_records(known_error_id);
CREATE INDEX IF NOT EXISTS idx_prevention_actions_prevention ON prevention_actions(prevention_id);
CREATE INDEX IF NOT EXISTS idx_prevention_events_prevention ON prevention_events(prevention_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_prevention_events_actor ON prevention_events(actor_id);

-- Platform administration and package lifecycle references.
CREATE INDEX IF NOT EXISTS idx_app_installations_installed_by ON app_installations(installed_by);
CREATE INDEX IF NOT EXISTS idx_app_provisioning_jobs_requested_by ON app_provisioning_jobs(requested_by);
CREATE INDEX IF NOT EXISTS idx_marketplace_apps_reviewed_by ON marketplace_apps(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_record_numbers_sequence ON record_numbers(sequence_id);
CREATE INDEX IF NOT EXISTS idx_ci_classes_parent_class ON ci_classes(parent_class);
CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(type, created_at DESC);

-- Fast fuzzy table search for common operational tables.
CREATE INDEX IF NOT EXISTS idx_incidents_title_trgm ON incidents USING GIN (LOWER(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_incidents_description_trgm ON incidents USING GIN (LOWER(COALESCE(description, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_change_requests_title_trgm ON change_requests USING GIN (LOWER(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_change_requests_description_trgm ON change_requests USING GIN (LOWER(COALESCE(description, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_catalog_requests_title_trgm ON catalog_requests USING GIN (LOWER(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_catalog_requests_description_trgm ON catalog_requests USING GIN (LOWER(COALESCE(description, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_catalog_items_title_trgm ON catalog_items USING GIN (LOWER(title) gin_trgm_ops);

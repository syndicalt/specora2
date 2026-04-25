-- Migration 022: Add impact analysis fields to change management tables

-- Add computed risk fields to change_requests
ALTER TABLE change_requests
  ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blast_radius INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'low';

-- Add per-CI impact metadata to change_request_cis
ALTER TABLE change_request_cis
  ADD COLUMN IF NOT EXISTS distance INTEGER,
  ADD COLUMN IF NOT EXISTS direction VARCHAR(20),
  ADD COLUMN IF NOT EXISTS contribution FLOAT;

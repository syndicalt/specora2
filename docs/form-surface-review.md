# Form Surface Review

**Status:** Current UX review
**Last updated:** 2026-04-26

This review grades Specora's current structured editing surfaces against the platform north-star philosophy:

- Low-friction engineering, not low-code sprawl.
- Conversation-first and evidence-first, not form-first.

Forms are still necessary for stewardship, administration, accessibility, and exception handling. The goal is not to eliminate forms. The goal is to use forms as precise fallback and governance surfaces rather than the primary way users create operational work.

## Grading Scale

- 5: Production-class and strategically aligned.
- 4: Strong beta quality with clear extension path.
- 3: Useful but limited, inconsistent, or missing important controls.
- 2: Basic or mostly demo-level.
- 1: Not suitable for production use.

## Summary

| Surface | Extensibility | Customizability | Accessibility | Usefulness | Overall |
| --- | ---: | ---: | ---: | ---: | --- |
| Tables record editor | 4 | 3 | 4 | 4 | B+ |
| Discovery builder forms | 4 | 4 | 3 | 5 | A- |
| Admin Console forms | 3 | 3 | 3 | 4 | B |
| DCIM inspectors/editors | 3 | 3 | 4 | 4 | B |
| CI Class Manager | 5 | 5 | 3 | 5 | A- |
| Service Map CI edit modal | 4 | 3 | 3 | 4 | B |
| Data Foundations stewardship edit | 3 | 2 | 3 | 4 | B- |
| Incident, Change, Knowledge, Asset, Prevention | 2 | 2 | 3 | 5 | B+ philosophically |

## Findings

### Tables

Tables is the closest thing Specora has to a universal record stewardship surface.

Strengths:

- Metadata-driven editor for CMDB classes and PostgreSQL-backed operational tables.
- Column picker and filter builder exist.
- ID/number behavior is guarded from manual entry.
- Typed widgets exist for strings, numbers, booleans, dates, and enums.
- It has meaningful E2E coverage for create, edit, filter, and delete.

Gaps:

- No saved views.
- No bulk selection or bulk action foundation.
- No inline edit.
- No record audit/history panel.
- Validation is mostly save-time toast behavior, not field-level.
- Reference, JSON, datetime, and relationship-aware field widgets need more depth.

Recommendation:

Make Tables the platform stewardship cockpit. It should own saved views, advanced filters, column sets, validation states, inline edit, bulk review, audit diff, export/import, relationship-aware filtering, and AI-assisted cleanup.

### Discovery

Discovery is the best example of the desired "forms only where precision is needed" model.

Strengths:

- Source forms, mapping editors, relationship editors, trigger schedule controls, preview, stage, and commit fit a governed builder workflow.
- The React Flow canvas is becoming a real builder rather than just decoration.
- AI draft plus human review matches the evidence-first model.
- Missing relationship targets and reconciliation state are surfaced.

Gaps:

- Accessibility is uneven in dense mapping editors.
- Some controls are compact and may be hard to operate with keyboard-only workflows.
- Saved mapping profiles and credential workflows are still missing.
- Field-level rationale and validation should be richer.

Recommendation:

Keep Discovery as a builder/staging workflow, not a generic form page. Add mapping profiles, credential-backed source forms, stronger validation, keyboard checks, and better per-field explanation.

### Admin Console

Admin Console is improving, especially with Access Analyzer and registry-backed number sequences.

Strengths:

- Access Analyzer is the right primary workflow for RBAC troubleshooting.
- Number sequences now use registered app/table/record type lists.
- Admin is a full-page app, which is better than a cramped modal/window.
- Package provisioning and state machine panels are teachable.

Gaps:

- Add Permission still accepts raw role/resource/action strings.
- System properties are raw key/value edits with little validation.
- High-risk permission grants need stronger guardrails and confirmation.
- Some icon actions lack explicit accessible names.

Recommendation:

Replace raw RBAC grant creation with registry-backed selectors and analyzer-first flows. Add high-risk permission warnings, duplicate detection, explain-before-grant behavior, and validation for known system properties.

### CI Class Manager

CI Class Manager is the strongest configuration form surface.

Strengths:

- It defines the schema that drives downstream forms.
- Supports display names, parent class, icon, color, ordered attributes, type selection, enum values, references, regex validation, mandatory fields, health-required flags, and key attributes.
- This is a good example of governed declarative configuration rather than low-code sprawl.

Gaps:

- Accessibility can improve with explicit `htmlFor` / `id` label association and keyboard-friendly attribute reordering.
- Regex validation should provide test examples or live validation.
- Attribute changes need stronger impact warnings because they affect tables, discovery, health, and validation.

Recommendation:

Keep this as the authoritative schema builder. Improve accessibility, impact preview, and validation testing.

### DCIM

DCIM forms are useful inspectors for a spatial/domain-specific app.

Strengths:

- Rack, object, and connection editors are concise and domain-oriented.
- Numeric and select controls are appropriate for the current data model.
- E2E coverage exists for floorplan object create/edit/remove.

Gaps:

- Editors are not deeply extensible.
- Spatial editing needs richer direct-manipulation controls if DCIM returns to active development.
- Connection semantics should become more domain-specific for power/network/cooling.
- Field validation is basic.

Recommendation:

Keep the current forms as inspectors, but do not over-invest until the dedicated floorplan engine decision is revisited.

### Service Map

Service Map edit flows are useful but remain local to the service-map experience.

Strengths:

- Class metadata drives attribute groups.
- Required, key, operational, additional, and advanced JSON groups are useful.
- The modal supports validation for mandatory attributes and advanced JSON.

Gaps:

- Should share field rendering with Tables.
- Accessibility can improve around section toggles and field errors.
- Relationship editing remains separate and not unified with a platform field model.

Recommendation:

Adopt the shared field renderer once Tables has it extracted. Keep Service Map as a graph-first editor, not a table replacement.

### Data Foundations

Data Foundations is conceptually strong but editing is too narrow.

Strengths:

- The stewardship queue model fits the evidence-first philosophy.
- It routes users to Tables for broader management.
- It can update individual foundation issue fields.

Gaps:

- The edit panel only captures a single field value.
- It does not show enough current-value, suggested-value, confidence, or rationale context.
- No explicit skip/resolve/defer workflow.
- No batch stewardship.

Recommendation:

Turn issue editing into a stewardship decision surface: current value, suggested value, reason, confidence, apply, skip, defer, open in Tables, and batch review.

### ITSM Command Apps

Incident, Change, Knowledge, Asset, and Prevention are intentionally not form-heavy.

Strengths:

- They use queues, evidence, AI actions, chat orchestration, approvals, and lifecycle controls.
- This is aligned with the north-star philosophy.
- Blank-form creation is not the primary workflow.

Gaps:

- Precise fallback editors are limited or absent.
- Some commands depend heavily on seeded data or tool routes.
- Accessibility around dense command cards and action buttons should be reviewed.

Recommendation:

Keep them evidence-first. Add fallback structured editors only where needed for correction, governance, or exception handling.

## Cross-Cutting Accessibility Gaps

- Icon-only buttons need explicit `aria-label` values.
- Field-level errors should be visible and associated with fields.
- Custom boolean/toggle buttons should expose appropriate pressed/checked state.
- Graph/canvas-heavy apps need keyboard navigation and focus testing.
- Dense side panels need predictable focus return on close/save.
- Some labels are visually present but not explicitly associated through `htmlFor` / `id`.

## Sprint Priorities

1. Extract a shared field renderer from Tables and CI Class Manager patterns.
2. Use the shared renderer in Tables first.
3. Add saved views and stronger filter persistence to Tables.
4. Add bulk selection foundation to Tables.
5. Replace Admin raw RBAC grant inputs with registry-backed selectors.
6. Improve Data Foundations issue edit context and actions.
7. Add accessibility smoke checks for Tables, Admin, Discovery, and DCIM editor paths.

## Product Guardrail

Do not turn these improvements into a generic low-code/no-code platform. The correct direction is governed, typed, auditable configuration for bounded domains, with serious behavior implemented as reviewed code.

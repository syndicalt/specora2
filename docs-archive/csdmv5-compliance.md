# CSDMv5 Compliance and Alignment

**Status:** CSDM-aligned implementation guide
**Last updated:** 2026-04-26

Specora is CSDMv5-aligned, not ServiceNow-certified. CSDM is a ServiceNow-owned model; Specora uses the same service-modeling principles because they are useful for a graph-native ITSM platform. The goal is to preserve the operational discipline of CSDM while implementing it in an open, AI-native architecture.

Primary reference points:

- ServiceNow CSDM conceptual model: https://www.servicenow.com/docs/r/servicenow-platform/common-service-data-model-csdm/csdm-conceptual-model.html
- ServiceNow CSDM glossary: https://www.servicenow.com/docs/r/servicenow-platform/common-service-data-model-csdm/csdm-term-definitions.html
- ServiceNow Foundation domain: https://www.servicenow.com/docs/r/servicenow-platform/common-service-data-model-csdm/foundation-domain.html

## Compliance Position

Specora currently implements a practical CSDM subset:

- Foundation data: users, groups, locations, ownership references
- Service consumption concepts: business services
- Service delivery concepts: application services / service instances
- Technical service concepts: technical services
- Build and integrate concepts: applications
- Infrastructure CIs: servers, databases, network gear
- Operational workflows: Change, Incident, Knowledge, Prevention, Asset, Discovery, Health

Specora does not claim complete CSDM table parity. It intentionally avoids copying every ServiceNow table. Instead, it maps CSDM concepts to a graph data model and platform workflows.

## Implemented CI Classes

| Specora class | CSDM alignment | Current role |
| --- | --- | --- |
| `ConfigurationItem` | Base CMDB CI concept | Shared label for all graph CIs |
| `BusinessService` | Business service / consumption-facing service | User-facing service impact and ownership |
| `ApplicationService` | Service instance / deployed application stack | Operational service instance used in Incident, Change, Health, Discovery |
| `TechnicalService` | Provider-focused technical service | Technology services that support application and business services |
| `Application` | Application / build-and-integrate concept | Deployed software capability and ownership |
| `Server` | Infrastructure CI | Compute host and asset-adjacent CI |
| `Database` | Infrastructure/application component CI | Data service dependency |
| `NetworkGear` | Infrastructure CI | Network device dependencies |
| `User` | Foundation/person data | Owner and user reference data |
| `Group` | Foundation/group data | Assignment, management, and approval groups |
| `Location` | Foundation/location data | Geography, datacenter, cloud zone, edge location |

## Implemented Relationships

| Relationship | Intended meaning | Examples |
| --- | --- | --- |
| `PART_OF` | Composition or membership | User part of group; application service part of application |
| `DEPENDS_ON` | Runtime or service dependency | Business service depends on application service |
| `HOSTED_ON` | Hosting relationship | Application hosted on server; database hosted on server |
| `MANAGED_BY` | Operational management responsibility | Technical service managed by group |
| `OWNED_BY` | Accountability / service ownership | Business service owned by user |
| `LOCATED_AT` | Location reference | Server or network gear located at location |

The API validates relationship types against the allowlist. Arbitrary relationship strings are not accepted.

## CSDM Domains

### Foundation

Implemented:

- `User`
- `Group`
- `Location`
- Postgres `users`
- Data Foundations app
- Tables app for RBAC-aware table access

Partially implemented / roadmap:

- Company
- Department
- Business unit
- Cost center
- Product model
- Contract as foundation data

Theory: foundation data should be accurate before the CMDB can be trusted. Specora treats Data Foundations and Tables as operational tools for stewards rather than passive reference lists.

### Design / Build and Integrate

Implemented:

- `Application`
- Application ownership
- Repository and deployment attributes in demo data
- CI Class Manager for class evolution

Partially implemented / roadmap:

- Business application portfolio hierarchy
- Product and capability modeling
- Architecture ownership and lifecycle governance

Theory: design data should explain why services exist. Specora currently models the deployed application more strongly than the upstream design portfolio.

### Service Delivery

Implemented:

- `ApplicationService`
- Environment-specific service instances
- Relationship to applications, databases, technical services, and business services
- Service Map and CMDB Explorer
- Change and Incident workflows using service context

Partially implemented / roadmap:

- Service offerings
- SLAs and commitments as first-class records
- Formal dynamic service population rules

Theory: application services are the operational center of gravity. Incidents, changes, health, and discovery should converge here.

### Service Consumption

Implemented:

- `BusinessService`
- Ownership and dependency to application services
- Impact analysis through graph traversal

Partially implemented / roadmap:

- Request catalog
- Business service offerings
- Consumer-facing service commitments

Theory: business services are where technical impact becomes business impact. They should be one-level consumer-focused services, not arbitrary nested hierarchies.

### Manage Technical Services

Implemented:

- `TechnicalService`
- Provider-focused technology services
- Managed-by group relationships
- Dependencies to network and application-service contexts

Partially implemented / roadmap:

- More explicit technology service ownership model
- Technical service offerings
- Operational health rollups by technical service

Theory: technical services explain provider accountability. They should make infrastructure health intelligible without exposing every low-level component to business users.

## Operational Workflow Compliance

CSDM becomes valuable when operational apps use it consistently.

| Workflow | Current CSDM use |
| --- | --- |
| Change | RFCs reference primary and affected CIs; risk scoring uses dependencies and blast radius |
| Incident | Incidents reference services and CIs; triage can use related CIs, related changes, and health context |
| Knowledge | Knowledge items can link to CIs, incidents, changes, and known errors |
| Prevention | Prevention records link recurring incidents, known errors, CIs, and corrective actions |
| Asset | Assets and software usage can reference CIs while financial/lifecycle state stays in Postgres |
| Discovery | Discovery creates/updates CI data and pipelines transform source records toward target classes |
| Health | Health rules evaluate graph completeness, stale data, relationships, and quality signals |
| IT Visibility DCIM | Physical sites, rooms, racks, assets, power paths, floorplans, and facility events extend infrastructure visibility while referencing operational CIs where appropriate |

## Demo Data Compliance

The demo graph seed creates 5,000 CIs:

| Class | Count |
| --- | ---: |
| Location | 20 |
| Group | 20 |
| User | 60 |
| BusinessService | 80 |
| ApplicationService | 600 |
| TechnicalService | 160 |
| Application | 520 |
| Database | 720 |
| NetworkGear | 240 |
| Server | 2,580 |

The current generated relationship count is 13,350.

The demo data intentionally covers:

- Foundation records
- Service ownership
- Business-service-to-application-service impact paths
- Application-service-to-application composition
- Database and server hosting
- Managed-by groups
- Located-at infrastructure
- Stable CI IDs for cross-app operational seeds

## Compliance Mark

| Area | Current mark | Notes |
| --- | ---: | --- |
| CSDM vocabulary | 4 / 5 | Strong subset with clear service and infrastructure classes |
| Foundation data | 3 / 5 | Users/groups/locations present; more enterprise reference data needed |
| Service modeling | 4 / 5 | Business, application, and technical services represented |
| Relationship discipline | 4 / 5 | Allowlisted relationship types and deterministic graph seed |
| Operational workflow use | 4 / 5 | Change, Incident, Knowledge, Prevention, Asset, Discovery, and Health use CI references |
| Full CSDM breadth | 2 / 5 | Not full ServiceNow table parity; offerings, portfolio, and contracts need expansion |

Overall CSDM alignment: **21 / 30**.

## Compliance Roadmap

Priority work:

- Add more foundation classes: Company, Department, Business Unit, Cost Center, Contract, Product Model.
- Add service offerings and SLAs.
- Add business application / product portfolio modeling.
- Add lifecycle states aligned to logical vs hardware CI behavior.
- Add formal data quality gates per class.
- Add CSDM validation reports in Data Foundations.
- Add service rollups from technical service to application service to business service.
- Clarify the boundary between CSDM infrastructure CIs and DCIM/ITAM operational records so physical facility data enriches the CMDB without duplicating graph topology.

## Rules for Future Development

- New CI classes must be registered through CI Class Manager and seeded with clear attributes.
- New relationship types require API allowlist updates and documentation.
- Operational tables should reference CIs by stable `ci_id`; they should not duplicate graph topology.
- Apps should prefer service context over isolated record views.
- Demo data should tell cross-domain stories, not create disconnected rows.

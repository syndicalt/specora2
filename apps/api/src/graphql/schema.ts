import { makeExecutableSchema } from "@graphql-tools/schema";
import { resolvers } from "./resolvers";

const typeDefs = `
  scalar JSON

  type ConfigurationItem {
    id: ID!
    name: String!
    class: String!
    environment: String
    attributes: JSON
    relationships: [Relationship!]!
    dataQualityScore: Float
    lastDiscoveredAt: String
    health: CSDMV5HealthScore
  }

  type Relationship {
    id: ID!
    type: String!
    target: ConfigurationItem!
    attributes: JSON
  }

  type ServiceMapEdge {
    id: ID!
    type: String!
    sourceId: ID!
    targetId: ID!
  }

  type ServiceMap {
    root: ConfigurationItem!
    nodes: [ConfigurationItem!]!
    edges: [ServiceMapEdge!]!
  }

  type DependencyPath {
    nodes: [ConfigurationItem!]!
    edges: [ServiceMapEdge!]!
  }

  type IngestionJob {
    jobId: ID!
    status: String!
  }

  type DiscoverySource {
    id: ID!
    name: String!
    type: String!
    config: JSON
    credentialRef: String
    lastTestedAt: String
    lastStatus: String
    lastError: String
    createdAt: String!
    updatedAt: String
  }

  type DiscoveryJob {
    id: ID!
    sourceId: ID
    filePath: String
    status: String!
    stats: JSON
    createdAt: String!
    updatedAt: String!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    preferences: JSON
    role: String!
    authMethod: String!
    canChangePassword: Boolean!
    passwordChangeRequired: Boolean!
  }

  type MarketplaceApp {
    id: ID!
    name: String!
    description: String
    url: String!
    icon: String!
    version: String!
    permissions: [String!]!
    reactVersion: String!
    author: String!
    authorUrl: String
    status: String!
    createdAt: String!
  }

  type SavedView {
    id: ID!
    name: String!
    rootId: String!
    classFilter: [String!]!
    environmentFilter: [String!]!
    relationshipFilter: [String!]!
    cameraX: Float
    cameraY: Float
    cameraZoom: Float
    createdAt: String!
    updatedAt: String!
  }

  type CSDMV5HealthScore {
    freshness: Float
    completeness: Float
    relationshipValidity: Float
    overall: Float
  }

  type AuditLogEntry {
    id: ID!
    actorId: ID
    action: String!
    entityType: String!
    entityId: String!
    oldValues: JSON
    newValues: JSON
    metadata: JSON
    createdAt: String!
  }

  type CIClassAttribute {
    id: ID!
    name: String!
    displayName: String!
    description: String
    attrType: String!
    isMandatory: Boolean!
    isHealthRequired: Boolean!
    isKeyAttribute: Boolean!
    defaultValue: String
    validationRegex: String
    enumValues: [String!]
    referenceClass: String
    sortOrder: Int!
  }

  type CIClass {
    id: ID!
    name: String!
    displayName: String!
    description: String
    parentClass: String
    icon: String
    color: String
    displayField: String
    secondaryDisplayFields: [String!]!
    isSystem: Boolean!
    createdByAppId: String
    attributes: [CIClassAttribute!]!
    inheritedAttributes: [CIClassAttribute!]!
    createdAt: String!
    updatedAt: String!
  }

  type CIEnvironmentChoice {
    id: ID!
    code: String!
    name: String!
    active: Boolean!
    sortOrder: Int!
    isProductionLike: Boolean!
    createdAt: String!
    updatedAt: String!
  }

  type RelationshipType {
    id: ID!
    name: String!
    displayName: String!
    description: String
    color: String!
    active: Boolean!
    directed: Boolean!
    isSystem: Boolean!
    sortOrder: Int!
    createdAt: String!
    updatedAt: String!
  }

  input RelationshipTypeInput {
    name: String!
    displayName: String!
    description: String
    color: String
    active: Boolean
    directed: Boolean
    sortOrder: Int
  }

  input CIEnvironmentChoiceInput {
    code: String!
    name: String!
    active: Boolean
    sortOrder: Int
    isProductionLike: Boolean
  }

  input CIClassAttributeInput {
    name: String!
    displayName: String!
    description: String
    attrType: String!
    isMandatory: Boolean
    isHealthRequired: Boolean
    isKeyAttribute: Boolean
    defaultValue: String
    validationRegex: String
    enumValues: [String!]
    referenceClass: String
    sortOrder: Int
  }

  input CreateCIClassInput {
    name: String!
    displayName: String!
    description: String
    parentClass: String
    icon: String
    color: String
    displayField: String
    secondaryDisplayFields: [String!]
    attributes: [CIClassAttributeInput!]!
  }

  input CIFilterInput {
    class: String
    environment: String
    name: String
  }

  input CreateCIInput {
    id: ID
    name: String!
    class: String!
    environment: String
    attributes: JSON
  }

  input UpdateCIInput {
    name: String
    class: String
    environment: String
    attributes: JSON
  }

  input CreateRelationshipInput {
    sourceId: ID!
    targetId: ID!
    type: String!
    attributes: JSON
  }

  type Query {
    ci(id: ID!): ConfigurationItem
    cis(filter: CIFilterInput, limit: Int, offset: Int): [ConfigurationItem!]!
    ciCount(filter: CIFilterInput): Int!
    ciEnvironments: [String!]!
    serviceMap(rootId: ID!, classFilter: [String], environmentFilter: [String], relationshipFilter: [String]): ServiceMap!
    neighbors(nodeId: ID!, types: [String], limit: Int): ServiceMap!
    dependencyPath(fromId: ID!, toId: ID!, maxHops: Int): DependencyPath
    discoverySources: [DiscoverySource!]!
    discoveryJobs: [DiscoveryJob!]!
    discoveryJob(id: ID!): DiscoveryJob
    me: User
    marketplaceApps(status: String): [MarketplaceApp!]!
    marketplaceApp(id: ID!): MarketplaceApp
    savedViews: [SavedView!]!
    savedView(id: ID!): SavedView
    auditLog(entityType: String, entityId: String, limit: Int, offset: Int): [AuditLogEntry!]!
    auditLogForCI(ciId: ID!, limit: Int): [AuditLogEntry!]!
    ciClasses: [CIClass!]!
    ciClass(name: String!): CIClass
    ciEnvironmentChoices(activeOnly: Boolean): [CIEnvironmentChoice!]!
    relationshipTypes(activeOnly: Boolean): [RelationshipType!]!
  }

  type Mutation {
    createCI(input: CreateCIInput!): ConfigurationItem!
    updateCI(id: ID!, input: UpdateCIInput!): ConfigurationItem!
    deleteCI(id: ID!): Boolean!
    createRelationship(input: CreateRelationshipInput!): Relationship!
    deleteRelationship(sourceId: ID!, targetId: ID!, type: String!): Boolean!
    updateRelationship(sourceId: ID!, targetId: ID!, type: String!, newType: String, attributes: JSON): Relationship!
    ingestCMDB(payload: JSON): IngestionJob!
    createDiscoverySource(name: String!, type: String!, config: JSON): DiscoverySource!
    updateDiscoverySource(id: ID!, name: String!, type: String!, config: JSON): DiscoverySource!
    deleteDiscoverySource(id: ID!): Boolean!
    updatePreferences(preferences: JSON!): User!
    updateProfile(name: String!): User!
    changePassword(currentPassword: String!, newPassword: String!): User!
    submitMarketplaceApp(id: ID!, name: String!, description: String, url: String!, icon: String, version: String, permissions: [String!], reactVersion: String, author: String!, authorUrl: String): MarketplaceApp!
    approveMarketplaceApp(id: ID!): MarketplaceApp!
    rejectMarketplaceApp(id: ID!): MarketplaceApp!
    createSavedView(name: String!, rootId: String!, classFilter: [String!], environmentFilter: [String!], relationshipFilter: [String!], cameraX: Float, cameraY: Float, cameraZoom: Float): SavedView!
    updateSavedView(id: ID!, name: String, rootId: String, classFilter: [String!], environmentFilter: [String!], relationshipFilter: [String!], cameraX: Float, cameraY: Float, cameraZoom: Float): SavedView!
    deleteSavedView(id: ID!): Boolean!
    createCIClass(input: CreateCIClassInput!): CIClass!
    updateCIClass(id: ID!, input: CreateCIClassInput!): CIClass!
    deleteCIClass(id: ID!): Boolean!
    upsertCIEnvironmentChoice(input: CIEnvironmentChoiceInput!): CIEnvironmentChoice!
    deleteCIEnvironmentChoice(id: ID!): Boolean!
    upsertRelationshipType(input: RelationshipTypeInput!): RelationshipType!
    deleteRelationshipType(id: ID!): Boolean!
  }
`;

export const schema = makeExecutableSchema({ typeDefs, resolvers });

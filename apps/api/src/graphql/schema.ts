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

  type IngestionJob {
    jobId: ID!
    status: String!
  }

  type DiscoverySource {
    id: ID!
    name: String!
    type: String!
    config: JSON
    createdAt: String!
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

  type CSDMV5HealthScore {
    freshness: Float
    completeness: Float
    relationshipValidity: Float
    overall: Float
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
    cis(filter: CIFilterInput): [ConfigurationItem!]!
    serviceMap(rootId: ID!): ServiceMap!
    discoverySources: [DiscoverySource!]!
    discoveryJobs: [DiscoveryJob!]!
    discoveryJob(id: ID!): DiscoveryJob
  }

  type Mutation {
    createCI(input: CreateCIInput!): ConfigurationItem!
    updateCI(id: ID!, input: UpdateCIInput!): ConfigurationItem!
    deleteCI(id: ID!): Boolean!
    createRelationship(input: CreateRelationshipInput!): Relationship!
    ingestCMDB(payload: JSON): IngestionJob!
    createDiscoverySource(name: String!, type: String!, config: JSON): DiscoverySource!
    deleteDiscoverySource(id: ID!): Boolean!
  }
`;

export const schema = makeExecutableSchema({ typeDefs, resolvers });

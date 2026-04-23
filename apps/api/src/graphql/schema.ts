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
  }

  type Mutation {
    createCI(input: CreateCIInput!): ConfigurationItem!
    updateCI(id: ID!, input: UpdateCIInput!): ConfigurationItem!
    deleteCI(id: ID!): Boolean!
    createRelationship(input: CreateRelationshipInput!): Relationship!
    ingestCMDB(payload: JSON): IngestionJob!
  }
`;

export const schema = makeExecutableSchema({ typeDefs, resolvers });

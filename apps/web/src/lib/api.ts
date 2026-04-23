import { GraphQLClient } from "graphql-request";

const endpoint = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/graphql";
export const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace("/graphql", "") || "http://localhost:4000";

export const graphqlClient = new GraphQLClient(endpoint, {
  headers: () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("specora_token") : null;
    return token ? { Authorization: `Bearer ${token}` } : { Authorization: "" };
  },
});

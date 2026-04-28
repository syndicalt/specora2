import { GraphQLClient } from "graphql-request";
import { authFetch, getToken } from "./auth";
import { getApiBase, getGraphqlEndpoint } from "./runtimeApi";

const endpoint = getGraphqlEndpoint();
export const API_BASE = getApiBase();

export const graphqlClient = new GraphQLClient(endpoint, {
  headers: () => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : { Authorization: "" };
  },
  fetch: (url, init) => authFetch(url, { ...init, cache: "no-store" }),
});

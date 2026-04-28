const LOCAL_API_BASE = "http://localhost:4000";

function stripGraphql(url: string) {
  return url.replace(/\/graphql\/?$/, "").replace(/\/$/, "");
}

function railwayApiBaseFromLocation() {
  if (typeof window === "undefined") return null;
  const { protocol, hostname } = window.location;
  if (!hostname.endsWith(".up.railway.app")) return null;
  if (!hostname.includes("-web-")) return null;
  return `${protocol}//${hostname.replace("-web-", "-api-")}`;
}

export function getApiBase() {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return stripGraphql(configured);
  return railwayApiBaseFromLocation() || LOCAL_API_BASE;
}

export function getGraphqlEndpoint() {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured;
  return `${getApiBase()}/graphql`;
}

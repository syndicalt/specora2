import csv
import json
import os
from neo4j import GraphDatabase
from src.db.postgres_client import postgres_client

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "specora123")

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

CSDMV5_CLASSES = {
    "ConfigurationItem",
    "BusinessService",
    "ApplicationService",
    "TechnicalService",
    "Server",
    "Database",
    "Application",
    "NetworkGear",
    "User",
    "Group",
    "Location",
}


def normalize_row(row: dict) -> dict:
    ci = {
        "id": row.get("id") or row.get("ID") or row.get("Id") or "",
        "name": row.get("name") or row.get("Name") or row.get("NAME") or "",
        "class": row.get("class") or row.get("Class") or row.get("CLASS") or "ConfigurationItem",
        "environment": row.get("environment") or row.get("Environment") or row.get("ENVIRONMENT") or "",
        "attributes": {},
    }
    known = {"id", "name", "class", "environment", "ID", "Name", "Class", "Environment", "NAME", "CLASS", "ENVIRONMENT"}
    for key, value in row.items():
        if key not in known:
            ci["attributes"][key] = value
    if ci["class"] not in CSDMV5_CLASSES:
        ci["class"] = "ConfigurationItem"
    if not ci["id"]:
        ci["id"] = f"discovered-{ci['name']}-{ci['class']}-{ci['environment']}".lower().replace(" ", "-")
    return ci


def read_file(file_path: str) -> list[dict]:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    _, ext = os.path.splitext(file_path)
    if ext.lower() == ".csv":
        with open(file_path, "r", encoding="utf-8") as f:
            return list(csv.DictReader(f))
    elif ext.lower() == ".json":
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            elif isinstance(data, dict):
                return [data]
            raise ValueError("JSON must be an object or array of objects")
    else:
        raise ValueError(f"Unsupported file format: {ext}")


async def reconcile_and_persist(job_id: str, items: list[dict], rules: list[dict]):
    rule_by_class = {r["ci_class"]: r for r in rules}
    stats = {"created": 0, "updated": 0, "unchanged": 0, "errors": 0}

    with driver.session() as session:
        for item in items:
            ci = normalize_row(item)
            rule = rule_by_class.get(ci["class"])
            try:
                existing_id = None

                # 1. Always try to match by explicit id first
                if ci.get("id"):
                    result = session.run(
                        "MATCH (n:ConfigurationItem {id: $id}) RETURN n.id AS id LIMIT 1",
                        {"id": ci["id"]},
                    )
                    record = result.single()
                    if record:
                        existing_id = record["id"]

                # 2. Fallback to reconciliation rule match_keys
                if not existing_id and rule and rule.get("match_keys"):
                    conditions = []
                    params = {}
                    for idx, key in enumerate(rule["match_keys"]):
                        if ci.get(key):
                            conditions.append(f"n.{key} = $m{idx}")
                            params[f"m{idx}"] = ci[key]
                    if conditions:
                        result = session.run(
                            f"MATCH (n:ConfigurationItem) WHERE {' AND '.join(conditions)} RETURN n.id AS id LIMIT 1",
                            params,
                        )
                        record = result.single()
                        if record:
                            existing_id = record["id"]

                if existing_id:
                    session.run(
                        """
                        MATCH (n:ConfigurationItem {id: $id})
                        SET n.name = $name,
                            n.class = $class,
                            n.environment = $environment,
                            n.attributes = $attributes
                        """,
                        {
                            "id": existing_id,
                            "name": ci["name"],
                            "class": ci["class"],
                            "environment": ci["environment"],
                            "attributes": json.dumps(ci["attributes"]),
                        },
                    )
                    stats["updated"] += 1
                    await postgres_client.log_reconciliation(
                        job_id, existing_id, "updated", None, ci
                    )
                else:
                    session.run(
                        """
                        CREATE (n:ConfigurationItem {id: $id, name: $name, class: $class, environment: $environment, attributes: $attributes})
                        """,
                        {
                            "id": ci["id"],
                            "name": ci["name"],
                            "class": ci["class"],
                            "environment": ci["environment"],
                            "attributes": json.dumps(ci["attributes"]),
                        },
                    )
                    stats["created"] += 1
                    await postgres_client.log_reconciliation(
                        job_id, ci["id"], "created", None, ci
                    )
            except Exception as e:
                print(f"Failed to persist CI {ci.get('id')}: {e}")
                stats["errors"] += 1

    return stats


async def handle_discover_file(job_id: str, file_path: str):
    rows = read_file(file_path)
    rules = await postgres_client.get_reconciliation_rules()
    stats = await reconcile_and_persist(job_id, rows, rules)
    try:
        os.remove(file_path)
    except OSError:  # pragma: no cover
        pass
    return stats

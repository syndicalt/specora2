import json
import os
from neo4j import GraphDatabase

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "specora123")

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

async def handle_ingest_cmdb(payload_data: dict):
    try:
        with driver.session() as session:
            for item in payload_data.get("items", []):
                session.run(
                    """
                    MERGE (n:ConfigurationItem {id: $id})
                    SET n.name = $name,
                        n.class = $class,
                        n.environment = $environment,
                        n.attributes = $attributes
                    """,
                    {
                        "id": item["id"],
                        "name": item.get("name", ""),
                        "class": item.get("class", "Unknown"),
                        "environment": item.get("environment", ""),
                        "attributes": json.dumps(item.get("attributes", {})),
                    }
                )
        return "completed"
    except Exception as e:
        print(f"Ingest error: {e}")
        return "failed"

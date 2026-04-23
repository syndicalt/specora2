import os
from neo4j import AsyncGraphDatabase

class Neo4jClient:
    def __init__(self):
        self.driver = AsyncGraphDatabase.driver(
            os.getenv("NEO4J_URI", "bolt://localhost:7687"),
            auth=(
                os.getenv("NEO4J_USER", "neo4j"),
                os.getenv("NEO4J_PASSWORD", "specora123")
            )
        )

    async def close(self):
        await self.driver.close()

neo4j_client = Neo4jClient()

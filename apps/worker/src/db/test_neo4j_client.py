import pytest
from unittest.mock import AsyncMock, patch


@pytest.fixture
def mock_async_graph_db():
    with patch("src.db.neo4j_client.AsyncGraphDatabase") as mock:
        yield mock


@pytest.mark.asyncio
async def test_init_and_close(mock_async_graph_db):
    from src.db.neo4j_client import Neo4jClient
    mock_driver = AsyncMock()
    mock_async_graph_db.driver.return_value = mock_driver

    client = Neo4jClient()
    mock_async_graph_db.driver.assert_called_once()
    await client.close()
    mock_driver.close.assert_awaited_once()

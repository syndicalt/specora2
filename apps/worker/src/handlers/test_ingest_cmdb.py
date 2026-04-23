import pytest
from unittest.mock import MagicMock, patch
import json


@pytest.fixture
def mock_session():
    with patch("src.handlers.ingest_cmdb.driver") as mock_driver:
        session = MagicMock()
        mock_driver.session.return_value.__enter__ = MagicMock(return_value=session)
        mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)
        yield session


@pytest.mark.asyncio
async def test_handle_ingest_cmdb_success(mock_session):
    from src.handlers.ingest_cmdb import handle_ingest_cmdb

    payload = {
        "items": [
            {
                "id": "ci-1",
                "name": "Server A",
                "class": "Server",
                "environment": "Prod",
                "attributes": {"cpu": 4},
            }
        ]
    }
    result = await handle_ingest_cmdb(payload)
    assert result == "completed"
    mock_session.run.assert_called_once()
    args = mock_session.run.call_args
    assert args[0][1]["id"] == "ci-1"
    assert args[0][1]["attributes"] == json.dumps({"cpu": 4})


@pytest.mark.asyncio
async def test_handle_ingest_cmdb_defaults(mock_session):
    from src.handlers.ingest_cmdb import handle_ingest_cmdb

    payload = {"items": [{"id": "ci-2"}]}
    result = await handle_ingest_cmdb(payload)
    assert result == "completed"
    args = mock_session.run.call_args
    assert args[0][1]["name"] == ""
    assert args[0][1]["class"] == "Unknown"
    assert args[0][1]["environment"] == ""
    assert args[0][1]["attributes"] == json.dumps({})


@pytest.mark.asyncio
async def test_handle_ingest_cmdb_empty_items(mock_session):
    from src.handlers.ingest_cmdb import handle_ingest_cmdb

    payload = {"items": []}
    result = await handle_ingest_cmdb(payload)
    assert result == "completed"
    mock_session.run.assert_not_called()


@pytest.mark.asyncio
async def test_handle_ingest_cmdb_no_items_key(mock_session):
    from src.handlers.ingest_cmdb import handle_ingest_cmdb

    payload = {}
    result = await handle_ingest_cmdb(payload)
    assert result == "completed"
    mock_session.run.assert_not_called()


@pytest.mark.asyncio
async def test_handle_ingest_cmdb_error(mock_session):
    mock_session.run.side_effect = Exception("Neo4j error")
    from src.handlers.ingest_cmdb import handle_ingest_cmdb

    payload = {"items": [{"id": "ci-1"}]}
    result = await handle_ingest_cmdb(payload)
    assert result == "failed"

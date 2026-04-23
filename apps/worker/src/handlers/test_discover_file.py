import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import json
import os
import tempfile

from src.handlers.discover_file import normalize_row, read_file, reconcile_and_persist, handle_discover_file, CSDMV5_CLASSES


def test_normalize_row_complete():
    row = {"id": "srv-1", "name": "Web", "class": "Server", "environment": "prod", "cpu": 4}
    ci = normalize_row(row)
    assert ci["id"] == "srv-1"
    assert ci["name"] == "Web"
    assert ci["class"] == "Server"
    assert ci["environment"] == "prod"
    assert ci["attributes"] == {"cpu": 4}


def test_normalize_row_defaults():
    row = {"name": "App"}
    ci = normalize_row(row)
    assert ci["name"] == "App"
    assert ci["class"] == "ConfigurationItem"
    assert ci["environment"] == ""
    assert ci["attributes"] == {}
    assert ci["id"].startswith("discovered-")


def test_normalize_row_unknown_class():
    row = {"name": "X", "class": "UnknownClass"}
    ci = normalize_row(row)
    assert ci["class"] == "ConfigurationItem"


def test_read_file_csv():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8") as f:
        f.write("id,name,class\n")
        f.write("1,Web,Server\n")
        path = f.name
    try:
        rows = read_file(path)
        assert len(rows) == 1
        assert rows[0]["id"] == "1"
        assert rows[0]["name"] == "Web"
    finally:
        os.remove(path)


def test_read_file_json_list():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump([{"id": "2", "name": "DB"}], f)
        path = f.name
    try:
        rows = read_file(path)
        assert len(rows) == 1
        assert rows[0]["id"] == "2"
    finally:
        os.remove(path)


def test_read_file_json_object():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump({"id": "3", "name": "Cache"}, f)
        path = f.name
    try:
        rows = read_file(path)
        assert len(rows) == 1
        assert rows[0]["id"] == "3"
    finally:
        os.remove(path)


def test_read_file_not_found():
    with pytest.raises(FileNotFoundError):
        read_file("/nonexistent/file.csv")


def test_read_file_unsupported():
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        path = f.name
    try:
        with pytest.raises(ValueError):
            read_file(path)
    finally:
        os.remove(path)


def test_read_file_bad_json():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
        f.write("123")
        path = f.name
    try:
        with pytest.raises(ValueError):
            read_file(path)
    finally:
        os.remove(path)


@pytest.fixture
def mock_session():
    session = MagicMock()
    session.run = MagicMock(return_value=MagicMock(single=MagicMock(return_value=None)))
    return session


@pytest.fixture
def mock_driver(mock_session):
    with patch("src.handlers.discover_file.driver") as mock_driver:
        mock_driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)
        yield mock_driver


@pytest.fixture
def mock_postgres():
    with patch("src.db.postgres_client.PostgresClient.get_reconciliation_rules", new_callable=AsyncMock, return_value=[]) as mock_rules:
        with patch("src.db.postgres_client.PostgresClient.log_reconciliation", new_callable=AsyncMock) as mock_log:
            yield {"rules": mock_rules, "log": mock_log}


@pytest.mark.asyncio
async def test_reconcile_and_persist_create(mock_driver, mock_session, mock_postgres):
    items = [{"id": "ci-1", "name": "Web", "class": "Server", "environment": "prod"}]
    stats = await reconcile_and_persist("job-1", items, [])
    assert stats["created"] == 1
    assert stats["updated"] == 0
    assert stats["errors"] == 0
    mock_session.run.assert_called()
    mock_postgres["log"].assert_called_once()


@pytest.mark.asyncio
async def test_reconcile_and_persist_update(mock_driver, mock_session, mock_postgres):
    # Simulate existing CI found by name
    mock_session.run.return_value.single.return_value = {"id": "existing-1"}
    items = [{"id": "ci-1", "name": "Web", "class": "Server", "environment": "prod"}]
    stats = await reconcile_and_persist("job-1", items, [{"ci_class": "Server", "match_keys": ["name"]}])
    assert stats["created"] == 0
    assert stats["updated"] == 1
    mock_postgres["log"].assert_called_once()


@pytest.mark.asyncio
async def test_reconcile_and_persist_error(mock_driver, mock_session, mock_postgres):
    mock_session.run.side_effect = Exception("db error")
    items = [{"id": "ci-1", "name": "Web", "class": "Server"}]
    stats = await reconcile_and_persist("job-1", items, [])
    assert stats["errors"] == 1


@pytest.mark.asyncio
async def test_handle_discover_file(mock_postgres, mock_driver, mock_session):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8") as f:
        f.write("id,name,class\n")
        f.write("1,Web,Server\n")
        path = f.name
    try:
        stats = await handle_discover_file("job-1", path)
        assert stats["created"] == 1
        assert not os.path.exists(path)
    finally:
        if os.path.exists(path):
            os.remove(path)

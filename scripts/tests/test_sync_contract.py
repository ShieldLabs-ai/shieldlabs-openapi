"""Unit tests for scripts/sync_contract.py (standard library unittest, no network)."""

import contextlib
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sync_contract as sc

RAW = "https://raw.githubusercontent.com/ShieldLabs-ai/shieldlabs-openapi"
FILES = {
    "cases.json": b'{"cases": [1, 2, 3]}\n',
    "body.raw.txt": b'{"a":"\\u0026"}',
    "unused.json": b"{}\n",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def manifest_bytes(files, version="1.2.3"):
    body = {"contract_version": version, "files": {n: sha(d) for n, d in files.items()}}
    return json.dumps(body).encode()


class Workspace:
    """A temporary contract directory and a temporary consumer repository."""

    def __init__(self, testcase, files=None, mapping=None):
        tmp = tempfile.TemporaryDirectory()
        testcase.addCleanup(tmp.cleanup)
        base = Path(tmp.name)
        self.contract = base / "contract"
        self.repo = base / "repo"
        self.contract.mkdir()
        self.repo.mkdir()
        self.files = dict(FILES if files is None else files)
        for name, data in self.files.items():
            (self.contract / name).write_bytes(data)
        (self.contract / "manifest.json").write_bytes(manifest_bytes(self.files))
        self.mapping = mapping or {
            "cases.json": "tests/data/cases.json",
            "body.raw.txt": "tests/data/body.raw.txt",
        }
        self.write_config({"source": "shieldlabs-openapi", "files": self.mapping})

    def write_config(self, config):
        (self.repo / "contract-sync.json").write_text(json.dumps(config))

    def config(self):
        return sc.Config.load(self.repo, self.repo / "contract-sync.json")

    def lock(self):
        return self.repo / ".shieldlabs-contract.lock"

    def run(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = sc.main(["--root", str(self.repo), *args])
        return code, out.getvalue(), err.getvalue()

    def sync_local(self, ref="v1.2.3"):
        return self.run("--ref", ref, "--source-dir", str(self.contract))


class SyncTest(unittest.TestCase):
    def test_sync_copies_mapped_files_and_writes_the_lock(self):
        ws = Workspace(self)
        code, out, err = ws.sync_local()
        self.assertEqual(code, 0, err)
        for name, dest in ws.mapping.items():
            self.assertEqual((ws.repo / dest).read_bytes(), FILES[name])
        self.assertFalse((ws.repo / "tests/data/unused.json").exists())
        lock = json.loads(ws.lock().read_text())
        self.assertEqual(
            lock,
            {
                "ref": "v1.2.3",
                "contract_version": "1.2.3",
                "files": {n: sha(FILES[n]) for n in sorted(ws.mapping)},
            },
        )
        self.assertEqual(list(lock["files"]), sorted(lock["files"]))
        self.assertTrue(ws.lock().read_text().endswith("}\n"))
        self.assertIn("updated tests/data/cases.json", out)

    def test_second_sync_changes_nothing(self):
        ws = Workspace(self)
        ws.sync_local()
        before = {p: p.stat().st_mtime_ns for p in ws.repo.rglob("*") if p.is_file()}
        code, out, _ = ws.sync_local()
        self.assertEqual(code, 0)
        self.assertIn("already up to date", out)
        after = {p: p.stat().st_mtime_ns for p in ws.repo.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_sync_restores_an_edited_file(self):
        ws = Workspace(self)
        ws.sync_local()
        (ws.repo / "tests/data/cases.json").write_text("edited")
        _, out, _ = ws.sync_local()
        self.assertEqual((ws.repo / "tests/data/cases.json").read_bytes(), FILES["cases.json"])
        self.assertIn("updated tests/data/cases.json", out)
        self.assertNotIn("updated .shieldlabs-contract.lock", out)

    def test_hash_mismatch_writes_nothing(self):
        ws = Workspace(self)
        (ws.contract / "body.raw.txt").write_bytes(b"tampered")
        code, _, err = ws.sync_local()
        self.assertEqual(code, 1)
        self.assertIn("body.raw.txt at v1.2.3 does not match manifest.json", err)
        self.assertFalse((ws.repo / "tests").exists())
        self.assertFalse(ws.lock().exists())

    def test_file_missing_from_the_contract(self):
        ws = Workspace(self, mapping={"gone.json": "tests/data/gone.json"})
        code, _, err = ws.sync_local()
        self.assertEqual(code, 1)
        self.assertIn("contract v1.2.3 does not contain: gone.json", err)

    def test_invalid_manifest(self):
        ws = Workspace(self)
        for body in (
            b"[]",
            b"not json",
            b'{"files": {}}',
            b'{"contract_version": "1", "files": {"a": "x"}}',
        ):
            (ws.contract / "manifest.json").write_bytes(body)
            code, _, err = ws.sync_local()
            self.assertEqual(code, 1, body)
            self.assertIn("manifest.json", err)

    def test_source_dir_needs_a_tag(self):
        ws = Workspace(self)
        code, _, err = ws.sync_local(ref="latest")
        self.assertEqual(code, 1)
        self.assertIn("--source-dir needs a tag", err)

    def test_ref_is_validated(self):
        for ref in ("main", "v1.0", "1.0.0", "v1.0.0-rc.1", "latest; rm -rf /", "v1.0.0\n", ""):
            with self.assertRaises(sc.ContractError, msg=ref):
                sc.validate_ref(ref)
        for ref in ("latest", "v1.0.0", "v12.34.56"):
            self.assertEqual(sc.validate_ref(ref), ref)


class CheckTest(unittest.TestCase):
    def test_passes_after_sync(self):
        ws = Workspace(self)
        ws.sync_local()
        code, out, err = ws.run("--check")
        self.assertEqual(code, 0, err)
        self.assertIn("v1.2.3, contract_version 1.2.3, 2 files", out)

    def test_reports_an_edited_file(self):
        ws = Workspace(self)
        ws.sync_local()
        (ws.repo / "tests/data/body.raw.txt").write_bytes(b'{"a":"&"}')
        code, _, err = ws.run("--check")
        self.assertEqual(code, 1)
        self.assertIn("tests/data/body.raw.txt: SHA-256", err)
        self.assertIn("differs from the lock", err)
        self.assertIn("--ref <ref in the lock>", err)

    def test_reports_a_missing_file(self):
        ws = Workspace(self)
        ws.sync_local()
        (ws.repo / "tests/data/cases.json").unlink()
        code, _, err = ws.run("--check")
        self.assertEqual(code, 1)
        self.assertIn("tests/data/cases.json: missing", err)

    def test_config_and_lock_must_list_the_same_files(self):
        ws = Workspace(self)
        ws.sync_local()
        ws.write_config(
            {"source": "shieldlabs-openapi", "files": {"cases.json": "tests/data/cases.json"}}
        )
        code, _, err = ws.run("--check")
        self.assertEqual(code, 1)
        self.assertIn("body.raw.txt: in the lock but not in contract-sync.json", err)

    def test_missing_lock(self):
        ws = Workspace(self)
        code, _, err = ws.run("--check")
        self.assertEqual(code, 1)
        self.assertIn(".shieldlabs-contract.lock not found", err)

    def test_invalid_lock(self):
        ws = Workspace(self)
        ws.sync_local()
        lock = json.loads(ws.lock().read_text())
        for key, value in (("ref", "latest"), ("ref", "main"), ("files", [])):
            ws.lock().write_text(json.dumps({**lock, key: value}))
            code, _, _ = ws.run("--check")
            self.assertEqual(code, 1, (key, value))

    def test_check_needs_no_network(self):
        ws = Workspace(self)
        ws.sync_local()
        with mock.patch.object(sc.urllib.request, "urlopen", side_effect=AssertionError("network")):
            code, _, err = ws.run("--check")
        self.assertEqual(code, 0, err)


class ConfigTest(unittest.TestCase):
    def test_rejects_unsafe_or_ambiguous_mappings(self):
        ws = Workspace(self)
        bad = [
            {"source": "shieldlabs-openapi", "files": {"a.json": "../outside.json"}},
            {"source": "shieldlabs-openapi", "files": {"a.json": "/etc/passwd"}},
            {"source": "shieldlabs-openapi", "files": {"a.json": "tests\\a.json"}},
            {"source": "shieldlabs-openapi", "files": {"a.json": ""}},
            {"source": "shieldlabs-openapi", "files": {"../a.json": "tests/a.json"}},
            {"source": "shieldlabs-openapi", "files": {"manifest.json": "tests/m.json"}},
            {"source": "shieldlabs-openapi", "files": {"a.json": "x.json", "b.json": "x.json"}},
            {"source": "shieldlabs-openapi", "files": {}},
            {"source": "https://example.com/repo", "files": {"a.json": "a.json"}},
            {"files": {"a.json": "a.json"}},
            [],
        ]
        for config in bad:
            ws.write_config(config)
            with self.assertRaises(sc.ContractError, msg=config):
                ws.config()

    def test_source_with_and_without_owner(self):
        ws = Workspace(self)
        config = ws.config()
        self.assertEqual((config.owner, config.repo), ("ShieldLabs-ai", "shieldlabs-openapi"))
        ws.write_config({"source": "example-org/contract-fork", "files": ws.mapping})
        config = ws.config()
        self.assertEqual((config.owner, config.repo), ("example-org", "contract-fork"))


class FakeFetch:
    """Serves URLs from a dict; records every request."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, url, headers):
        self.calls.append((url, headers))
        if url not in self.routes:
            raise sc.NotFoundError(f"not found: {url}")
        body, next_url = self.routes[url]
        return body, next_url


class RemoteTest(unittest.TestCase):
    def test_newest_tag_compares_versions_numerically(self):
        names = ["v1.9.0", "v1.10.0", "v1.10.0-rc.1", "release-2", "v0.99.99", "main"]
        self.assertEqual(sc.newest_tag(names), "v1.10.0")
        self.assertIsNone(sc.newest_tag(["main", "v2"]))

    def test_latest_follows_pagination(self):
        api = "https://api.github.com/repos/ShieldLabs-ai/shieldlabs-openapi/tags?per_page=100"
        page2 = api + "&page=2"
        fetch = FakeFetch(
            {
                api: (json.dumps([{"name": "v1.0.1"}, {"name": "x"}]).encode(), page2),
                page2: (json.dumps([{"name": "v1.2.0"}, {"name": "v1.1.9"}]).encode(), None),
            }
        )
        with mock.patch.dict(os.environ, {"GITHUB_TOKEN": ""}):
            tag = sc.resolve_latest("ShieldLabs-ai", "shieldlabs-openapi", fetch)
        self.assertEqual(tag, "v1.2.0")
        self.assertEqual([url for url, _ in fetch.calls], [api, page2])
        self.assertNotIn("Authorization", fetch.calls[0][1])

    def test_latest_uses_a_token_only_when_given(self):
        api = "https://api.github.com/repos/o/r/tags?per_page=100"
        fetch = FakeFetch({api: (b'[{"name": "v3.0.0"}]', None)})
        with mock.patch.dict(os.environ, {"GITHUB_TOKEN": "t0k"}):
            self.assertEqual(sc.resolve_latest("o", "r", fetch), "v3.0.0")
        self.assertEqual(fetch.calls[0][1]["Authorization"], "Bearer t0k")

    def test_latest_without_tags(self):
        api = "https://api.github.com/repos/o/r/tags?per_page=100"
        with self.assertRaises(sc.ContractError):
            sc.resolve_latest("o", "r", FakeFetch({api: (b"[]", None)}))
        with self.assertRaises(sc.ContractError):
            sc.resolve_latest("o", "r", FakeFetch({api: (b'{"message": "x"}', None)}))

    def test_remote_sync_downloads_from_the_tag(self):
        ws = Workspace(self)
        base = f"{RAW}/v1.2.3/contract"
        routes = {f"{base}/manifest.json": (manifest_bytes(FILES), None)}
        routes.update({f"{base}/{n}": (d, None) for n, d in FILES.items()})
        fetch = FakeFetch(routes)
        source = sc.RemoteSource("ShieldLabs-ai", "shieldlabs-openapi", "v1.2.3", fetch)
        changed = sc.sync(ws.config(), source, "v1.2.3", ws.lock(), io.StringIO())
        self.assertEqual(
            changed,
            ["tests/data/body.raw.txt", "tests/data/cases.json", ".shieldlabs-contract.lock"],
        )
        self.assertNotIn(f"{base}/unused.json", [url for url, _ in fetch.calls])

    def test_release_without_a_contract(self):
        ws = Workspace(self)
        source = sc.RemoteSource("ShieldLabs-ai", "shieldlabs-openapi", "v1.0.0", FakeFetch({}))
        with self.assertRaisesRegex(sc.ContractError, "predates the contract"):
            sc.sync(ws.config(), source, "v1.0.0", ws.lock(), io.StringIO())

    def test_http_fetch_retries_transient_errors_and_reads_the_next_link(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b"[]"
        response.headers = {
            "Link": '<https://api.example/tags?page=2>; rel="next", <x>; rel="last"'
        }
        failures = [
            urllib.error.URLError("reset"),
            urllib.error.HTTPError("u", 502, "bad", {}, None),
        ]
        urlopen = mock.patch.object(sc.urllib.request, "urlopen", side_effect=[*failures, response])
        with urlopen, mock.patch.object(sc.time, "sleep") as sleep:
            body, next_url = sc.http_fetch("https://api.example/tags", {})
        self.assertEqual((body, next_url), (b"[]", "https://api.example/tags?page=2"))
        self.assertEqual(sleep.call_count, 2)

    def test_http_fetch_does_not_retry_client_errors(self):
        for code, error in ((404, sc.NotFoundError), (403, sc.ContractError)):
            failure = urllib.error.HTTPError("u", code, "x", {}, None)
            patch = mock.patch.object(sc.urllib.request, "urlopen", side_effect=[failure])
            with patch as urlopen, mock.patch.object(sc.time, "sleep"), self.assertRaises(error):
                sc.http_fetch("https://example.invalid/x", {})
            self.assertEqual(urlopen.call_count, 1)


if __name__ == "__main__":
    unittest.main()

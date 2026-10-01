"""Unit tests for scripts/contract_manifest.py, and a check of this repository's own manifest."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import contract_manifest as cm

SPEC = """openapi: 3.1.0
info:
  title: Example
  # a comment
  version: 2.3.4
  summary: x
servers: []
"""


class ManifestTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        (self.root / "spec").mkdir()
        (self.root / "spec" / "openapi.yaml").write_text(SPEC)
        self.contract = self.root / "contract"
        self.contract.mkdir()
        (self.contract / "README.md").write_text("# Contract\n")
        (self.contract / "a.json").write_bytes(b"{}\n")
        (self.contract / "b.raw.txt").write_bytes(b"raw")

    def run_main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cm.main(["--root", str(self.root), *args])
        return code, out.getvalue(), err.getvalue()

    def test_write_then_check(self):
        self.assertEqual(self.run_main("--write")[0], 0)
        manifest = json.loads((self.contract / "manifest.json").read_text())
        self.assertEqual(manifest["contract_version"], "2.3.4")
        self.assertEqual(sorted(manifest["files"]), ["a.json", "b.raw.txt"])
        code, out, _ = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn("contract_version 2.3.4, 2 files", out)

    def test_detects_a_changed_added_or_removed_file(self):
        self.run_main("--write")
        (self.contract / "a.json").write_bytes(b"[]\n")
        (self.contract / "c.json").write_bytes(b"1\n")
        (self.contract / "b.raw.txt").unlink()
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("a.json changed", err)
        self.assertIn("c.json is not listed", err)
        self.assertIn("b.raw.txt is listed but not in contract/", err)
        self.assertIn("--write", err)

    def test_detects_a_spec_version_bump(self):
        self.run_main("--write")
        (self.root / "spec" / "openapi.yaml").write_text(SPEC.replace("2.3.4", "2.4.0"))
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("contract_version is 2.3.4, the spec version is 2.4.0", err)

    def test_missing_manifest(self):
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("does not exist", err)

    def test_rejects_bad_file_names_and_directories(self):
        (self.contract / "bad name.json").write_bytes(b"{}")
        self.assertEqual(self.run_main("--write")[0], 1)
        (self.contract / "bad name.json").unlink()
        (self.contract / "nested").mkdir()
        self.assertEqual(self.run_main("--write")[0], 1)

    def test_spec_version_variants(self):
        spec = self.root / "spec" / "openapi.yaml"
        for line, expected in (
            ("  version: '1.2.3'", "1.2.3"),
            ('  version: "4.5.6" # x', "4.5.6"),
        ):
            spec.write_text(f"info:\n  title: T\n{line}\npaths: {{}}\n")
            self.assertEqual(cm.spec_version(spec), expected)
        spec.write_text("info:\n  title: T\npaths:\n  version: 9.9.9\n")
        with self.assertRaises(cm.ContractError):
            cm.spec_version(spec)


class RepositoryManifestTest(unittest.TestCase):
    def test_this_repository_manifest_is_current(self):
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            code = cm.main([])
        self.assertEqual(code, 0, err.getvalue())


if __name__ == "__main__":
    unittest.main()

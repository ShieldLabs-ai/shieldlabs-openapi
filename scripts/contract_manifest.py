#!/usr/bin/env python3
"""Check or rewrite contract/manifest.json.

The manifest lists the SHA-256 of every file in contract/ (except README.md and the manifest
itself) and carries the spec version (info.version of spec/openapi.yaml) as contract_version.
SDK repositories verify every file they sync against it.

    python3 scripts/contract_manifest.py           exit 1 when the manifest is stale
    python3 scripts/contract_manifest.py --write   rewrite it from contract/ and the spec

Python 3.9 or later, standard library only.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sync_contract import (
    CONTRACT_DIR,
    MANIFEST_FILE,
    ContractError,
    parse_manifest,
    sha256_bytes,
    validate_name,
)

ROOT = Path(__file__).resolve().parent.parent
SKIPPED = {"README.md", MANIFEST_FILE}
VERSION_LINE = re.compile(r"^  version:\s*['\"]?([^'\"\s#]+)['\"]?\s*(?:#.*)?$")


def spec_version(spec: Path) -> str:
    """info.version of the root OpenAPI document."""
    in_info = False
    for line in spec.read_text(encoding="utf-8").splitlines():
        if line.rstrip() == "info:":
            in_info = True
            continue
        if in_info:
            if line and not line.startswith((" ", "#")):
                break
            match = VERSION_LINE.match(line)
            if match:
                return match.group(1)
    raise ContractError(f"{spec}: no info.version")


def build_manifest(root: Path) -> dict:
    directory = root / CONTRACT_DIR
    files = {}
    for path in sorted(directory.iterdir()):
        if path.name in SKIPPED or path.name.startswith("."):
            continue
        if not path.is_file():
            raise ContractError(f"{path}: only files belong in {CONTRACT_DIR}/")
        files[validate_name(path.name)] = sha256_bytes(path.read_bytes())
    if not files:
        raise ContractError(f"{directory} has no contract files")
    version = spec_version(root / "spec" / "openapi.yaml")
    return {"contract_version": version, "files": files}


def render(manifest: dict) -> str:
    return json.dumps(manifest, indent=2) + "\n"


def differences(expected: dict, path: Path) -> list[str]:
    if not path.is_file():
        return [f"{path} does not exist"]
    version, files = parse_manifest(path.read_bytes())
    problems = []
    if version != expected["contract_version"]:
        problems.append(
            f"contract_version is {version}, the spec version is {expected['contract_version']}"
        )
    for name in sorted(set(expected["files"]) | set(files)):
        if name not in files:
            problems.append(f"{name} is not listed")
        elif name not in expected["files"]:
            problems.append(f"{name} is listed but not in {CONTRACT_DIR}/")
        elif files[name] != expected["files"][name]:
            problems.append(f"{name} changed (SHA-256 {expected['files'][name][:12]})")
    if not problems and path.read_text(encoding="utf-8") != render(expected):
        problems.append("formatting differs from the generated file")
    return problems


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Check or rewrite contract/manifest.json.")
    parser.add_argument("--write", action="store_true", help="rewrite the manifest")
    parser.add_argument("--root", default=str(ROOT), help="repository root")
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()
    path = root / CONTRACT_DIR / MANIFEST_FILE
    try:
        expected = build_manifest(root)
        if args.write:
            path.write_text(render(expected), encoding="utf-8")
            print(f"Wrote {CONTRACT_DIR}/{MANIFEST_FILE}: {len(expected['files'])} files")
            return 0
        problems = differences(expected, path)
    except ContractError as exc:
        print(f"contract-manifest: error: {exc}", file=sys.stderr)
        return 1
    if problems:
        print(f"{CONTRACT_DIR}/{MANIFEST_FILE} is stale:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        print("Run: python3 scripts/contract_manifest.py --write", file=sys.stderr)
        return 1
    print(
        f"{CONTRACT_DIR}/{MANIFEST_FILE} matches: contract_version "
        f"{expected['contract_version']}, {len(expected['files'])} files"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

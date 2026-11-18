"""Moving a checkout must not leave its launcher tied to the previous path."""

import os
from pathlib import Path
import shutil
import subprocess

import pytest


LAUNCHER = Path(__file__).resolve().parents[2] / "run-local.sh"


@pytest.fixture
def moved_project(tmp_path):
    original = tmp_path / "original"
    original.mkdir()
    shutil.copy2(LAUNCHER, original / "run-local.sh")
    for name in ["playbooks/index.txt", "eval-set.json", "cve-feed.json"]:
        path = original / "data" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("")
    python = original / "triage-service" / ".venv" / "bin" / "python"
    python.parent.mkdir(parents=True)
    python.write_text('#!/bin/sh\nprintf "%s\\n" "$PWD" "$AEGIS_DATA_DIR" "$@"\n')
    python.chmod(0o755)
    relocated = tmp_path / "renamed project with spaces"
    original.rename(relocated)
    environment = os.environ.copy()
    for name in ["AEGIS_DATA_DIR", "AEGIS_APP_PORT", "AEGIS_TRIAGE_PORT", "PORT"]:
        environment.pop(name, None)
    return relocated, environment


def test_triage_launch_after_rename_from_unrelated_working_directory(moved_project, tmp_path):
    root, environment = moved_project
    result = subprocess.run(["bash", str(root / "run-local.sh"), "triage"],
                            cwd=tmp_path, env=environment, text=True, capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == [
        str(root / "triage-service"), str(root / "data"), "-m", "uvicorn", "app.main:app",
        "--host", "127.0.0.1", "--port", "8000",
    ]


def test_missing_data_explains_the_override_instead_of_starting(moved_project):
    root, environment = moved_project
    environment["AEGIS_DATA_DIR"] = str(root / "old-missing-data")
    result = subprocess.run(["bash", str(root / "run-local.sh"), "triage"],
                            env=environment, text=True, capture_output=True, timeout=10)
    assert result.returncode == 1
    assert "Missing shared data" in result.stderr
    assert "unset it" in result.stderr
    assert not result.stdout


@pytest.mark.parametrize("port", ["0", "65536", "abc", "-1"])
def test_bad_ports_are_rejected_before_launching(moved_project, port):
    root, environment = moved_project
    environment["AEGIS_TRIAGE_PORT"] = port
    result = subprocess.run(["bash", str(root / "run-local.sh"), "triage"],
                            env=environment, text=True, capture_output=True, timeout=10)
    assert result.returncode == 1
    assert "between 1 and 65535" in result.stderr


def test_relative_data_override_resolves_from_service_directory(moved_project, tmp_path):
    root, environment = moved_project
    environment["AEGIS_DATA_DIR"] = "../data"
    result = subprocess.run(["bash", str(root / "run-local.sh"), "triage"], cwd=tmp_path,
                            env=environment, text=True, capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert Path(result.stdout.splitlines()[1]).resolve() == root / "data"


def test_app_uses_a_stable_jar_when_maven_output_changes(moved_project, tmp_path):
    root, environment = moved_project
    java = root / "app/.tools/amazon-corretto-21.0.13.1.2-linux-x64/bin/java"
    maven = root / "app/.tools/apache-maven-3.9.9/bin/mvn"
    java.parent.mkdir(parents=True)
    maven.parent.mkdir(parents=True)
    maven.write_text('#!/bin/sh\nmkdir -p target\nprintf "original" > target/aegis-app-0.0.1-SNAPSHOT.jar\n')
    java.write_text('''#!/bin/sh
if [ "$1" = "-version" ]; then echo 'openjdk version "21.0.1"' >&2; exit 0; fi
printf 'rebuilt' > target/aegis-app-0.0.1-SNAPSHOT.jar
printf 'Runtime jar: %s\\nRuntime content: ' "$2"
cat "$2"
''')
    java.chmod(0o755)
    maven.chmod(0o755)
    result = subprocess.run(["bash", str(root / "run-local.sh"), "app"], cwd=tmp_path,
                            env=environment, text=True, capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert "local-run." in result.stdout
    assert "Runtime content: original" in result.stdout
    assert (root / "app/target/aegis-app-0.0.1-SNAPSHOT.jar").read_text() == "rebuilt"
    assert not list((root / "app/target").glob("local-run.*"))

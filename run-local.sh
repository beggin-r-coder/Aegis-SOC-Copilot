#!/usr/bin/env bash
# Resolve everything from this file so moving the project does not change startup.
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-all}"
case "$MODE" in
  all|app|triage|--check) ;;
  *) echo 'Usage: ./run-local.sh [all|app|triage|--check]' >&2; exit 2 ;;
esac

export AEGIS_DATA_DIR="${AEGIS_DATA_DIR:-$ROOT/data}"
if [[ "$AEGIS_DATA_DIR" != /* ]]; then
  export AEGIS_DATA_DIR="$ROOT/triage-service/$AEGIS_DATA_DIR"
fi
for required in playbooks/index.txt cve-feed.json eval-set.json; do
  if [[ ! -f "$AEGIS_DATA_DIR/$required" ]]; then
    echo "Missing shared data: $AEGIS_DATA_DIR/$required" >&2
    echo 'Check AEGIS_DATA_DIR, or unset it to use this project’s data directory.' >&2
    exit 1
  fi
done
PYTHON="$ROOT/triage-service/.venv/bin/python"
APP_PORT="${AEGIS_APP_PORT:-${PORT:-8080}}"
TRIAGE_PORT="${AEGIS_TRIAGE_PORT:-8000}"
for port in "$APP_PORT" "$TRIAGE_PORT"; do
  if [[ ! "$port" =~ ^[0-9]{1,5}$ ]] || (( 10#$port < 1 || 10#$port > 65535 )); then
    echo 'AEGIS_APP_PORT and AEGIS_TRIAGE_PORT must be between 1 and 65535.' >&2
    exit 1
  fi
done
if [[ "$MODE" != app && ! -x "$PYTHON" ]]; then
  echo 'Python environment missing. Run python3.11 -m venv triage-service/.venv' >&2
  echo 'Then run triage-service/.venv/bin/python -m pip install -r triage-service/requirements.txt' >&2
  exit 1
fi
if [[ "$MODE" != triage ]]; then
  BUNDLED_JAVA="$ROOT/app/.tools/amazon-corretto-21.0.13.1.2-linux-x64"
  if [[ -x "$BUNDLED_JAVA/bin/java" ]]; then
    export JAVA_HOME="$BUNDLED_JAVA"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
  JAVA_VERSION="$(java -version 2>&1 || true)"
  case "$JAVA_VERSION" in
    *'version "21.'*|*'version "21"'*) ;;
    *) echo 'Java 21 is required. Set JAVA_HOME to a Java 21 installation.' >&2; exit 1 ;;
  esac
  JAVA="$(command -v java)"
  MAVEN="$ROOT/app/.tools/apache-maven-3.9.9/bin/mvn"
  if [[ ! -x "$MAVEN" ]]; then MAVEN="$(command -v mvn || true)"; fi
  if [[ -z "$MAVEN" ]]; then echo 'Maven is required. Install Maven or restore app/.tools/.' >&2; exit 1; fi
fi
if [[ "$MODE" == --check ]]; then
  "$PYTHON" -c 'import fastapi, uvicorn, pydantic, openai, numpy, faiss, rank_bm25; import sys; print("Python:", sys.version.split()[0])'
  printf 'Project: %s\nData: %s\nJava: %s\nMaven: %s\n' "$ROOT" "$AEGIS_DATA_DIR" "$(command -v java)" "$MAVEN"
  exit 0
fi
if [[ "$MODE" == triage ]]; then
  cd "$ROOT/triage-service"
  exec "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port "$TRIAGE_PORT"
fi
if [[ "$MODE" == all ]]; then
  "$PYTHON" - "$APP_PORT" "$TRIAGE_PORT" <<'PY'
import socket
import sys
if sys.argv[1] == sys.argv[2]:
    raise SystemExit('The dashboard and triage service need different ports.')
for port in sys.argv[1:]:
    with socket.socket() as sock:
        try:
            sock.bind(('127.0.0.1', int(port)))
        except OSError:
            raise SystemExit(f'Port {port} is in use. Stop the existing service before starting another copy.')
PY
fi
cd "$ROOT/app"
"$MAVEN" -q -DskipTests package
# Maven may rebuild its output while the dashboard is running. Keep the JVM's jar stable.
RUN_DIR="$(mktemp -d "$ROOT/app/target/local-run.XXXXXX")"
cp "$ROOT/app/target/aegis-app-0.0.1-SNAPSHOT.jar" "$RUN_DIR/app.jar"
JAR="$RUN_DIR/app.jar"
export AEGIS_ENGINE="${AEGIS_ENGINE:-http}"
export TRIAGE_SERVICE_URL="${TRIAGE_SERVICE_URL:-http://127.0.0.1:$TRIAGE_PORT}"
TRIAGE_PID=''
APP_PID=''
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$APP_PID" ]] || kill "$APP_PID" 2>/dev/null || true
  [[ -z "$TRIAGE_PID" ]] || kill "$TRIAGE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -f "$JAR"
  rmdir "$RUN_DIR" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ "$MODE" == all ]]; then
  (cd "$ROOT/triage-service"; exec "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port "$TRIAGE_PORT") &
  TRIAGE_PID=$!
fi
"$JAVA" -jar "$JAR" --server.address=127.0.0.1 --server.port="$APP_PORT" &
APP_PID=$!
if [[ "$MODE" == app ]]; then
  printf '\nDashboard: http://localhost:%s\nPress Ctrl+C to stop the dashboard.\n\n' "$APP_PORT"
  wait "$APP_PID"
else
  printf '\nDashboard: http://localhost:%s\nTriage API: http://localhost:%s/docs\nPress Ctrl+C to stop both services.\n\n' "$APP_PORT" "$TRIAGE_PORT"
  wait -n "$TRIAGE_PID" "$APP_PID"
fi

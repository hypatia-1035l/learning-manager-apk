#!/usr/bin/env bash
# Persistent SSH reverse tunnel to serveo.net
# Forwards serveo URL -> local nginx on 127.0.0.1:8090 via SOCKS5 proxy 127.0.0.1:18080

set -u

SERVEO_HOST="serveo.net"
LOCAL_PORT="8090"
SOCKS_PROXY="127.0.0.1:18080"
KNOWN_HOSTS_FILE="${HOME}/.ssh/known_hosts_serveo"
LOG_FILE="/tmp/serveo_tunnel.log"
PID_FILE="/tmp/serveo_tunnel.pid"

mkdir -p "${HOME}/.ssh"

log() {
    local ts
    ts="$(date '+%Y-%m-%d %H:%M:%S')"
    echo "[${ts}] $*" | tee -a "${LOG_FILE}"
}

cleanup() {
    log "Received signal, shutting down tunnel."
    if [[ -f "${PID_FILE}" ]]; then
        local pid
        pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
        [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
        rm -f "${PID_FILE}"
    fi
    exit 0
}
trap cleanup SIGINT SIGTERM SIGHUP

run_tunnel() {
    local attempt=0
    while true; do
        attempt=$((attempt + 1))
        log "=== Serveo tunnel attempt #${attempt} ==="
        log "Connecting to ${SERVEO_HOST} forwarding -> 127.0.0.1:${LOCAL_PORT}"
        log "Using SOCKS5 proxy: ${SOCKS_PROXY}"

        ssh \
            -o "UserKnownHostsFile=${KNOWN_HOSTS_FILE}" \
            -o "StrictHostKeyChecking=accept-new" \
            -o "ServerAliveInterval=30" \
            -o "ServerAliveCountMax=3" \
            -o "ExitOnForwardFailure=yes" \
            -o "ConnectTimeout=30" \
            -o "ProxyCommand=nc -X connect -x ${SOCKS_PROXY} %h %p" \
            -R "80:127.0.0.1:${LOCAL_PORT}" \
            -N \
            -T \
            serveo.net 2>&1 | tee -a "${LOG_FILE}"

        local rc=${PIPESTATUS[0]}
        log "SSH exited with code ${rc}. Restarting in 5s..."
        sleep 5
    done
}

log "Starting serveo persistent tunnel"
log "Local nginx: http://127.0.0.1:${LOCAL_PORT}"
log "SOCKS proxy: ${SOCKS_PROXY}"
run_tunnel

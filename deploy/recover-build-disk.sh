#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }

echo "=== Disk before ==="
df -h /
docker system df || true

echo
echo "=== Prune failed build cache only ==="
docker builder prune -af || true
docker buildx prune -af || true

echo
echo "=== Remove dangling images only ==="
docker image prune -f || true

echo
echo "=== Disk after cleanup ==="
df -h /
docker system df || true

avail_kb=$(df -Pk / | awk 'NR==2{print $4}')
if [[ "${avail_kb:-0}" -lt 4194304 ]]; then
  echo "[WARN] Less than 4 GiB free remains. Do NOT prune volumes."
  echo "Inspect: du -xhd1 /var/lib/docker /var/lib/containerd /opt 2>/dev/null | sort -h"
  exit 2
fi

echo "[PASS] Safe build-cache cleanup complete; persistent volumes were not pruned."

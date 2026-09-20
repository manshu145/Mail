#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

CONFIRM="${NEXIMAIL_RESET_CONFIRM:-}"
APP_DIRS=(/opt/neximail-next /opt/neximail)
PROJECTS=(neximail-next neximail)
BACKUP_DIR="/root/neximail-reset-backup-$(date -u +%Y%m%dT%H%M%SZ)"

[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
[[ "$CONFIRM" == "DELETE_OLD_NEXIMAIL" ]] || {
  echo "Refusing destructive cleanup."
  echo "Run with: NEXIMAIL_RESET_CONFIRM=DELETE_OLD_NEXIMAIL"
  exit 2
}

command -v docker >/dev/null || { echo "Docker is required."; exit 1; }

mkdir -p "$BACKUP_DIR"

echo "=== NexiMail scoped reset ==="
echo "Backup: $BACKUP_DIR"
echo "This script does NOT run docker system prune and does NOT delete Nginx/Let's Encrypt."

# Preserve lightweight diagnostics and proxy configuration before cleanup.
docker ps -a --no-trunc > "$BACKUP_DIR/docker-ps-before.txt" 2>/dev/null || true
docker volume ls > "$BACKUP_DIR/docker-volumes-before.txt" 2>/dev/null || true
docker network ls > "$BACKUP_DIR/docker-networks-before.txt" 2>/dev/null || true

if command -v nginx >/dev/null 2>&1; then
  nginx -T > "$BACKUP_DIR/nginx-before.txt" 2>&1 || true
fi
if [[ -d /etc/nginx ]]; then
  tar -C /etc -czf "$BACKUP_DIR/nginx-config.tgz" nginx 2>/dev/null || true
fi

for dir in "${APP_DIRS[@]}"; do
  if [[ -f "$dir/.env" ]]; then
    cp -a "$dir/.env" "$BACKUP_DIR/$(basename "$dir").env" || true
  fi
done

stop_project_from_dir() {
  local project="$1"
  local dir="$2"
  if [[ -f "$dir/docker-compose.prod.yml" ]]; then
    echo "Stopping compose project $project from $dir"
    docker compose --project-directory "$dir" -p "$project" -f "$dir/docker-compose.prod.yml" down -v --remove-orphans || true
  elif [[ -f "$dir/docker-compose.yml" ]]; then
    echo "Stopping compose project $project from $dir"
    docker compose --project-directory "$dir" -p "$project" -f "$dir/docker-compose.yml" down -v --remove-orphans || true
  fi
}

stop_project_from_dir neximail-next /opt/neximail-next
stop_project_from_dir neximail /opt/neximail

# Remove only resources explicitly owned by the known NexiMail compose projects.
for project in "${PROJECTS[@]}"; do
  echo "Removing leftover containers for compose project: $project"
  mapfile -t containers < <(docker ps -aq --filter "label=com.docker.compose.project=$project")
  if (("${#containers[@]}")); then
    docker rm -f "${containers[@]}"
  fi

  echo "Removing leftover volumes for compose project: $project"
  mapfile -t volumes < <(docker volume ls -q --filter "label=com.docker.compose.project=$project")
  if (("${#volumes[@]}")); then
    docker volume rm -f "${volumes[@]}"
  fi

  echo "Removing leftover networks for compose project: $project"
  mapfile -t networks < <(docker network ls -q --filter "label=com.docker.compose.project=$project")
  if (("${#networks[@]}")); then
    docker network rm "${networks[@]}" || true
  fi
done

# Remove known legacy named resources if they remain from older compose versions.
mapfile -t named_volumes < <(docker volume ls --format '{{.Name}}' | grep -E '^(neximail|neximail-next)_' || true)
if (("${#named_volumes[@]}")); then
  docker volume rm -f "${named_volumes[@]}"
fi

mapfile -t named_networks < <(docker network ls --format '{{.Name}}' | grep -E '^(neximail|neximail-next)_' || true)
if (("${#named_networks[@]}")); then
  docker network rm "${named_networks[@]}" || true
fi

for dir in "${APP_DIRS[@]}"; do
  if [[ -e "$dir" ]]; then
    echo "Deleting old app directory: $dir"
    rm -rf --one-file-system "$dir"
  fi
done

echo
echo "=== Remaining NexiMail-named Docker resources ==="
docker ps -a --format '{{.Names}}' | grep -Ei 'neximail' || true
docker volume ls --format '{{.Name}}' | grep -Ei 'neximail' || true
docker network ls --format '{{.Name}}' | grep -Ei 'neximail' || true

echo
echo "Scoped NexiMail cleanup complete."
echo "Preserved Nginx/Let's Encrypt. Backup: $BACKUP_DIR"

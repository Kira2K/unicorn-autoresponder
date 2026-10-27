#!/bin/sh
set -eu
mountpoint -q /var/data || { echo '{"error":"bridge_render_persistent_disk_required"}' >&2; exit 1; }
install -d -m 700 -o 1000 -g 1000 /var/data/bridge /var/data/octo-cache /run/octo-secrets
# Render secret files stay out of the image and the persistent operation disk.
install -m 600 -o 1000 -g 1000 /etc/secrets/octo-api-token /run/octo-secrets/octo-api-token
install -m 600 -o 1000 -g 1000 /etc/secrets/bridge.config.json /run/octo-secrets/bridge.config.json
exec setpriv --reuid=1000 --regid=1000 --init-groups \
  flock --nonblock --no-fork /var/data/bridge/runner.flock node /app/runtime/main.mjs

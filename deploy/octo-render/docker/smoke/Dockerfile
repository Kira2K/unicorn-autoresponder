# Test-only image. The production Dockerfile never copies these fixtures.
FROM unicorn-octo-render:local
COPY --chmod=755 docker/smoke/owner.mjs /home/octo/browser/OctoBrowser.AppImage
RUN mkdir -p /etc/secrets \
    && printf 'FAKE-LOCAL-SMOKE-TOKEN' > /etc/secrets/octo-api-token \
    && printf '%s' '{"backendUrl":"http://127.0.0.1:4305","bridgeId":"smoke","secret":"sssssssssssssssssssssssssssssssssssssssssss","ownerEmail":"owner@example.com","allowedProfileUuids":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],"pollMilliseconds":1000}' > /etc/secrets/bridge.config.json
ENV RENDER_SERVICE_ID=srv-local-smoke OCTO_BRIDGE_MODE=check

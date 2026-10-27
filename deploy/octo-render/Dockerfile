FROM ubuntu:22.04
ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_VERSION=24.20.0
ARG NODE_SHA256=2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2
ARG OCTO_SHA256=1c8b445bc7dd3f0fce7deb56b80a46d172bbc2fe762165b112c81b9376b6b183
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl jq xvfb tini util-linux xz-utils libstdc++6 \
    libgl1 libegl1 libgles2 libglib2.0-0 libnss3 libnspr4 libasound2 \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libx11-xcb1 libxcb1 libgtk-3-0 \
    fontconfig fonts-liberation zip unzip \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1000 octo && useradd -u 1000 -g octo -m -s /bin/bash octo
RUN cd /tmp \
    && curl --fail --silent --show-error --location "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o node.tar.xz \
    && printf '%s  node.tar.xz\n' "$NODE_SHA256" | sha256sum --check - \
    && tar -xJf node.tar.xz -C /usr/local --strip-components=1 \
    && node --version && rm node.tar.xz
RUN cd /tmp \
    && curl --fail --silent --show-error --location 'https://binaries.octobrowser.net/releases/installer/OctoBrowser.linux.tar.gz' -o octo.tar.gz \
    && printf '%s  octo.tar.gz\n' "$OCTO_SHA256" | sha256sum --check - \
    && mkdir -p /home/octo/browser /app /var/data /run/octo-secrets \
    && tar -xzf octo.tar.gz -C /home/octo/browser \
    && test -f /home/octo/browser/OctoBrowser.AppImage \
    && chmod +x /home/octo/browser/OctoBrowser.AppImage \
    && chown -R octo:octo /home/octo /app \
    && ln -s /var/data/octo-cache '/home/octo/.Octo Browser' \
    && rm octo.tar.gz
WORKDIR /app
COPY --chown=1000:1000 bridge/ /app/bridge/
COPY --chown=1000:1000 runtime/ /app/runtime/
COPY --chmod=755 docker/entrypoint.sh /app/entrypoint.sh
ENV OCTO_BRIDGE_MODE=check LANG=C.UTF-8 HOME=/home/octo
# Bootstrap permissions as root, then entrypoint drops to UID 1000. No public port.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]

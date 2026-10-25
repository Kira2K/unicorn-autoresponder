# Local E2E helper, adapted from octobrowser/documentation api/docker.md.
# Never pass credentials as build arguments; this image contains no account session.
FROM ubuntu:22.04
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
 ca-certificates curl xvfb socat libgl1 libegl1 libgles2 libglib2.0-0 libnss3 libnspr4 libasound2 \
 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
 libxdamage1 libxfixes3 libxrandr2 libgbm1 libx11-xcb1 libxcb1 libgtk-3-0 \
 fontconfig fonts-liberation zip unzip \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -r octo && useradd -r -g octo -m -s /bin/bash octo
USER octo
WORKDIR /home/octo
RUN mkdir browser && curl -fSL https://binaries.octobrowser.net/releases/installer/OctoBrowser.linux.tar.gz -o /tmp/octo.tar.gz \
 && tar -xzf /tmp/octo.tar.gz -C browser && rm /tmp/octo.tar.gz
ENV DISPLAY=:1 OCTO_HEADLESS=1 LANG=C.UTF-8
CMD Xvfb :1 -screen 0 1920x1080x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & \
 socat TCP-LISTEN:58889,bind=0.0.0.0,fork TCP:127.0.0.1:58888 & \
 sleep 3; exec /home/octo/browser/OctoBrowser.AppImage

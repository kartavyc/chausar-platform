FROM debian:bookworm-slim
LABEL com.chausar.demo.contract="1"
RUN apt-get update && apt-get install -y --no-install-recommends nodejs python3 python3-tk chromium xvfb openbox x11vnc novnc websockify xdotool ffmpeg tini libxfixes3 fonts-dejavu-core fonts-noto-core ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --uid 1000 --create-home demo && mkdir -p /opt/chausar
COPY protocol.mjs /opt/chausar/demo
COPY package.json /opt/chausar/package.json
COPY state-file.mjs /opt/chausar/state-file.mjs
COPY boot.mjs /opt/chausar/boot.mjs
COPY cursor.py /opt/chausar/cursor.py
RUN chmod 0555 /opt/chausar/demo /opt/chausar/boot.mjs /opt/chausar/cursor.py
USER 1000:1000
EXPOSE 6080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/bin/node", "/opt/chausar/boot.mjs"]

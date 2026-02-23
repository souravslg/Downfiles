FROM node:20

# Install Python, pip, ffmpeg, wget and SSL libs
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg curl wget libssl-dev ca-certificates \
    build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp, curl_cffi, and bgutil pot provider plugin
RUN pip3 install -U --pre yt-dlp curl_cffi --break-system-packages && \
    pip3 install bgutil-ytdlp-pot-provider --break-system-packages && \
    python3 -c "import curl_cffi; print('curl_cffi OK:', curl_cffi.__version__)"

WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install --production

# Build the bgutil server from bundled source (no network needed)
# bgutil script provider expects generate_once.js at /root/bgutil-ytdlp-pot-provider/server/build/
COPY bgutil-server /root/bgutil-ytdlp-pot-provider/server
RUN cd /root/bgutil-ytdlp-pot-provider/server && \
    npm install && \
    npx tsc && \
    echo "bgutil built OK: $(ls build/)"

# Copy the rest of the app
COPY . .

EXPOSE 3000
CMD ["node", "server/index.js"]

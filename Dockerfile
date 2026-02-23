FROM node:20

# Install Python, pip, ffmpeg, wget and SSL libs
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg curl wget libssl-dev ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp, curl_cffi, and bgutil pot provider plugin
RUN pip3 install -U --pre yt-dlp curl_cffi --break-system-packages && \
    pip3 install bgutil-ytdlp-pot-provider --break-system-packages && \
    python3 -c "import curl_cffi; print('curl_cffi OK:', curl_cffi.__version__)"

# Download and build bgutil server using wget tarball (avoids git network blocks)
# bgutil needs generate_once.js compiled at /root/bgutil-ytdlp-pot-provider/server/build/
RUN mkdir -p /root/bgutil-ytdlp-pot-provider && \
    wget -q -O /tmp/bgutil.tar.gz \
    https://github.com/nicedoc/bgutil-yt-dlp-pot-provider/archive/refs/heads/main.tar.gz && \
    tar -xzf /tmp/bgutil.tar.gz --strip-components=1 -C /root/bgutil-ytdlp-pot-provider && \
    rm /tmp/bgutil.tar.gz && \
    cd /root/bgutil-ytdlp-pot-provider/server && \
    npm install && \
    npm run build && \
    echo "bgutil script built OK: $(ls build/)"

WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the app
COPY . .

EXPOSE 3000
CMD ["node", "server/index.js"]

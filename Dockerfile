FROM nikolaik/python-nodejs:python3.11-nodejs20

# Install ffmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg curl wget && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --production

# Install latest yt-dlp and bgutil PoToken provider plugin
RUN pip3 install -U --pre yt-dlp curl-cffi --break-system-packages && \
    pip3 install -U yt-dlp-get-pot bgutil-ytdlp-pot-provider --break-system-packages

# Compile bgutil generate_once.js using esbuild with CJS format
# CJS = native Node.js CommonJS, no ESM interop shims, no __require2 issues
# --loader:.node=empty silently drops canvas native binary (not needed with disableInnertube=true)
COPY bgutil-server /tmp/bgutil-server
RUN cd /tmp/bgutil-server && \
    npm install && \
    mkdir -p /root/bgutil-ytdlp-pot-provider/server/build && \
    npx esbuild src/generate_once.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --loader:.node=empty \
    --outfile=/root/bgutil-ytdlp-pot-provider/server/build/generate_once.js && \
    echo "✅ bgutil generate_once.js compiled (CJS)"

# Copy app source
COPY . .

EXPOSE 3000
CMD ["npm", "start"]

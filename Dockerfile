FROM nikolaik/python-nodejs:python3.11-nodejs20

# Install ffmpeg and system deps
RUN apt-get update && \
    apt-get install -y ffmpeg curl wget && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies for main app
COPY package*.json ./
RUN npm install --production

# Install latest yt-dlp and PoToken provider plugin
RUN pip3 install -U --pre yt-dlp curl-cffi --break-system-packages && \
    pip3 install -U yt-dlp-get-pot bgutil-ytdlp-pot-provider --break-system-packages

# Build bgutil generate_once.js using esbuild
# --loader:.node=empty silently ignores native canvas binaries (not needed since disableInnertube=true)
COPY bgutil-server /tmp/bgutil-server
RUN mkdir -p /root/bgutil-ytdlp-pot-provider/server/build && \
    cd /tmp/bgutil-server && \
    npm install && \
    npx esbuild src/generate_once.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --loader:.node=empty \
    --outfile=/root/bgutil-ytdlp-pot-provider/server/build/generate_once.js && \
    echo "✅ bgutil generate_once.js built successfully"

# Copy app source
COPY . .

# Start the server
EXPOSE 3000
CMD ["npm", "start"]

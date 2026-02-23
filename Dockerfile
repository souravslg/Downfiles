FROM node:20

# Install Python, pip, ffmpeg and SSL libs
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg curl wget libssl-dev ca-certificates git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp, curl_cffi, and bgutil pot provider plugin
RUN pip3 install -U --pre yt-dlp curl_cffi --break-system-packages && \
    pip3 install bgutil-ytdlp-pot-provider --break-system-packages && \
    python3 -c "import curl_cffi; print('curl_cffi OK:', curl_cffi.__version__)"

# Build the bgutil script provider (generate_once.js)
# bgutil needs its server/build to be compiled before use
RUN git clone https://github.com/nicedoc/bgutil-yt-dlp-pot-provider /root/bgutil-ytdlp-pot-provider && \
    cd /root/bgutil-ytdlp-pot-provider/server && \
    npm install && \
    npm run build && \
    echo "bgutil script built OK"

WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the app
COPY . .

EXPOSE 3000
CMD ["node", "server/index.js"]

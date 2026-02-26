FROM nikolaik/python-nodejs:python3.11-nodejs20

# Install system dependencies (Python is already installed in this image, add FFmpeg)
RUN apt-get update && \
    apt-get install -y ffmpeg wget curl unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies: yt-dlp, curl-cffi, PO token provider
RUN pip3 install --no-cache-dir -U --pre yt-dlp curl-cffi bgutil-ytdlp-pot-provider aiohttp

# Install pytubefix separately with --no-deps to avoid nodejs-wheel-binaries conflict
# since node is already provided by the base image
RUN pip3 install --no-cache-dir pytubefix --no-deps

# Set working directory to the API server
WORKDIR /app
COPY . .

# Install main Node dependencies
RUN npm install --omit=dev

# Koyeb usually expects port 8000 or the PORT env var
EXPOSE 8000
ENV PORT=8000

# Start the server
CMD ["npm", "start"]

# Build Version: 2026-02-27-v1
FROM node:20-bookworm

# Use root user for system setup
USER root

# Install Python and all required build tools + libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    build-essential \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Set up a virtual environment for Python
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install Python packages
RUN pip install --no-cache-dir -U --pre yt-dlp
RUN pip install --no-cache-dir curl-cffi bgutil-ytdlp-pot-provider aiohttp
RUN pip install --no-cache-dir pytubefix --no-deps

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Build POT provider server
WORKDIR /app/bgutil-ytdlp-pot-provider/server
RUN npm install
RUN npx -p typescript tsc

# Back to /app
WORKDIR /app
RUN chmod +x start.sh

# Ports
EXPOSE 8000
EXPOSE 4416
ENV PORT=8000

# Start command
CMD ["/bin/bash", "./start.sh"]

# Build Version: 2026-02-27-v2
FROM node:20-bookworm@sha256:65b74d0fb42134c49530a8c34e9f3e4a2fb8e1f99ac4a0eb4e6f314b426183a2

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
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python packages
RUN pip install --no-cache-dir -U --pre yt-dlp
RUN pip install --no-cache-dir curl-cffi bgutil-ytdlp-pot-provider aiohttp
RUN pip install --no-cache-dir pytubefix

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Ensure start.sh is executable
RUN chmod +x start.sh

# Ports
EXPOSE 8000
ENV PORT=8000

# Start command
CMD ["/bin/bash", "./start.sh"]

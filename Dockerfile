# Use a standard Node.js image
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

# Set up a virtual environment for Python to avoid PEP 668 issues
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install Python packages into the virtual environment
RUN pip install --no-cache-dir -U --pre yt-dlp
RUN pip install --no-cache-dir curl-cffi bgutil-ytdlp-pot-provider aiohttp
RUN pip install --no-cache-dir pytubefix

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install node dependencies
RUN npm install --omit=dev

# Install dependencies and build POT provider
WORKDIR /app/bgutil-ytdlp-pot-provider/server
RUN npm install
RUN ./node_modules/.bin/tsc

# Set working directory back to /app
WORKDIR /app

# Copy the rest of the application (respecting .dockerignore)
COPY . .

# Ensure start.sh is executable
RUN chmod +x start.sh

# Ensure the app uses port 8000 (Koyeb default)
EXPOSE 8000
EXPOSE 4416
ENV PORT=8000

# Start command
CMD ["/bin/bash", "./start.sh"]

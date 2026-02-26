FROM nikolaik/python-nodejs:python3.11-nodejs20

# Use root user for system setup
USER root

# Install system dependencies for canvas, ffmpeg and build tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    wget \
    curl \
    unzip \
    build-essential \
    python3-dev \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency files first for better caching
COPY package*.json ./

# Install node dependencies
RUN npm install --omit=dev

# Install python dependencies
RUN pip3 install --no-cache-dir -U --pre yt-dlp 
RUN pip3 install --no-cache-dir curl-cffi bgutil-ytdlp-pot-provider aiohttp
RUN pip3 install --no-cache-dir pytubefix --no-deps

# Copy the rest of the application
COPY . .

# Ensure the app uses port 8000
EXPOSE 8000
ENV PORT=8000

# Start command
CMD ["npm", "start"]

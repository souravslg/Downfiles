#!/bin/bash

# Start POT provider in background
echo "Starting POT provider..."
cd /app/bgutil-ytdlp-pot-provider/server && node build/main.js --port 4416 &

# Wait a few seconds for it to warm up
sleep 5

# Start main application
echo "Starting main application..."
cd /app && npm start

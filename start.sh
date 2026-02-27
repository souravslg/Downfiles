#!/bin/bash

echo "Starting PO Token Provider..."
node bgutil-ytdlp-pot-provider/server/build/main.js &

echo "Starting main application..."
npm start

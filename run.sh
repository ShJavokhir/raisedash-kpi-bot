#!/bin/bash

# Startup script for Enterprise Incident Management Bot

echo "🤖 Starting Enterprise Incident Management Bot..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.example to .env and configure your bot token:"
    echo "  cp .env.example .env"
    echo "  nano .env  # or your preferred editor"
    exit 1
fi

# Check if TELEGRAM_BOT_TOKEN is set
if ! grep -q "^TELEGRAM_BOT_TOKEN=.\+" .env; then
    echo "❌ Error: TELEGRAM_BOT_TOKEN not set in .env file!"
    echo "Please edit .env and add your bot token from @BotFather"
    exit 1
fi

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed!"
    exit 1
fi

# Check if dependencies are installed
if ! python3 -c "import telegram" 2>/dev/null; then
    echo "📦 Installing dependencies..."
    pip3 install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "❌ Error: Failed to install dependencies!"
        exit 1
    fi
fi

echo "✅ All checks passed!"
echo "🚀 Starting bot..."
echo ""
echo "Press Ctrl+C to stop the bot"
echo ""

# Run the bot
python3 bot.py

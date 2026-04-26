#!/bin/bash
# publish.sh - Build and publish all packages

set -e

echo "🔨 Building main package..."
npm run build

echo "🧪 Running tests..."
npm test

echo "📦 Publishing @primo512109/agentforge@0.1.1..."
npm publish --access public

echo "📦 Building create-agentforge..."
cd packages/create-agentforge
npm run build

echo "📦 Publishing create-agentforge@0.1.0..."
npm publish

echo "✅ All packages published!"
echo ""
echo "Usage:"
echo "  npm install @primo512109/agentforge"
echo "  npm create agentforge"

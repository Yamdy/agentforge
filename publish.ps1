# publish.ps1 - Build and publish AgentForge package (Windows)

Write-Host "🔨 Building @primo512109/agentforge@0.1.1..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "🧪 Running tests..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "📦 Publishing to npm..." -ForegroundColor Green
npm publish --access public
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "✅ Published @primo512109/agentforge@0.1.1" -ForegroundColor Green
Write-Host ""
Write-Host "Usage:" -ForegroundColor Yellow
Write-Host "  npm install @primo512109/agentforge"
Write-Host "  npx agentforge init my-agent"

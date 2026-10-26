# Convenience script to launch the Vite development server on Windows
$env:PATH = "C:\Users\munir\AppData\Local\OpenAI\Codex\runtimes\cua_node\cfb32733c877621e\bin;" + $env:PATH
$node = "C:\Users\munir\AppData\Local\OpenAI\Codex\runtimes\cua_node\cfb32733c877621e\bin\node.exe"
$npmCli = "C:\Users\munir\AppData\Local\node\corepack\v1\npm\12.2.1\bin\npm-cli.js"

Write-Host "Starting Vite development server for Gesture-Controlled 3D Machine Explorer..." -ForegroundColor Cyan
& $node $npmCli run dev

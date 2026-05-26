param(
  [string]$Endpoint = "http://localhost:3000/mcp"
)

$ErrorActionPreference = "Stop"

function New-McpSession {
  param(
    [string]$ClientName,
    [int]$RequestId
  )

  $initializeBody = @{
    jsonrpc = "2.0"
    id = $RequestId
    method = "initialize"
    params = @{
      protocolVersion = "2024-11-05"
      capabilities = @{}
      clientInfo = @{
        name = $ClientName
        version = "1.0.0"
      }
    }
  } | ConvertTo-Json -Depth 10

  $initializeResponse = Invoke-WebRequest -Method Post -Uri $Endpoint -ContentType "application/json" -Body $initializeBody

  $sessionId = $initializeResponse.Headers["MCP-Session-Id"]
  if (-not $sessionId) {
    $sessionId = $initializeResponse.Headers["Mcp-Session-Id"]
  }

  if (-not $sessionId) {
    throw "MCP-Session-Id was not found in initialize response headers."
  }

  $initializedBody = @{
    jsonrpc = "2.0"
    method = "notifications/initialized"
    params = @{}
  } | ConvertTo-Json -Depth 10

  Invoke-WebRequest -Method Post -Uri $Endpoint -ContentType "application/json" -Headers @{
    "MCP-Session-Id" = $sessionId
  } -Body $initializedBody | Out-Null

  return $sessionId
}

function Invoke-Counter {
  param(
    [string]$SessionId,
    [int]$RequestId
  )

  $callBody = @{
    jsonrpc = "2.0"
    id = $RequestId
    method = "tools/call"
    params = @{
      name = "counter"
      arguments = @{}
    }
  } | ConvertTo-Json -Depth 10

  $response = Invoke-WebRequest -Method Post -Uri $Endpoint -ContentType "application/json" -Headers @{
    "MCP-Session-Id" = $SessionId
  } -Body $callBody

  return ($response.Content | ConvertFrom-Json)
}

Write-Host "Creating session A..."
$sessionA = New-McpSession -ClientName "verify-client-A" -RequestId 1
Write-Host "Creating session B..."
$sessionB = New-McpSession -ClientName "verify-client-B" -RequestId 2

Write-Host "Session A: $sessionA"
Write-Host "Session B: $sessionB"

$A1 = Invoke-Counter -SessionId $sessionA -RequestId 101
$A2 = Invoke-Counter -SessionId $sessionA -RequestId 102
$B1 = Invoke-Counter -SessionId $sessionB -RequestId 201
$B2 = Invoke-Counter -SessionId $sessionB -RequestId 202
$B3 = Invoke-Counter -SessionId $sessionB -RequestId 203

$textA1 = $A1.result.content[0].text
$textA2 = $A2.result.content[0].text
$textB1 = $B1.result.content[0].text
$textB2 = $B2.result.content[0].text
$textB3 = $B3.result.content[0].text

Write-Host "\nCounter results:"
Write-Host "A1: $textA1"
Write-Host "A2: $textA2"
Write-Host "B1: $textB1"
Write-Host "B2: $textB2"
Write-Host "B3: $textB3"

$countA1 = [int]$A1.result.structuredContent.count
$countA2 = [int]$A2.result.structuredContent.count
$countB1 = [int]$B1.result.structuredContent.count
$countB2 = [int]$B2.result.structuredContent.count
$countB3 = [int]$B3.result.structuredContent.count

if ($countA1 -eq 1 -and $countA2 -eq 2 -and $countB1 -eq 1 -and $countB2 -eq 2 -and $countB3 -eq 3 -and $sessionA -ne $sessionB) {
  Write-Host "\nOK: Stateful session counter is isolated by session." -ForegroundColor Green
  exit 0
}

Write-Host "\nNG: Session-isolated counter verification failed." -ForegroundColor Red
exit 1

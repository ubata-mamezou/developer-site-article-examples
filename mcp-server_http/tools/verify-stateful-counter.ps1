param(
  [string]$Endpoint = "http://127.0.0.1:3000/mcp"
)

$ErrorActionPreference = "Stop"
$mcpHeaders = @{
  "Accept" = "application/json, text/event-stream"
}

# initialize -> notifications/initialized まで実行して、新しいセッションIDを取得する
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

  $initializeResponse = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $Endpoint -ContentType "application/json" -Headers $mcpHeaders -Body $initializeBody

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

  $initializedHeaders = @{
    "Accept" = "application/json, text/event-stream"
    "MCP-Session-Id" = $sessionId
  }

  Invoke-WebRequest -UseBasicParsing -Method Post -Uri $Endpoint -ContentType "application/json" -Headers $initializedHeaders -Body $initializedBody | Out-Null

  return $sessionId
}

# MCPレスポンスをJSONオブジェクトへ変換する（JSON直返し / SSE(data:) の両方に対応）
function Convert-McpResponse {
  param(
    [string]$RawContent
  )

  $trimmed = $RawContent.Trim()

  if ($trimmed.StartsWith("{")) {
    return ($trimmed | ConvertFrom-Json)
  }

  $dataIndex = $RawContent.IndexOf("data:")
  if ($dataIndex -lt 0) {
    throw "Could not parse MCP response as JSON or SSE data lines."
  }

  $candidate = $RawContent.Substring($dataIndex + 5).Trim()
  return ($candidate | ConvertFrom-Json)
}

# counterツールを呼び出し、レスポンスをオブジェクトで返す
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

  $callHeaders = @{
    "Accept" = "application/json, text/event-stream"
    "MCP-Session-Id" = $SessionId
  }

  $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $Endpoint -ContentType "application/json" -Headers $callHeaders -Body $callBody

  try {
    return (Convert-McpResponse -RawContent $response.Content)
  } catch {
    Write-Host "Failed to parse response for session=$SessionId requestId=$RequestId" -ForegroundColor Yellow
    Write-Host "Raw response:" -ForegroundColor Yellow
    Write-Host $response.Content
    throw
  }
}

Write-Host "Creating session A..."
try {
  $sessionA = New-McpSession -ClientName "verify-client-A" -RequestId 1
} catch {
  Write-Host "\nFailed to create session A." -ForegroundColor Red
  Write-Host "Endpoint: $Endpoint"
  Write-Host "Hint: Start the stateful server and ensure /mcp is available on the same host/port." -ForegroundColor Yellow
  Write-Host "      If localhost resolves to another process, try -Endpoint http://127.0.0.1:3000/mcp" -ForegroundColor Yellow
  throw
}
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

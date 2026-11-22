param(
    [Parameter(Mandatory = $true)][string]$BackupRoot,
    [string]$EnvId = 'cloud1-d3go2mtsga3f8ea74',
    [ValidateSet('ExportImport', 'PointInTime')][string]$Method = 'ExportImport'
)

$ErrorActionPreference = 'Stop'
if ($EnvId -ne 'cloud1-d3go2mtsga3f8ea74') {
    throw '本脚本只允许在已确认的专用测试环境执行。'
}
$BackupRoot = (Resolve-Path -LiteralPath $BackupRoot).Path
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($BackupRoot.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw '含访问令牌的原始备份必须放在源码目录之外。'
}
$collections = @('transport_records', 'transport_events', 'photo_records', 'counters')
$prefix = 'audit_' + (Get-Date -Format 'MMddHHmmss') + '_'
$evidence = Join-Path $BackupRoot ('restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $evidence | Out-Null

function Invoke-CloudJson([string[]]$Arguments, [string]$PrivateLogName) {
    if ($Arguments -contains 'restore') {
        # The CLI's --yes mode uses autoConfirm's false default for this command
        # and cancels it. Supply the reviewed, isolated-target confirmation on stdin.
        $lines = 'y' | & tcb @Arguments 2>&1
    } else {
        $lines = & tcb @Arguments 2>&1
    }
    $exitCode = $LASTEXITCODE
    $text = $lines -join "`n"
    if ($PrivateLogName) {
        Set-Content -LiteralPath (Join-Path $evidence $PrivateLogName) -Value $text -Encoding utf8
    }
    if ($exitCode -ne 0) {
        throw "CloudBase 查询或恢复失败；原始诊断保存在本机备份目录，未输出凭据。退出码：$exitCode"
    }
    $jsonStart = [regex]::Match($text, '\{\s*"(?:data|error)"\s*:')
    if (!$jsonStart.Success) { throw 'CLI 未返回 JSON 结果，不能视为操作完成。' }
    return ($text.Substring($jsonStart.Index) | ConvertFrom-Json)
}

function Invoke-ReadCommand([string]$Collection, [string]$Command, [string]$LogName, [string]$CommandType = 'COMMAND') {
    $payload = @(@{ TableName = $Collection; CommandType = $CommandType; Command = $Command })
    return Invoke-CloudJson @('db', 'nosql', 'execute', '-e', $EnvId, '--command',
        (ConvertTo-Json -InputObject $payload -Compress), '--json') $LogName
}

function Save-Documents([string]$Collection, [string]$Path) {
    $all = [System.Collections.Generic.List[object]]::new()
    $offset = 0
    do {
        # Read-only, stable ordering; page until empty rather than assume fixed SDK limits.
        $command = '{"find":"' + $Collection + '","filter":{},"sort":{"_id":1},"skip":' + $offset + ',"limit":100}'
        $response = Invoke-ReadCommand $Collection $command ''
        $page = @($response.data.results[0])
        foreach ($document in $page) { $all.Add($document) }
        $offset += $page.Count
    } while ($page.Count -gt 0)
    ConvertTo-Json -InputObject @($all.ToArray()) -Depth 80 |
        Set-Content -LiteralPath $Path -Encoding utf8
    return $all.Count
}

# Verify every local collection export is present before asking for cloud restore.
foreach ($collection in $collections) {
    $directory = Join-Path $BackupRoot $collection
    $files = @(Get-ChildItem -LiteralPath $directory -File -Filter '*.json' |
        Where-Object { $_.Name -ne 'count.private.json' })
    if ($files.Count -ne 1) { throw "集合备份文件缺失或不唯一：$collection" }
}

$restoreTime = $null
if ($Method -eq 'PointInTime') {
    $times = Invoke-CloudJson @('db', 'nosql', 'backup', 'time', '-e', $EnvId, '--json') 'restore-times.private.json'
    $range = @($times.data.restoreTimeRanges | Sort-Object EndTime)[-1]
    if (!$range.EndTime) { throw '没有可用的恢复区间。' }
    $restoreTime = $range.EndTime
}

# A new namespace only. Never restore onto the four business collections.
$existing = Invoke-ReadCommand 'transport_records' (
    '{"listCollections":1,"filter":{"name":{"$regex":"^' + $prefix + '"}},"nameOnly":true}'
) 'target-existence.private.json'
if (@($existing.data.results[0]).Count -gt 0) {
    throw '隔离集合前缀已存在，停止以防覆盖。'
}

$beforeCounts = @{}
foreach ($collection in $collections) {
    $beforeCounts[$collection] = Save-Documents $collection (Join-Path $evidence "$collection.before.private.json")
}

$mapping = @($collections | ForEach-Object {
    @{ OldTableName = $_; NewTableName = $prefix + $_ }
})
if ($Method -eq 'PointInTime') {
    $restoreResult = Invoke-CloudJson @('db', 'nosql', 'backup', 'restore', '-e', $EnvId,
        '--time', $restoreTime, '--tables', (ConvertTo-Json -InputObject $mapping -Compress),
        '--json') 'restore-start.private.json'
} else {
    foreach ($collection in $collections) {
        $target = $prefix + $collection
        if ($target -in $collections -or !$target.StartsWith($prefix)) { throw '恢复目标保护失败。' }
        $createBody = @{
            EnvId = $EnvId; TableName = $target
            PermissionInfo = @{ AclTag = 'ADMINONLY'; EnvId = $EnvId }
        } | ConvertTo-Json -Depth 5 -Compress
        $null = Invoke-CloudJson @('api', 'tcb', 'CreateTable', '-e', $EnvId, '-r', 'ap-shanghai',
            '--body', $createBody, '--json') "$collection.create.private.json"
        $exportFile = @(Get-ChildItem -LiteralPath (Join-Path $BackupRoot $collection) -Filter '*.json' -File |
            Where-Object { $_.Name -ne 'count.private.json' })[0]
        $normalizedExport = Join-Path $evidence "$collection.normalized-export.private.json"
        & node (Join-Path $PSScriptRoot 'normalize-mongo-export.cjs') $exportFile.FullName $normalizedExport
        if ($LASTEXITCODE -ne 0) { throw '备份格式校验或日期规范化失败。' }
        $rawDocuments = Get-Content -LiteralPath $normalizedExport -Raw
        $documentCount = @($rawDocuments | ConvertFrom-Json).Count
        if ($documentCount -gt 100) { throw '当前试点备份超过单批限制，请先实现分批导入。' }
        if ($documentCount -gt 0) {
            $insert = '{"insert":"' + $target + '","documents":' + $rawDocuments + '}'
            $null = Invoke-ReadCommand $target $insert "$collection.import.private.json" 'INSERT'
        }
    }
}
Write-Output "已执行 $Method 隔离集合恢复；四个原集合未作为恢复目标。"

# Cloud task reads only. A bounded poll prevents a stuck task from being reported as passed.
$deadline = [DateTime]::UtcNow.AddMinutes(5)
$taskCompleted = $false
do {
    if ($Method -eq 'PointInTime') {
        $tasks = Invoke-CloudJson @('db', 'nosql', 'backup', 'task', '-e', $EnvId, '--json') 'restore-tasks.private.json'
    }
    # APIs may evolve their task field names. Completion is ultimately verified by
    # reading all isolated targets and comparing actual contents, not by a status label.
    try {
        $targetCounts = @{}
        foreach ($collection in $collections) {
            $targetCounts[$collection] = Save-Documents ($prefix + $collection) (
                Join-Path $evidence "$collection.restored.private.json"
            )
        }
        $taskCompleted = $true
    } catch {
        if ([DateTime]::UtcNow -ge $deadline) { throw }
        Start-Sleep -Seconds 5
    }
} while (!$taskCompleted -and [DateTime]::UtcNow -lt $deadline)
if (!$taskCompleted) { throw '隔离恢复尚未完成，不能标记通过。' }

foreach ($collection in $collections) {
    $null = Save-Documents $collection (Join-Path $evidence "$collection.after.private.json")
}

# Recursive canonical hashes compare full documents without printing tokens or PII.
$compareScript = @'
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = process.env.MEDIA_RESTORE_EVIDENCE;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && ['$numberInt','$numberLong','$numberDouble'].includes(keys[0])) {
      const number = Number(value[keys[0]]);
      if (!Number.isFinite(number) || (keys[0] === '$numberLong' && !Number.isSafeInteger(number))) {
        return { extended_numeric: String(value[keys[0]]) };
      }
      return number;
    }
    return Object.fromEntries(keys.sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}
const digest = value => crypto.createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');
const rows = ['transport_records','transport_events','photo_records','counters'].map(collection => {
  const read = suffix => JSON.parse(fs.readFileSync(path.join(root, `${collection}.${suffix}.private.json`), 'utf8').replace(/^\uFEFF/, ''));
  const before = read('before'), restored = read('restored'), after = read('after');
  return { collection, original_count: before.length, restored_count: restored.length,
    source_unchanged: digest(before) === digest(after),
    restored_matches: digest(before) === digest(restored),
    original_sha256: digest(before), restored_sha256: digest(restored) };
});
fs.writeFileSync(path.join(root, 'verification.json'), JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows.map(({collection, original_count, restored_count, source_unchanged, restored_matches}) =>
  ({collection, original_count, restored_count, source_unchanged, restored_matches})), null, 2));
if (rows.some(r => !r.source_unchanged || !r.restored_matches)) process.exit(1);
'@
$previousEvidence = $env:MEDIA_RESTORE_EVIDENCE
try {
    $env:MEDIA_RESTORE_EVIDENCE = $evidence
    $compareScript | node
    if ($LASTEXITCODE -ne 0) { throw '内容比对不一致；保留备份与隔离集合供核查，不自动删除。' }
} finally {
    $env:MEDIA_RESTORE_EVIDENCE = $previousEvidence
}
@{
    environment_suffix = '8ea74'; restore_time_raw = $restoreTime; method = $Method
    isolated_prefix = $prefix; verification = 'passed'
    scope = 'logical document contents; numeric EJSON types normalized; indexes, rules, and image re-upload not verified'
} | ConvertTo-Json | Set-Content (Join-Path $evidence 'summary.json') -Encoding utf8
Write-Output "恢复内容比对通过；隔离集合前缀：$prefix。未删除任何集合或文件。"

param(
  [Parameter(Mandatory)][ValidateSet('list','export','apply','status')][string]$Action,
  [string]$Source,[string]$Group,[string]$Session,[string]$Batch,[string]$Translations,
  [ValidateRange(1,20)][int]$Limit=20,
  [ValidateRange(1,55)][int]$WaitSeconds=40,
  [string]$BridgeFile=(Join-Path $PSScriptRoot 'output/assistant-bridge.json')
)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$bridge=Get-Content -LiteralPath $BridgeFile -Raw|ConvertFrom-Json
$headers=@{Authorization="Bearer $($bridge.token)"}
function Request($Path,$Body=$null){
  $options=@{Uri="$($bridge.url)$Path";Headers=$headers;TimeoutSec=10}
  if($null -ne $Body){$options.Method='Post';$options.ContentType='application/json; charset=utf-8';$options.Body=($Body|ConvertTo-Json -Depth 20 -Compress)}
  Invoke-RestMethod @options
}
function WriteJson($Path,$Value){$Value|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $Path -Encoding utf8}
function FinishJob($StatePath){
  $state=Get-Content -LiteralPath $StatePath -Raw|ConvertFrom-Json
  $deadline=[DateTime]::UtcNow.AddSeconds($WaitSeconds)
  do{
    $job=Request "/jobs/$($state.job)"
    if($job.status -eq 'done'){
      if($job.result.error){throw $job.result.error}
      if($state.action -eq 'export'){
        $packet=$job.result;$packet|Add-Member -NotePropertyName session -NotePropertyValue $state.session -Force
        WriteJson (Join-Path $Batch 'packet.json') $packet
      }else{WriteJson (Join-Path $Batch 'receipt.json') $job.result}
      return $job.result
    }
    Start-Sleep -Milliseconds 750
  }while([DateTime]::UtcNow -lt $deadline)
  return @{status='pending';job=$state.job;batch=$Batch;message='任务已保留。保持阅读器打开，稍后用 status -Batch 续查，无需重新提交。'}
}
if($Action -eq 'list'){
  $sessions=Request '/papers'
  foreach($entry in $sessions){
    $papers=@($entry.papers|Where-Object {(!$Group -or $_.group -eq $Group) -and (!$Source -or $_.source -eq $Source)})
    if($papers.Count -and (!$Session -or $entry.session -eq $Session)){
      [pscustomobject]@{session=$entry.session;connected=$entry.connected;visible=$entry.visible;protocol=$entry.protocol;ageSeconds=$entry.ageSeconds;papers=$papers}|ConvertTo-Json -Depth 8
    }
  }
  return
}
if($Action -eq 'export'){
  if(!$Source){throw 'export 必须按完整 -Source 网址选论文；不使用易变的列表序号。'}
  $sessions=Request '/papers'
  $matches=@($sessions|Where-Object {
    (!$Session -or $_.session -eq $Session) -and @($_.papers|Where-Object {$_.source -eq $Source -and (!$Group -or $_.group -eq $Group)}).Count
  })
  if($matches.Count -ne 1){throw '没有唯一匹配的阅读器。先 list，再明确指定 -Session 和 -Source；刷新过旧页面可更新连接。'}
  $Session=$matches[0].session
  if($Batch){throw 'export 的批次目录自动生成；使用 status -Batch 可恢复已有任务。'}
  $Batch=Join-Path $root ('output/assistant/'+[guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $Batch -Force|Out-Null
  $job=Request '/jobs' @{session=$Session;action='export';source=$Source;limit=$Limit}
  WriteJson (Join-Path $Batch 'export.json') @{action='export';job=$job.id;session=$Session;source=$Source}
  Write-Output "Batch: $Batch"
  FinishJob (Join-Path $Batch 'export.json')|ConvertTo-Json -Depth 12
  return
}
if(!$Batch){throw '请指定 -Batch，使用 export 返回的独立批次目录。'}
$Batch=(Resolve-Path -LiteralPath $Batch).Path
if($Action -eq 'status'){
  $path=Join-Path $Batch 'apply.json';if(!(Test-Path -LiteralPath $path)){$path=Join-Path $Batch 'export.json'}
  FinishJob $path|ConvertTo-Json -Depth 12
  return
}
$packetPath=Join-Path $Batch 'packet.json'
if(!(Test-Path -LiteralPath $packetPath)){throw '导出尚未完成，先用 status -Batch 获取原文。'}
$packet=Get-Content -LiteralPath $packetPath -Raw|ConvertFrom-Json
if(!$Translations){$Translations=Join-Path $Batch 'translations.json'}
$values=@(Get-Content -LiteralPath $Translations -Raw|ConvertFrom-Json)
if(!$values.Count -or $values.Count -gt 20){throw '译文文件须含 1–20 项 JSON 数组。'}
if($values[0] -is [string]){
  if($values.Count -ne $packet.items.Count){throw '译文数组长度与本批原文不一致。也可使用含 id、translation 的对象数组。'}
  $values=@(for($i=0;$i -lt $values.Count;$i++){@{id=$packet.items[$i].id;translation=$values[$i]}})
}
$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($values|ConvertTo-Json -Depth 10 -Compress))))
$statePath=Join-Path $Batch 'apply.json'
if(Test-Path -LiteralPath $statePath){
  $previous=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json
  if($previous.hash -eq $hash){FinishJob $statePath|ConvertTo-Json -Depth 12;return}
}
$job=Request '/jobs' @{session=$packet.session;action='apply';source=$packet.source;batch=$packet.id;translations=$values}
WriteJson $statePath @{action='apply';job=$job.id;session=$packet.session;source=$packet.source;hash=$hash}
FinishJob $statePath|ConvertTo-Json -Depth 12

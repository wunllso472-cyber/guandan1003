# 用 Windows 自带的中文语音生成出牌播报（开发占位音频）。
# 用法：powershell -File scripts/gen-voice.ps1 -OutDir <目录>
# 输出 <OutDir>/male/*.wav 与 <OutDir>/female/*.wav，再由 scripts/encode-voice.mjs 转成 mp3。
param([string]$OutDir = "voice-wav")

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}

$lines = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'voice-lines.json') | ConvertFrom-Json
$voices = @{
  male   = @{ match = '*Kangkang*'; pitch = 'default'; rate = '+12%' }
  female = @{ match = '*Huihui*'; pitch = '+5%'; rate = '+12%' }
}

foreach ($kind in $voices.Keys) {
  $cfg = $voices[$kind]
  $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -like $cfg.match } | Select-Object -First 1
  if (-not $voice) { throw "找不到语音 $($cfg.match)" }
  $synth.Voice = $voice
  $dir = Join-Path $OutDir $kind
  New-Item -ItemType Directory -Force $dir | Out-Null
  foreach ($l in $lines) {
    $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><prosody rate='$($cfg.rate)' pitch='$($cfg.pitch)'>$($l.text)</prosody></speak>"
    $stream = Await ($synth.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    $null = Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
    $bytes = New-Object byte[] ([int]$stream.Size)
    $reader.ReadBytes($bytes)
    [IO.File]::WriteAllBytes((Join-Path $dir "$($l.key).wav"), $bytes)
  }
  Write-Output "$kind 完成：$($lines.Count) 条（$($voice.DisplayName)）"
}

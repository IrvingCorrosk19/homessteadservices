# Reproduce Flutter dependents crash: security mark → reopen → reject other
$ErrorActionPreference = "Continue"
$env:Path = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;" + $env:Path
Set-Location "c:\Proyectos\HOMESTEAD SERVICES"

$D = "R8YYA17KR3V"
$BASE = "http://127.0.0.1:3000"
$PKG = "lat.homestead.control"
$ACT = "$PKG/lat.homestead.homestead_control_mobile.MainActivity"
$ev = "docs\auditoria-homestead-app\evidence\a06-flutter-dependents-fix"
$phone = Join-Path $ev "phone"
New-Item -ItemType Directory -Force -Path $phone | Out-Null

# WinRT OCR
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $script:asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
$script:ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$script:n = 0

function Shot([string]$label) {
  $script:n++
  $path = Join-Path $phone ("{0:D2}-{1}.png" -f $script:n, $label)
  & adb -s $D shell screencap -p /sdcard/hc.png | Out-Null
  & adb -s $D pull /sdcard/hc.png $path 2>$null | Out-Null
  return (Resolve-Path $path).Path
}
function OcrPath([string]$path) {
  if (-not (Test-Path $path)) { return @{ text=""; words=@() } }
  $abs = (Resolve-Path $path).Path
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($abs)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($script:ocrEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $words = @()
    foreach ($line in $result.Lines) {
      foreach ($w in $line.Words) {
        $r = $w.BoundingRect
        $words += [pscustomobject]@{ text=$w.Text; x=[int]($r.X + $r.Width/2); y=[int]($r.Y + $r.Height/2) }
      }
    }
    return @{ text=[string]$result.Text; words=$words }
  } catch { return @{ text=""; words=@() } }
}
function OcrHas($ocr,$needle) { return [bool]($ocr.text -and ($ocr.text.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0)) }
function Tap([int]$x,[int]$y) { & adb -s $D shell input tap $x $y | Out-Null; Start-Sleep -Milliseconds 900 }
function TypeText([string]$text) {
  $parts = $text -split '-'
  for ($i=0; $i -lt $parts.Count; $i++) {
    if ($parts[$i].Length -gt 0) { & adb -s $D shell input text $parts[$i] | Out-Null }
    if ($i -lt $parts.Count - 1) { & adb -s $D shell input keyevent 69 | Out-Null }
  }
}
function TapOcr($ocr,$needle) {
  $hits = @($ocr.words | Where-Object { $_.text.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
  if ($hits.Count -eq 0) { return $false }
  $hit = if ($needle -match '^(Contenido|Solicitudes|Inicio)$') { $hits | Sort-Object y | Select-Object -Last 1 } else { $hits | Select-Object -First 1 }
  Tap $hit.x $hit.y
  return $true
}
function DumpUi([string]$name) {
  $p = Join-Path $phone ("ui-{0}.xml" -f $name)
  & adb -s $D shell uiautomator dump /sdcard/ui.xml 2>$null | Out-Null
  & adb -s $D pull /sdcard/ui.xml $p 2>$null | Out-Null
  if (Test-Path $p) { return [string](Get-Content $p -Raw) }
  return ""
}
function TapDesc([string]$desc) {
  $u = DumpUi "desc"
  $esc = [regex]::Escape($desc)
  $m = [regex]::Match($u, ('content-desc="[^"]*{0}[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' -f $esc))
  if (-not $m.Success) { $m = [regex]::Match($u, ('text="[^"]*{0}[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' -f $esc)) }
  if (-not $m.Success) { return $false }
  Tap ([int]((([int]$m.Groups[1].Value)+([int]$m.Groups[3].Value))/2)) ([int]((([int]$m.Groups[2].Value)+([int]$m.Groups[4].Value))/2))
  return $true
}
function OpenReq([string]$id,[string]$label) {
  $ocr = OcrPath (Shot "before-$label")
  if (-not (TapOcr $ocr "Buscar")) { Tap 360 250 }
  Start-Sleep 0.4
  & adb -s $D shell input keyevent 123 | Out-Null
  1..55 | ForEach-Object { & adb -s $D shell input keyevent 67 | Out-Null }
  TypeText $id
  Start-Sleep 0.5
  Tap 660 250
  Start-Sleep 1.2
  & adb -s $D shell input keyevent 111 | Out-Null
  Start-Sleep 0.3
  Tap 360 700
  Start-Sleep 0.3
  $ocr = OcrPath (Shot "search-$label")
  $card = $ocr.words | Where-Object { $_.text -eq $id -and $_.y -gt 300 -and $_.y -lt 900 } | Select-Object -First 1
  if ($card) { Tap 360 ([int]($card.y + 40)) }
  elseif (-not (TapOcr $ocr "Abrir")) { Tap 360 520 }
  Start-Sleep 2.5
  return (Shot "detail-$label")
}

$seed = Get-Content (Join-Path $ev "seed.json") -Raw | ConvertFrom-Json
$secId = [string]$seed.secId
$rejId = [string]$seed.rejId
$reason = "flutter-dependents-" + [guid]::NewGuid().ToString("N").Substring(0,8)
Write-Host "sec=$secId rej=$rejId reason=$reason"

$login = Invoke-RestMethod -Uri "$BASE/api/admin/login" -Method POST -ContentType "application/json" -Headers @{"X-Homestead-Client"="control-mobile"} -Body '{"password":"control-local"}'
$authH = @{ Authorization = "Bearer $($login.session)"; "X-Homestead-Client"="control-mobile" }

# Ensure on Solicitudes
$ocr = OcrPath (Shot "home")
if (-not (TapOcr $ocr "Solicitudes")) { Tap 360 1540 }
Start-Sleep 2

# 1) Open security request
OpenReq $secId "sec" | Out-Null
$ocr = OcrPath (Shot "sec-open")
Write-Host "opened_sec ocr=$($ocr.text.Substring(0,[Math]::Min(120,$ocr.text.Length)))"

# Scroll to Marcar
for ($i=0; $i -lt 8; $i++) {
  $u = DumpUi "scroll-$i"
  if ($u -match 'Marcar') { break }
  & adb -s $D shell input swipe 80 1250 80 700 300 | Out-Null
  Start-Sleep 0.4
}
$tapped = (TapDesc "Marcar revisión seguridad") -or (TapDesc "Marcar")
Write-Host "tapped_marcar=$tapped"
Start-Sleep 1.2
$ocr = OcrPath (Shot "sec-form")
if (OcrHas $ocr "Motivo") {
  $mw = $ocr.words | Where-Object { $_.text -match 'Motivo' } | Select-Object -First 1
  if ($mw) { Tap 360 ([int]($mw.y + 50)); TypeText $reason }
}
Start-Sleep 0.3
if (-not (TapDesc "Confirmar")) { if (-not (TapOcr (OcrPath (Shot "sec-confirm")) "Confirmar")) { Tap 360 1100 } }
Start-Sleep 2.5
Shot "sec-after-confirm" | Out-Null

# Back to list
Tap 48 110
Start-Sleep 1.5
$ocr = OcrPath (Shot "after-back")
Write-Host "after_back=$($ocr.text.Substring(0,[Math]::Min(100,$ocr.text.Length)))"

# Reopen security request
if (-not (OcrHas $ocr "Buscar")) {
  if (-not (TapOcr $ocr "Solicitudes")) { Tap 360 1540 }
  Start-Sleep 1.2
}
$reopenShot = OpenReq $secId "reopen"
$ocr = OcrPath $reopenShot
$red = (OcrHas $ocr "dependents") -or (OcrHas $ocr "Failed assertion") -or (OcrHas $ocr "framework.dart")
Write-Host "reopen_red=$red"
$reopenShot | Out-Null

# Try reject other request
Tap 48 110
Start-Sleep 1.2
& adb -s $D shell am start -n $ACT | Out-Null
Start-Sleep 2
$ocr = OcrPath (Shot "home2")
if (-not (TapOcr $ocr "Solicitudes")) { Tap 360 1540 }
Start-Sleep 1.5
OpenReq $rejId "reject" | Out-Null
$ocr = OcrPath (Shot "reject-open")
$red2 = (OcrHas $ocr "dependents") -or (OcrHas $ocr "Failed assertion")
Write-Host "reject_open_red=$red2"

# API check security
$after = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$secId" -Headers $authH
$req = if ($after.request) { $after.request } else { $after }
Write-Host "secFlag=$($req.securityReviewRequired) reason=$($req.securityReviewReason)"

@{
  secId=$secId; rejId=$rejId; reason=$reason
  reopenRed=$red; rejectOpenRed=$red2
  securityReviewRequired=$req.securityReviewRequired
  securityReviewReason=$req.securityReviewReason
} | ConvertTo-Json | Set-Content (Join-Path $ev "reproduce-summary.json")
Write-Host "DONE"

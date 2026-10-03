# Lifecycle verify: keyboard open â†’ confirm security; cancel dialog; back; reject â€” full logcat
$ErrorActionPreference = "Continue"
$env:Path = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;" + $env:Path
Set-Location "c:\Proyectos\HOMESTEAD SERVICES"

$Device = "R8YYA17KR3V"
$BASE = "http://127.0.0.1:3000"
$PKG = "lat.homestead.control"
$ACT = "$PKG/lat.homestead.homestead_control_mobile.MainActivity"
$ev = "docs\auditoria-homestead-app\evidence\a06-flutter-dependents-lifecycle"
# Keep phone captures under TEMP (no spaces) â€” adb on Windows corrupts when
# concurrent/residue paths with spaces appear in the transport.
$phone = Join-Path $env:TEMP "hc-life-phone"
$phoneFinal = Join-Path $ev "phone"
New-Item -ItemType Directory -Force -Path $phone,(Join-Path $ev "package") | Out-Null
Get-ChildItem $phone -File -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem $phoneFinal -File -ErrorAction SilentlyContinue | Remove-Item -Force
New-Item -ItemType Directory -Force -Path $phoneFinal | Out-Null

$seed = Get-Content (Join-Path $ev "seed.json") -Raw | ConvertFrom-Json
$secId = [string]$seed.secId
$rejId = [string]$seed.rejId
$cancelId = [string]$seed.cancelId
$reason = "life-confirm-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
$rejReason = "life-reject-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
Write-Host "sec=$secId cancel=$cancelId rej=$rejId"

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
  $tmp = Join-Path $env:TEMP ("hc-life-{0:D2}.png" -f $script:n)
  # Prefer exec-out via cmd to avoid adb pull transport glitches on Windows.
  cmd /c "adb -s $Device exec-out screencap -p > `"$tmp`"" | Out-Null
  if (-not (Test-Path $tmp) -or (Get-Item $tmp).Length -lt 1000) {
    & adb -s $Device shell screencap -p /sdcard/hc.png | Out-Null
    cmd /c "adb -s $Device pull /sdcard/hc.png `"$tmp`"" | Out-Null
  }
  if (Test-Path $tmp) { Copy-Item $tmp $path -Force }
  if (-not (Test-Path $path) -or (Get-Item $path).Length -lt 1000) {
    Write-Host "SHOT_FAIL label=$label tmpExists=$(Test-Path $tmp) tmpLen=$((Get-Item $tmp -EA SilentlyContinue).Length)"
    return $null
  }
  return (Resolve-Path $path).Path
}
function OcrPath([string]$path) {
  if (-not $path -or -not (Test-Path $path)) { return @{ text=""; words=@() } }
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
function OcrHas($ocr, $needle) { return [bool]($ocr.text -and ($ocr.text.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0)) }
function IsRed($ocr) { return (OcrHas $ocr "dependents") -or (OcrHas $ocr "Failed assertion") -or (OcrHas $ocr "framework.dart") }
function Tap([int]$x,[int]$y) { & adb -s $Device shell input tap $x $y | Out-Null; Start-Sleep -Milliseconds 850 }
function TypeText([string]$text) {
  $parts = $text -split '-'
  for ($i=0; $i -lt $parts.Count; $i++) {
    if ($parts[$i].Length -gt 0) { & adb -s $Device shell input text $parts[$i] | Out-Null }
    if ($i -lt $parts.Count - 1) { & adb -s $Device shell input keyevent 69 | Out-Null }
  }
}
function TapOcr($ocr, $needle) {
  $hits = @($ocr.words | Where-Object { $_.text.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
  if ($hits.Count -eq 0) { return $false }
  $hit = if ($needle -match '^(Contenido|Solicitudes|Inicio)$') { $hits | Sort-Object y | Select-Object -Last 1 } else { $hits | Select-Object -First 1 }
  Tap $hit.x $hit.y
  return $true
}
function DumpUi([string]$name) {
  $p = Join-Path $phone ("ui-{0}.xml" -f $name)
  $tmp = Join-Path $env:TEMP ("hc-ui-{0}.xml" -f $name)
  & adb -s $Device shell uiautomator dump /sdcard/ui.xml 2>$null | Out-Null
  & adb -s $Device pull /sdcard/ui.xml $tmp 2>$null | Out-Null
  if (Test-Path $tmp) { Copy-Item $tmp $p -Force }
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
function GoSolicitudes() {
  $ocr = OcrPath (Shot "tabs")
  if (-not (TapOcr $ocr "Solicitudes")) { Tap 360 1540 }
  Start-Sleep 2
}
function OpenReq([string]$id, [string]$label) {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $ocr = OcrPath (Shot "before-$label-a$attempt")
    if (-not (OcrHas $ocr "Buscar")) { GoSolicitudes; $ocr = OcrPath (Shot "list-$label-a$attempt") }
    if (-not (TapOcr $ocr "Buscar")) { Tap 360 250 }
    Start-Sleep 0.5
    # Clear search thoroughly (KEYCODE_MOVE_END then many DEL)
    & adb -s $Device shell input keyevent 123 | Out-Null
    1..80 | ForEach-Object { & adb -s $Device shell input keyevent 67 | Out-Null }
    TypeText $id
    Start-Sleep 0.6
    Tap 660 250
    Start-Sleep 1.4
    $ocr = OcrPath (Shot "search-$label-a$attempt")
    $tail = ($id -split '-')[-1]
    $card = $ocr.words | Where-Object { ($_.text -eq $id -or $_.text -eq $tail) -and $_.y -gt 300 -and $_.y -lt 1100 } | Sort-Object y | Select-Object -First 1
    if ($card) { Tap 360 ([int]($card.y + 40)) }
    elseif (-not (TapOcr $ocr "Abrir")) { Tap 360 520 }
    Start-Sleep 2.5
    $detail = Shot "detail-$label-a$attempt"
    $docr = OcrPath $detail
    if ((OcrHas $docr $id) -or (OcrHas $docr $tail)) {
      Write-Host "OpenReq ok id=$id attempt=$attempt"
      return $detail
    }
    Write-Host "OpenReq MISMATCH want=$id gotTxt=$($docr.text.Substring(0,[Math]::Min(80,$docr.text.Length))) attempt=$attempt"
    Tap 48 110
    Start-Sleep 1.2
  }
  return (Shot "detail-$label-fail")
}
function TapMarcar($ocr) {
  $hits = @($ocr.words | Where-Object { $_.text -match '^Marcar' -and $_.y -gt 850 })
  if ($hits.Count -gt 0) { Tap 360 $hits[0].y; return $true }
  # Avoid uiautomator/DumpUi here â€” OCR-only to reduce adb chatter.
  return (TapOcr $ocr "Marcar")
}

$login = Invoke-RestMethod -Uri "$BASE/api/admin/login" -Method POST -ContentType "application/json" -Headers @{"X-Homestead-Client"="control-mobile"} -Body '{"password":"control-local"}'
$authH = @{ Authorization = "Bearer $($login.session)"; "X-Homestead-Client"="control-mobile" }

$logFileFinal = Join-Path $ev "logcat-full.txt"
Remove-Item $logFileFinal -Force -EA SilentlyContinue
& adb -s $Device reverse tcp:3000 tcp:3000 | Out-Null
& adb -s $Device shell am force-stop com.sec.android.app.camera 2>$null | Out-Null
& adb -s $Device shell am force-stop $PKG | Out-Null
Start-Sleep 1
& adb -s $Device logcat -c | Out-Null
& adb -s $Device shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 | Out-Null
Start-Sleep 1
& adb -s $Device shell am start -n $ACT | Out-Null
$deadline = (Get-Date).AddSeconds(25)
do {
  $f = (& adb -s $Device shell dumpsys window 2>$null | Select-String "mCurrentFocus").ToString()
  if ($f -match "lat\.homestead\.control") { break }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
Start-Sleep 3
$appPid = ((& adb -s $Device shell pidof $PKG).Trim() -split '\s+')[0]
Write-Host "appPid=$appPid"
# No concurrent logcat â€” dump at end to avoid adb transport corruption on Windows.

$ocr = OcrPath (Shot "home")
for ($i=0; $i -lt 18; $i++) {
  if ((OcrHas $ocr "Inicio") -or (OcrHas $ocr "Solicitudes") -or (OcrHas $ocr "ENTORNO")) { break }
  Start-Sleep 1
  $ocr = OcrPath (Shot "wait-home-$i")
}
GoSolicitudes

# --- A) CANCEL path: open cancelId, open dialog, Cancelar, back ---
$detailShot = OpenReq $cancelId "cancel"
$ocr = OcrPath $detailShot
Write-Host "cancel_detail_red=$(IsRed $ocr)"
TapMarcar $ocr | Out-Null
Start-Sleep 1.3
$ocr = OcrPath (Shot "cancel-dialog")
$dialogOpen = (OcrHas $ocr "Motivo") -or (OcrHas $ocr "Confirmar") -or (OcrHas $ocr "Cancelar")
Write-Host "cancel_dialog=$dialogOpen"
if ($dialogOpen) {
  if (-not (TapOcr $ocr "Cancelar")) { TapDesc "Cancelar" | Out-Null }
  Start-Sleep 1.5
}
$ocr = OcrPath (Shot "cancel-after")
$cancelRed = IsRed $ocr
Write-Host "cancel_after_red=$cancelRed"
Tap 48 110
Start-Sleep 1.2
$ocr = OcrPath (Shot "cancel-back")
$cancelBackRed = IsRed $ocr
Write-Host "cancel_back_red=$cancelBackRed"

# --- B) CONFIRM with keyboard open ---
$detailShot = OpenReq $secId "sec"
$ocr = OcrPath $detailShot
TapMarcar $ocr | Out-Null
Start-Sleep 1.3
$ocr = OcrPath (Shot "sec-dialog")
$secForm = (OcrHas $ocr "Motivo") -and ((OcrHas $ocr "Confirmar") -or (OcrHas $ocr "seguridad"))
Write-Host "sec_form=$secForm"
if ($secForm) {
  $mw = $ocr.words | Where-Object { $_.text -match "Motivo" } | Select-Object -First 1
  if ($mw) { Tap 360 ([int]($mw.y + 50)); TypeText $reason }
  Start-Sleep 0.5
  $ocr = OcrPath (Shot "sec-keyboard-open")
  # Confirm WHILE keyboard likely still open (no ESCAPE)
  if (-not (TapOcr $ocr "Confirmar")) {
    $cw = $ocr.words | Where-Object { $_.text -match "Confirmar" } | Select-Object -First 1
    if ($cw) { Tap $cw.x $cw.y } else { TapDesc "Confirmar" | Out-Null }
  }
  Start-Sleep 3.0
}
$ocr = OcrPath (Shot "sec-after-confirm")
$secConfirmRed = IsRed $ocr
Write-Host "sec_confirm_red=$secConfirmRed txt=$($ocr.text.Substring(0,[Math]::Min(120,$ocr.text.Length)))"
Tap 48 110
Start-Sleep 1.2
$ocr = OcrPath (Shot "sec-back")
$secBackRed = IsRed $ocr
Write-Host "sec_back_red=$secBackRed"

# reopen
$detailShot = OpenReq $secId "reopen"
$ocr = OcrPath $detailShot
$reopenRed = IsRed $ocr
$hasBanner = (OcrHas $ocr "requerida") -or (OcrHas $ocr "Revisi") -or ($ocr.text -match "SECURITY_REVIEW")
Write-Host "reopen_red=$reopenRed hasBanner=$hasBanner"
Tap 48 110
Start-Sleep 1.2

# --- C) REJECT ---
$detailShot = OpenReq $rejId "reject"
$ocr = OcrPath $detailShot
$rh = @($ocr.words | Where-Object { $_.text -eq "Rechazar" -and $_.y -gt 700 })
if ($rh.Count -gt 0) { Tap 360 $rh[0].y } else { TapDesc "Rechazar" | Out-Null }
Start-Sleep 1.8
$ocr = OcrPath (Shot "reject-sheet")
$rejSheet = (OcrHas $ocr "Rechazar solicitud") -or (OcrHas $ocr "Confirmo") -or (OcrHas $ocr "Motivo")
Write-Host "reject_sheet=$rejSheet"
if ($rejSheet) {
  $det = $ocr.words | Where-Object { $_.text -match "Detalle" } | Select-Object -First 1
  if ($det) { Tap 360 ([int]($det.y + 45)); TypeText $rejReason; Start-Sleep 0.5 }
  # Dismiss keyboard without opening Motivo dropdown (BACK hides IME)
  & adb -s $Device shell input keyevent 4 | Out-Null
  Start-Sleep 0.6
  # Scroll sheet so Confirmo + submit are visible
  & adb -s $Device shell input swipe 360 1200 360 400 400 | Out-Null
  Start-Sleep 0.7
  $ocr = OcrPath (Shot "reject-scrolled")
  if (-not (TapOcr $ocr "Confirmo")) {
    $u = DumpUi "rej-confirm"
    $cm = [regex]::Match($u, 'content-desc="[^"]*Confirmo[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
    if ($cm.Success) {
      Tap ([int]((([int]$cm.Groups[1].Value)+([int]$cm.Groups[3].Value))/2)) ([int]((([int]$cm.Groups[2].Value)+([int]$cm.Groups[4].Value))/2))
    } else {
      # Fallback: checkbox is typically left of the Confirmo label
      $cw = $ocr.words | Where-Object { $_.text -match "Confirmo" } | Select-Object -First 1
      if ($cw) { Tap ([int]($cw.x - 80)) $cw.y } else { Tap 72 1180 }
    }
  }
  Start-Sleep 1.0
  $ocr = OcrPath (Shot "reject-checked")
  $u = DumpUi "rej-submit"
  $all = [regex]::Matches($u, 'content-desc="Rechazar solicitud"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
  $picked = $null
  foreach ($m in $all) {
    $slice = $u.Substring([Math]::Max(0, $m.Index - 80), [Math]::Min(300, $u.Length - [Math]::Max(0, $m.Index - 80)))
    if ($slice -match 'enabled="true"' -and [int]$m.Groups[2].Value -gt 900) { $picked = $m; break }
  }
  if ($picked) {
    Tap ([int]((([int]$picked.Groups[1].Value)+([int]$picked.Groups[3].Value))/2)) ([int]((([int]$picked.Groups[2].Value)+([int]$picked.Groups[4].Value))/2))
  } elseif (-not (TapOcr $ocr "Rechazar")) {
    Tap 360 1435
  }
  Start-Sleep 3.5
}
$ocr = OcrPath (Shot "reject-after")
$rejAfterRed = IsRed $ocr
if (-not $rejSheet) { $rejSheetClosed = $false }
else { $rejSheetClosed = -not ((OcrHas $ocr "Confirmo esta") -and (OcrHas $ocr "Enviar mensaje")) }
Write-Host "reject_after_red=$rejAfterRed reject_sheet_closed=$rejSheetClosed txt=$($ocr.text.Substring(0,[Math]::Min(100,$ocr.text.Length)))"

# Dump logcat after run (no concurrent reader)
$tmpLog = Join-Path $env:TEMP "hc-life-logcat.txt"
& adb -s $Device logcat -d -v threadtime --pid=$appPid | Out-File -FilePath $tmpLog -Encoding utf8
Copy-Item $tmpLog $logFileFinal -Force

$afterSec = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$secId" -Headers $authH
$secReq = if ($afterSec.request) { $afterSec.request } else { $afterSec }
$afterCancel = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$cancelId" -Headers $authH
$canReq = if ($afterCancel.request) { $afterCancel.request } else { $afterCancel }
$afterRej = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$rejId" -Headers $authH
$rejReq = if ($afterRej.request) { $afterRej.request } else { $afterRej }

$exc = @(Select-String -Path $logFileFinal -Pattern "EXCEPTION CAUGHT|dependents\.isEmpty|Failed assertion|TextEditingController was used" -ErrorAction SilentlyContinue)
# Sanitized full journey: keep flutter/IME/HTTP-ish lines; drop BufferQueue/SurfaceView noise.
Get-Content $logFileFinal -EA SilentlyContinue | Where-Object {
  $_ -match 'flutter|Flutter|EXCEPTION|dependents|Failed assertion|AndroidRuntime|InputMethod|security|disposition|REJECT|CANCELLED|Http|okhttp|Dio|API|ERROR|WARN|reject|Confirmar|Motivo'
} | Set-Content (Join-Path $ev "package\logcat-sanitized-full.txt")
# Also keep a chronological timeline excerpt (first/last + middle markers) in package
Copy-Item $logFileFinal (Join-Path $ev "package\logcat-full-raw.txt") -Force

$summary = [ordered]@{
  apk = "1.1.11+13"
  secId = $secId; cancelId = $cancelId; rejId = $rejId
  reason = $reason; rejReason = $rejReason
  cancelDialogRed = $cancelRed; cancelBackRed = $cancelBackRed
  secConfirmRed = $secConfirmRed; secBackRed = $secBackRed; reopenRed = $reopenRed; hasBanner = $hasBanner
  rejectAfterRed = $rejAfterRed; rejectSheetClosed = $rejSheetClosed
  securityReviewRequired = [bool]$secReq.securityReviewRequired
  securityReviewReason = [string]$secReq.securityReviewReason
  cancelStillUnmarked = -not [bool]$canReq.securityReviewRequired
  rejectStatus = [string]$rejReq.status
  dispositionKind = [string]$rejReq.dispositionKind
  exceptions = $exc.Count
  logLines = (Get-Content (Join-Path $ev "package\logcat-sanitized-full.txt") -EA SilentlyContinue | Measure-Object).Count
  pass = (
    (-not $cancelRed) -and (-not $cancelBackRed) -and (-not $secConfirmRed) -and (-not $secBackRed) -and
    (-not $reopenRed) -and $hasBanner -and (-not $rejAfterRed) -and $rejSheetClosed -and
    [bool]$secReq.securityReviewRequired -and (-not [bool]$canReq.securityReviewRequired) -and
    ([string]$rejReq.status -match 'CANCELLED|REJECTED' -or [string]$rejReq.dispositionKind -match 'REJECT') -and
    ($exc.Count -eq 0)
  )
}
$summary | ConvertTo-Json | Set-Content (Join-Path $ev "verify-summary.json")
$summary | ConvertTo-Json
# Copy phone evidence back into repo evidence dir
Copy-Item (Join-Path $phone "*") $phoneFinal -Force -ErrorAction SilentlyContinue
Write-Host "DONE"



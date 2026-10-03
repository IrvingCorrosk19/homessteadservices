# Verify Flutter dependents fix: security → reopen → reject (no red screen)
$ErrorActionPreference = "Continue"
$env:Path = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;" + $env:Path
Set-Location "c:\Proyectos\HOMESTEAD SERVICES"

$D = "R8YYA17KR3V"
$BASE = "http://127.0.0.1:3000"
$PKG = "lat.homestead.control"
$ACT = "$PKG/lat.homestead.homestead_control_mobile.MainActivity"
$ev = "docs\auditoria-homestead-app\evidence\a06-flutter-dependents-fix"
$phone = Join-Path $ev "phone-verify"
New-Item -ItemType Directory -Force -Path $phone | Out-Null
Get-ChildItem $phone -File -ErrorAction SilentlyContinue | Remove-Item -Force

$seed = Get-Content (Join-Path $ev "seed.json") -Raw | ConvertFrom-Json
$secId = [string]$seed.secId
$rejId = [string]$seed.rejId
$reason = "flutter-fix-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
$rejReason = "reject-fix-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
Write-Host "sec=$secId rej=$rejId reason=$reason"

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
function Tap([int]$x,[int]$y) { & adb -s $D shell input tap $x $y | Out-Null; Start-Sleep -Milliseconds 900 }
function TypeText([string]$text) {
  $parts = $text -split '-'
  for ($i=0; $i -lt $parts.Count; $i++) {
    if ($parts[$i].Length -gt 0) { & adb -s $D shell input text $parts[$i] | Out-Null }
    if ($i -lt $parts.Count - 1) { & adb -s $D shell input keyevent 69 | Out-Null }
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
function OpenReq([string]$id, [string]$label) {
  $ocr = OcrPath (Shot "before-$label")
  if (-not (OcrHas $ocr "Buscar")) {
    if (-not (TapOcr $ocr "Solicitudes")) { Tap 360 1540 }
    Start-Sleep 1.5
    $ocr = OcrPath (Shot "list-$label")
  }
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
  $ocr = OcrPath (Shot "search-$label")
  $tail = ($id -split '-')[-1]
  $card = $ocr.words | Where-Object { ($_.text -eq $id -or $_.text -eq $tail) -and $_.y -gt 300 -and $_.y -lt 1000 } | Select-Object -First 1
  if ($card) { Tap 360 ([int]($card.y + 40)) }
  elseif (-not (TapOcr $ocr "Abrir")) { Tap 360 520 }
  Start-Sleep 2.5
  return (Shot "detail-$label")
}

$login = Invoke-RestMethod -Uri "$BASE/api/admin/login" -Method POST -ContentType "application/json" -Headers @{"X-Homestead-Client"="control-mobile"} -Body '{"password":"control-local"}'
$authH = @{ Authorization = "Bearer $($login.session)"; "X-Homestead-Client"="control-mobile" }

# Logcat for exceptions during verify
$logFile = Join-Path $ev "logcat-verify.txt"
Remove-Item $logFile -Force -EA SilentlyContinue
& adb -s $D reverse tcp:3000 tcp:3000 | Out-Null
& adb -s $D shell am force-stop com.sec.android.app.camera 2>$null | Out-Null
& adb -s $D shell am force-stop $PKG | Out-Null
Start-Sleep 1
& adb -s $D logcat -c | Out-Null
& adb -s $D shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 | Out-Null
Start-Sleep 1
& adb -s $D shell am start -n $ACT | Out-Null
# Wait until Homestead Control has window focus
$deadline = (Get-Date).AddSeconds(25)
do {
  $f = (& adb -s $D shell dumpsys window 2>$null | Select-String "mCurrentFocus").ToString()
  if ($f -match "lat\.homestead\.control") { break }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
Start-Sleep 3
$appPid = ((& adb -s $D shell pidof $PKG).Trim() -split '\s+')[0]
Write-Host "appPid=$appPid focus=$(& adb -s $D shell dumpsys window 2>$null | Select-String 'mCurrentFocus' | Select-Object -First 1)"
$logProc = Start-Process -FilePath "adb" -ArgumentList @("-s",$D,"logcat","-v","threadtime","--pid=$appPid") -RedirectStandardOutput $logFile -WindowStyle Hidden -PassThru

$ocr = OcrPath (Shot "home")
# Wait for real home UI (not splash)
for ($i=0; $i -lt 20; $i++) {
  if ((OcrHas $ocr "Inicio") -or (OcrHas $ocr "Solicitudes") -or (OcrHas $ocr "ENTORNO") -or (OcrHas $ocr "Entrar")) { break }
  Start-Sleep 1
  $ocr = OcrPath (Shot "wait-home-$i")
}
if ((OcrHas $ocr "Entrar") -or (OcrHas $ocr "Contrase")) {
  if (-not (TapOcr $ocr "Contrase")) { Tap 360 540 }
  TypeText "control-local"; Start-Sleep 0.5
  if (-not (TapOcr (OcrPath (Shot "login")) "Entrar")) { Tap 360 700 }
  Start-Sleep 4
  $ocr = OcrPath (Shot "home2")
}
if (-not (OcrHas $ocr "Solicitudes") -and -not (OcrHas $ocr "Inicio")) {
  Write-Host "FATAL_NOT_IN_APP ocr=$($ocr.text.Substring(0,[Math]::Min(120,$ocr.text.Length)))"
  Stop-Process -Id $logProc.Id -Force -ErrorAction SilentlyContinue
  throw "app not on control home"
}
if (-not (TapOcr $ocr "Solicitudes")) { Tap 360 1540 }
Start-Sleep 2

# 1) Security mark
$detail = OpenReq $secId "sec"
$ocr = OcrPath $detail
Write-Host "opened_sec red=$(IsRed $ocr) txt=$($ocr.text.Substring(0,[Math]::Min(100,$ocr.text.Length)))"
# Marcar is usually already visible on detail; prefer OCR (uiautomator often omits Flutter labels)
$ocr = OcrPath (Shot "sec-pre-marcar")
$tapped = $false
$hits = @($ocr.words | Where-Object { $_.text -match '^Marcar' -and $_.y -gt 900 })
if ($hits.Count -gt 0) { Tap 360 $hits[0].y; $tapped = $true }
if (-not $tapped) { $tapped = (TapDesc "Marcar revisión seguridad") -or (TapDesc "Marcar") }
if (-not $tapped) { $tapped = TapOcr $ocr "Marcar" }
Write-Host "tapped_marcar=$tapped"
Start-Sleep 1.4
$ocr = OcrPath (Shot "sec-form")
$secForm = (OcrHas $ocr "Motivo") -and ((OcrHas $ocr "Marcar revisión de seguridad") -or (OcrHas $ocr "quedará marcada") -or (OcrHas $ocr "Confirmar"))
Write-Host "sec_form=$secForm txt=$($ocr.text.Substring(0,[Math]::Min(120,$ocr.text.Length)))"
if (-not $secForm) {
  Write-Host "FATAL_NO_SECURITY_FORM"
} else {
  if (OcrHas $ocr "Motivo") {
    $mw = $ocr.words | Where-Object { $_.text -match "Motivo" } | Select-Object -First 1
    if ($mw) { Tap 360 ([int]($mw.y + 50)); TypeText $reason }
  }
  Start-Sleep 0.4
  # Do NOT send keyevent 111 (ESCAPE) — it dismisses AlertDialog.
  # App unfocuses in onPressed before pop.
  $ocr = OcrPath (Shot "sec-pre-confirm")
  if (-not (TapOcr $ocr "Confirmar")) {
    if (-not (TapDesc "Confirmar")) {
      $cw = $ocr.words | Where-Object { $_.text -match "Confirmar" } | Select-Object -First 1
      if ($cw) { Tap $cw.x $cw.y } else { Tap 520 980 }
    }
  }
  Start-Sleep 2.8
}
$ocr = OcrPath (Shot "sec-after-confirm")
$secConfirmRed = IsRed $ocr
Write-Host "sec_confirm_red=$secConfirmRed txt=$($ocr.text.Substring(0,[Math]::Min(120,$ocr.text.Length)))"

# Back to list
Tap 48 110
Start-Sleep 1.5
$ocr = OcrPath (Shot "after-back")
$backRed = IsRed $ocr
Write-Host "after_back_red=$backRed"

# 2) Reopen security request
$reopenShot = OpenReq $secId "reopen"
$ocr = OcrPath $reopenShot
$reopenRed = IsRed $ocr
$hasBanner = (OcrHas $ocr "seguridad") -or (OcrHas $ocr "Revisión") -or (OcrHas $ocr $reason.Substring(0,[Math]::Min(12,$reason.Length)))
Write-Host "reopen_red=$reopenRed hasBanner=$hasBanner"

# API check security
$afterSec = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$secId" -Headers $authH
$secReq = if ($afterSec.request) { $afterSec.request } else { $afterSec }
Write-Host "API secFlag=$($secReq.securityReviewRequired) reason=$($secReq.securityReviewReason)"

# Back then reject other
Tap 48 110
Start-Sleep 1.2
$rejDetail = OpenReq $rejId "reject"
$ocr = OcrPath $rejDetail
$rejOpenRed = IsRed $ocr
Write-Host "reject_open_red=$rejOpenRed"

# Scroll to Rechazar
$ocr = OcrPath (Shot "pre-reject")
$tr = $false
$rh = @($ocr.words | Where-Object { $_.text -eq "Rechazar" -and $_.y -gt 700 })
if ($rh.Count -gt 0) { Tap 360 $rh[0].y; $tr = $true }
if (-not $tr) { $tr = (TapDesc "Rechazar") -or (TapOcr $ocr "Rechazar") }
Write-Host "tapped_reject=$tr"
Start-Sleep 1.8
$ocr = OcrPath (Shot "reject-sheet")
$rejSheet = (OcrHas $ocr "Rechazar solicitud") -or (OcrHas $ocr "Confirmo") -or (OcrHas $ocr "categoría")
Write-Host "reject_sheet=$rejSheet"
if ($rejSheet) {
  # Optional reason
  $det = $ocr.words | Where-Object { $_.text -match "Detalle" } | Select-Object -First 1
  if ($det) { Tap 360 ([int]($det.y + 45)); TypeText $rejReason; Start-Sleep 0.3 }
  # Confirm checkbox
  if (-not (TapDesc "Confirmo esta acción")) {
    $ocr = OcrPath (Shot "reject-confirm-ready")
    $cw = $ocr.words | Where-Object { $_.text -match "Confirmo" } | Select-Object -First 1
    if ($cw) { Tap 72 $cw.y } else { Tap 60 1200 }
  }
  Start-Sleep 0.6
  # Ensure send-to-customer stays OFF (default)
  # Submit
  if (-not (TapDesc "Rechazar solicitud")) {
    if (-not (TapOcr (OcrPath (Shot "reject-submit")) "Rechazar solicitud")) { Tap 360 1350 }
  }
  Start-Sleep 3
}
$ocr = OcrPath (Shot "reject-after")
$rejAfterRed = IsRed $ocr
Write-Host "reject_after_red=$rejAfterRed"

$afterRej = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$rejId" -Headers $authH
$rejReq = if ($afterRej.request) { $afterRej.request } else { $afterRej }
Write-Host "API status=$($rejReq.status) disposition=$($rejReq.dispositionKind) sendCustomer=$($rejReq.sendCustomerMessage)"

Stop-Process -Id $logProc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep 1
$exc = @(Select-String -Path $logFile -Pattern "EXCEPTION CAUGHT|dependents\.isEmpty|Failed assertion|TextEditingController was used" -ErrorAction SilentlyContinue)
Write-Host "VERIFY_EXCEPTIONS=$($exc.Count)"

$summary = [ordered]@{
  secId = $secId
  rejId = $rejId
  reason = $reason
  rejReason = $rejReason
  secConfirmRed = $secConfirmRed
  afterBackRed = $backRed
  reopenRed = $reopenRed
  rejectOpenRed = $rejOpenRed
  rejectAfterRed = $rejAfterRed
  securityReviewRequired = [bool]$secReq.securityReviewRequired
  securityReviewReason = [string]$secReq.securityReviewReason
  rejectStatus = [string]$rejReq.status
  dispositionKind = [string]$rejReq.dispositionKind
  historyCount = @($rejReq.history).Count
  verifyExceptions = $exc.Count
  apk = "1.1.10+12"
  sha256 = "EC96485F8B6C16F7313998BD94C9D44AA4F5097F22386226EDBF09E1A95B833B"
}
$summary | ConvertTo-Json | Set-Content (Join-Path $ev "verify-summary.json")
$summary | ConvertTo-Json
Write-Host "DONE"

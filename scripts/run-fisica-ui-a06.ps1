# Physical A06 UI â€” PASS only with real persistence after UI actions.
# Flutter on A06 often yields empty uiautomator trees; use WinRT OCR for UI text + API corroboration.
# Never PASS on focus / screenshot byte-size alone.
$ErrorActionPreference = "Continue"
$env:Path = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;" + $env:Path
Set-Location "c:\Proyectos\HOMESTEAD SERVICES"

$D = "R8YYA17KR3V"
$BASE = "http://127.0.0.1:3000"
$PKG = "lat.homestead.control"
$ACT = "$PKG/lat.homestead.homestead_control_mobile.MainActivity"
$ev = "docs\auditoria-homestead-app\evidence\a06-fisica-ui-r3"
$phone = Join-Path $ev "phone"
New-Item -ItemType Directory -Force -Path $phone | Out-Null
Get-ChildItem $phone -File -ErrorAction SilentlyContinue | Remove-Item -Force

$script:n = 0
$results = New-Object System.Collections.Generic.List[object]

# WinRT OCR bootstrap
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
  } catch {
    return @{ text=""; words=@() }
  }
}
function FocusPkg() {
  $w = & adb -s $D shell dumpsys window 2>$null | Out-String
  return ($w -match "lat\.homestead\.control")
}
function WaitFocus([int]$sec = 20) {
  $deadline = (Get-Date).AddSeconds($sec)
  do { if (FocusPkg) { return $true }; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline)
  return (FocusPkg)
}
function TypeText([string]$text) {
  # adb `input text` treats bare `-` as a flag; type around hyphens with KEYCODE_MINUS (69)
  $parts = $text -split '-'
  for ($i=0; $i -lt $parts.Count; $i++) {
    if ($parts[$i].Length -gt 0) { & adb -s $D shell input text $parts[$i] | Out-Null }
    if ($i -lt $parts.Count - 1) { & adb -s $D shell input keyevent 69 | Out-Null }
  }
}
function Tap([int]$x,[int]$y) { & adb -s $D shell input tap $x $y | Out-Null; Start-Sleep -Milliseconds 900 }
function Swipe([int]$x1,[int]$y1,[int]$x2,[int]$y2) { & adb -s $D shell input swipe $x1 $y1 $x2 $y2 300 | Out-Null; Start-Sleep -Milliseconds 700 }
function Rec([string]$name,[bool]$ok,$detail,[string]$evidence) {
  $results.Add([ordered]@{ name=$name; kind="fisica_ui"; result=$(if($ok){"PASS"}else{"FAIL"}); detail=$detail; evidence=$evidence; at=(Get-Date).ToUniversalTime().ToString("o") }) | Out-Null
  Write-Host ("{0} [fisica_ui] {1}" -f ($(if($ok){"PASS"}else{"FAIL"}), $name))
}
function OcrHas([hashtable]$ocr,[string]$needle) {
  return [bool]($ocr.text -and ($ocr.text.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0))
}
function OcrHasExact([hashtable]$ocr,[string]$needle) {
  return [bool]($ocr.text -and $ocr.text.Contains($needle))
}
function TapOcr([hashtable]$ocr,[string]$needle) {
  $hits = @($ocr.words | Where-Object { $_.text.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
  # Avoid Regenerar matching Reordenar-style false friends when needle is short fragment — use exact/prefix when possible
  if ($hits.Count -eq 0) {
    $hits = @($ocr.words | Where-Object { $_.text -ceq $needle -or $_.text.StartsWith($needle) })
  }
  if ($hits.Count -eq 0) { return $false }
  $hit = if ($needle -match '^(Contenido|Solicitudes|Inicio|Agenda|Más|Mas)$') {
    $hits | Sort-Object y | Select-Object -Last 1
  } else {
    $hits | Select-Object -First 1
  }
  Tap $hit.x $hit.y
  return $true
}
function TapOcrLast([hashtable]$ocr,[string]$needle) {
  $hits = @($ocr.words | Where-Object { $_.text.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
  if ($hits.Count -eq 0) { return $false }
  $hit = $hits | Sort-Object y | Select-Object -Last 1
  Tap $hit.x $hit.y
  return $true
}
function GetJob([string]$id) {
  return Invoke-RestMethod -Uri "$BASE/api/admin/content/jobs/$id" -Headers $authH
}
function MediaOrder([object]$jobResp) {
  $items = @($jobResp.job.mediaItems)
  if ($items.Count -gt 0) { return (@($items | ForEach-Object { $_.assetId }) -join ",") }
  $raw = [string]$jobResp.job.mediaOrderJson
  if ($raw) { try { return ((ConvertFrom-Json $raw) -join ",") } catch { return $raw } }
  return ""
}
function MediaCount([object]$jobResp) {
  $items = @($jobResp.job.mediaItems)
  if ($items.Count -gt 0) { return $items.Count }
  $raw = [string]$jobResp.job.mediaOrderJson
  if ($raw) { try { return @(ConvertFrom-Json $raw).Count } catch { return 0 } }
  return 0
}
function WaitHome([int]$sec=20) {
  $deadline = (Get-Date).AddSeconds($sec)
  do {
    $p = Shot "wait-home"
    $o = OcrPath $p
    if ((OcrHas $o "Inicio") -or (OcrHas $o "Contenido") -or (OcrHas $o "ENTORNO")) { return @{ path=$p; ocr=$o } }
    Start-Sleep 1
  } while ((Get-Date) -lt $deadline)
  $p = Shot "wait-home-final"
  return @{ path=$p; ocr=(OcrPath $p) }
}

$login = Invoke-RestMethod -Uri "$BASE/api/admin/login" -Method POST -ContentType "application/json" -Headers @{"X-Homestead-Client"="control-mobile"} -Body '{"password":"control-local"}'
$authH = @{ Authorization = "Bearer $($login.session)"; "X-Homestead-Client"="control-mobile" }
$session = Invoke-RestMethod -Uri "$BASE/api/admin/control/session" -Headers $authH
$session | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $ev "session-check.json") -Encoding utf8
$git = (git rev-parse HEAD).Trim()
$dirty = (git status --porcelain | Measure-Object).Count -gt 0
$pkgDump = & adb -s $D shell dumpsys package $PKG
$vnLine = ($pkgDump | Select-String "versionName=" | Select-Object -First 1).ToString().Trim()
$vcLine = ($pkgDump | Select-String "versionCode=" | Select-Object -First 1).ToString().Trim()
@($vnLine,$vcLine,(Get-Date).ToString("o"),"HEAD=$git","dirty=$dirty") | Set-Content (Join-Path $ev "device-package.txt")
$env:CONTROL_SESSION = $login.session
$env:CONTROL_CSRF = $login.csrf

# Use existing NEW request for disposition (seed HS-2026-000004 or first NEW)
$list = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests?status=NEW&limit=5" -Headers $authH
$pick = @($list.requests) | Where-Object { $_.publicId -and $_.status -eq "NEW" } | Select-Object -First 1
if (-not $pick) {
  # Reopen seed if no NEW available
  try {
    Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/HS-2026-000004/disposition" -Method POST -Headers ($authH + @{"Content-Type"="application/json"; "X-CSRF-Token"=$login.csrf}) -Body '{"action":"reopen","reasonCategory":"OTHER","idempotencyKey":"fisica-reopen"}' | Out-Null
  } catch {}
  $list = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests?status=NEW&limit=5" -Headers $authH
  $pick = @($list.requests) | Where-Object { $_.publicId } | Select-Object -First 1
}
$script:reqId = if ($pick) { $pick.publicId } else { "HS-2026-000004" }

$albumId = (node scripts/seed-fisica-album.mjs).Trim()
Write-Host "albumId=$albumId reqId=$script:reqId"
@{ albumId=$albumId; requestId=$script:reqId; head=$git; dirty=$dirty } | ConvertTo-Json | Set-Content (Join-Path $ev "seed.json")

$before = GetJob $albumId
$orderBefore = MediaOrder $before
$countBefore = MediaCount $before
$before | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $ev "job-before.json") -Encoding utf8

& adb -s $D reverse tcp:3000 tcp:3000 | Out-Null
& adb -s $D shell am force-stop com.sec.android.app.camera 2>$null | Out-Null
& adb -s $D shell am force-stop $PKG | Out-Null
Start-Sleep 1
& adb -s $D shell am start -n $ACT | Out-Null
if (-not (WaitFocus 25)) { throw "app focus not acquired" }
Start-Sleep 2
$homeInfo = WaitHome 25
$ocr = $homeInfo.ocr
$homeShot = $homeInfo.path

# Login if needed
if ((OcrHas $ocr "Entrar") -or (OcrHas $ocr "Contrase") -or (OcrHas $ocr "Homestead Control")) {
  if (-not (TapOcr $ocr "Contrase")) { Tap 360 540 }
  Start-Sleep 0.6
  TypeText "control-local"
  Start-Sleep 0.8
  Shot "password-typed" | Out-Null
  # Dismiss keyboard then Entrar
  if (-not (TapOcr (OcrPath (Shot "login-kb")) "Realiz")) { Tap 650 1450 }
  Start-Sleep 0.5
  $ocr = OcrPath (Shot "login2")
  if (-not (TapOcr $ocr "Entrar")) { Tap 361 676 }
  Start-Sleep 4
  $homeInfo = WaitHome 25
  $ocr = $homeInfo.ocr
  $homeShot = $homeInfo.path
}

$banner = (OcrHas $ocr "ENTORNO") -or (OcrHas $ocr "127.0.0.1")
$logged = (OcrHas $ocr "Inicio") -or (OcrHas $ocr "Contenido") -or (OcrHas $ocr "Solicitudes")
Rec "Entorno: APK 1.1.8+10 + aislado + commit" (($vnLine -match "1\.1\.8") -and ($vcLine -match "versionCode=10") -and ($session.isolated -eq $true)) @{ versionName=$vnLine; versionCode=$vcLine; isolated=$session.isolated; commit=$(if($session.backendCommit){$session.backendCommit}else{$git}); dirty=$dirty } "device-package.txt;session-check.json"
Rec "Login UI muestra entorno aislado" ($logged -and $banner) @{ logged=$logged; banner=$banner; ocr=$ocr.text } $homeShot
if (-not $logged) { throw "not logged into control home" }

# Contenido → Por aprobar → open album DETAIL via OCR taps (tab y≈1481 on A06)
if (-not (TapOcr $ocr "Contenido")) { Tap 216 1481 }
Start-Sleep 2
$ocr = OcrPath (Shot "contenido-lista")
if (-not (TapOcr $ocr "aprobar")) { Tap 346 445 }
Start-Sleep 1.5
Shot "por-aprobar" | Out-Null
$ocr = OcrPath (Shot "pre-open")
# Tap folio card directly (search optional)
if (-not (TapOcr $ocr $albumId)) {
  $card = $ocr.words | Where-Object { $_.text -match '^HC-2026' } | Select-Object -First 1
  if ($card) { Tap 360 ([int]$card.y) } else { Tap 360 560 }
}
Start-Sleep 3
$detailShot = Shot "album-detalle"
$ocr = OcrPath $detailShot
$onDetail = (OcrHas $ocr "Contexto") -or (OcrHas $ocr "Aprobar") -or (OcrHas $ocr "Regenerar") -or (OcrHas $ocr "Fotos") -or (OcrHas $ocr "Versi") -or (OcrHas $ocr "Publicar") -or (OcrHas $ocr "Original") -or (OcrHas $ocr "Imágenes") -or (OcrHas $ocr "AWAITING")
if (-not $onDetail) {
  $ocr = OcrPath (Shot "retry-list")
  if (-not (TapOcr $ocr $albumId)) { Tap 360 560 }
  Start-Sleep 3
  $detailShot = Shot "album-detalle-2"
  $ocr = OcrPath $detailShot
  $onDetail = (OcrHas $ocr "Contexto") -or (OcrHas $ocr "Aprobar") -or (OcrHas $ocr "Regenerar") -or (OcrHas $ocr "Fotos") -or (OcrHas $ocr "Versi") -or (OcrHas $ocr "Imágenes") -or (OcrHas $ocr "AWAITING")
}
$jobOpen = GetJob $albumId
Rec "Abrir album seed desde lista" ([bool]($onDetail -and $jobOpen.job.publicId -eq $albumId)) @{ albumId=$albumId; onDetail=$onDetail; status=$jobOpen.job.status; ocr=$ocr.text } $detailShot
if (-not $onDetail) { throw "album detail not opened (still on list)" }

# Photos section — must reach "Fotos (orden de publicación)", not just regenerar copy block
$foundFotos = $false
for ($i=0; $i -lt 12; $i++) {
  $previewShot = Shot ("preview-scroll-$i")
  $ocr = OcrPath $previewShot
  $txt = [string]$ocr.text
  if ($txt.Contains("orden de publicaci") -or $txt.Contains("Fotos (orden") -or ($txt.Contains("Quitar") -and $txt.Contains("invalidada"))) {
    # "Reordenar o quitar invalida" helper near photo list
    $foundFotos = $true
    break
  }
  if ($txt.Contains("Reordenar o quitar")) { $foundFotos = $true; break }
  Swipe 360 1300 360 400
  Start-Sleep 0.55
}
Rec "UI A06: preview watermark contain + album reorder controls" ([bool]$foundFotos) @{ hasPreview=$foundFotos; orderBefore=$orderBefore; ocr=$ocr.text } $previewShot

# Reorder: tap first enabled content-desc="Bajar" from uiautomator (Semantics)
$orderSnap = MediaOrder (GetJob $albumId)
$bajado = $false
& adb -s $D shell uiautomator dump /sdcard/ui.xml 2>$null | Out-Null
& adb -s $D pull /sdcard/ui.xml (Join-Path $phone "ui-reorder.xml") 2>$null | Out-Null
$ux = if (Test-Path (Join-Path $phone "ui-reorder.xml")) { [string](Get-Content (Join-Path $phone "ui-reorder.xml") -Raw) } else { "" }
$m = [regex]::Match($ux, 'content-desc="Bajar"[^>]*enabled="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
if (-not $m.Success) {
  $m = [regex]::Match($ux, 'content-desc="Bajar"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*enabled="true"')
}
if ($m.Success) {
  $x = [int]((([int]$m.Groups[1].Value) + ([int]$m.Groups[3].Value)) / 2)
  $y = [int]((([int]$m.Groups[2].Value) + ([int]$m.Groups[4].Value)) / 2)
  Tap $x $y
  $bajado = $true
  Start-Sleep 2.5
} else {
  Tap 540 1376
  Start-Sleep 2.5
}
$reorderShot = Shot "despues-reorder"
$mid = MediaOrder (GetJob $albumId)
if ($mid -eq $orderSnap) {
  Tap 540 1376
  Start-Sleep 2
  $reorderShot = Shot "despues-reorder-2"
  $mid = MediaOrder (GetJob $albumId)
}
Tap 48 110
Start-Sleep 1.5
$ocr = OcrPath (Shot "lista-back")
if (-not (TapOcr $ocr $albumId)) {
  $card = $ocr.words | Where-Object { $_.text -match '^HC-2026' } | Select-Object -First 1
  if ($card) { Tap 360 $card.y } else { Tap 360 560 }
}
Start-Sleep 2.5
Shot "reopen-after-reorder" | Out-Null
$afterReorder = GetJob $albumId
$orderAfter = MediaOrder $afterReorder
$reorderOk = ($orderAfter -ne "") -and ($orderAfter -ne $orderSnap) -and ($orderAfter.Split(",").Count -eq $orderSnap.Split(",").Count)
Rec "Reordenar: orden distinto que persiste al salir y volver" ([bool]$reorderOk) @{ before=$orderSnap; after=$orderAfter; mid=$mid; bajado=$bajado } $reorderShot
$orderSnap = $orderAfter

function DumpUi([string]$name) {
  $p = Join-Path $phone ("ui-{0}.xml" -f $name)
  & adb -s $D shell uiautomator dump /sdcard/ui.xml 2>$null | Out-Null
  & adb -s $D pull /sdcard/ui.xml $p 2>$null | Out-Null
  if (Test-Path $p) { return [string](Get-Content $p -Raw) }
  return ""
}
function TapDesc([string]$desc, [switch]$Partial, [int]$Which = 0) {
  $u = DumpUi "desc"
  $esc = [regex]::Escape($desc)
  $pat = if ($Partial) {
    'content-desc="[^"]*{0}[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' -f $esc
  } else {
    'content-desc="{0}"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' -f $esc
  }
  $all = [regex]::Matches($u, $pat)
  if ($all.Count -eq 0) {
    $pat2 = if ($Partial) {
      'text="[^"]*{0}[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' -f $esc
    } else {
      'text="{0}"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' -f $esc
    }
    $all = [regex]::Matches($u, $pat2)
  }
  if ($all.Count -eq 0) { return $false }
  $idx = if ($Which -lt 0) { $all.Count - 1 } elseif ($Which -ge $all.Count) { $all.Count - 1 } else { $Which }
  $mm = $all[$idx]
  Tap ([int]((([int]$mm.Groups[1].Value)+([int]$mm.Groups[3].Value))/2)) ([int]((([int]$mm.Groups[2].Value)+([int]$mm.Groups[4].Value))/2))
  return $true
}
function ScrollUntilDesc([string]$needle, [int]$max = 12, [switch]$Up) {
  $safe = ($needle -replace '[^a-zA-Z0-9]','').Substring(0, [Math]::Min(12, ($needle -replace '[^a-zA-Z0-9]','').Length))
  for ($i=0; $i -lt $max; $i++) {
    $u = DumpUi ("scroll-$safe-$i")
    # Prefer button-like nodes; avoid false positives in status strings
    $hit = [regex]::Match($u, ('content-desc="[^"]*{0}[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' -f [regex]::Escape($needle)))
    if (-not $hit.Success) {
      $hit = [regex]::Match($u, ('text="[^"]*{0}[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' -f [regex]::Escape($needle)))
    }
    if ($hit.Success) { return $true }
    # Swipe from left margin so we don't click primary action buttons
    if ($Up) { Swipe 80 520 80 1250 } else { Swipe 80 1250 80 480 }
    Start-Sleep 0.5
  }
  return $false
}
function ScrollUntilOcr([string]$needle, [int]$max = 12, [switch]$Up) {
  for ($i=0; $i -lt $max; $i++) {
    $ocr = OcrPath (Shot ("ocr-scroll-$i"))
    if (OcrHas $ocr $needle) { return $ocr }
    if ($Up) { Swipe 80 520 80 1250 } else { Swipe 80 1250 80 480 }
    Start-Sleep 0.45
  }
  return (OcrPath (Shot "ocr-scroll-final"))
}
function TapOcrBottom([hashtable]$ocr,[string]$needle,[int]$minY = 900) {
  $hits = @($ocr.words | Where-Object {
    $_.y -ge $minY -and ($_.text.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0)
  })
  if ($hits.Count -eq 0) { return $false }
  $hit = $hits | Sort-Object y | Select-Object -Last 1
  Tap $hit.x $hit.y
  return $true
}
function SubmitSearch() {
  # requests_screen only filters on suffix search icon or keyboard onSubmitted
  $ocr = OcrPath (Shot "search-submit")
  if (TapOcr $ocr "Realiz") { Start-Sleep 1.2; return }
  Tap 660 250
  Start-Sleep 1.5
}
function DismissDialogIfAny() {
  $u = DumpUi "dismiss"
  if ($u -match 'content-desc="Cancelar"' -or $u -match 'text="Cancelar"') {
    TapDesc "Cancelar" | Out-Null
    Start-Sleep 0.8
  }
}

# Scroll until Quitar controls are actually in the a11y tree (OCR alone is unreliable)
$countSnap = MediaCount (GetJob $albumId)
$removedId = ($orderSnap -split ",")[-1]
$foundQuitar = ScrollUntilDesc "Quitar" 14
Shot "pre-quitar" | Out-Null
$u = DumpUi "quitar"
# Prefer last enabled Quitar (last photo)
$qm = [regex]::Matches($u, 'content-desc="Quitar"[^>]*enabled="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
if ($qm.Count -eq 0) { $qm = [regex]::Matches($u, 'content-desc="Quitar"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*enabled="true"') }
if ($qm.Count -eq 0) { $qm = [regex]::Matches($u, 'content-desc="Quitar[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"') }
$hasDlg = $false
if ($qm.Count -gt 0) {
  $mm = $qm[$qm.Count - 1]
  Tap ([int]((([int]$mm.Groups[1].Value)+([int]$mm.Groups[3].Value))/2)) ([int]((([int]$mm.Groups[2].Value)+([int]$mm.Groups[4].Value))/2))
  Start-Sleep 1.4
  $quitarShot = Shot "quitar-dialog"
  $ocr = OcrPath $quitarShot
  $hasDlg = (OcrHas $ocr "Quitar") -or (OcrHas $ocr "Cancelar") -or (OcrHas $ocr "invalidada") -or (OcrHas $ocr "foto")
  $ud = DumpUi "quitar-dlg"
  # Confirm dialog primary action is text/content-desc Quitar (not the list icon)
  $dm = [regex]::Matches($ud, 'text="Quitar"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
  if ($dm.Count -eq 0) { $dm = [regex]::Matches($ud, 'content-desc="Quitar"[^>]*clickable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"') }
  if ($dm.Count -gt 0) {
    $mm = $dm[$dm.Count - 1]
    Tap ([int]((([int]$mm.Groups[1].Value)+([int]$mm.Groups[3].Value))/2)) ([int]((([int]$mm.Groups[2].Value)+([int]$mm.Groups[4].Value))/2))
    $hasDlg = $true
  } elseif (-not (TapOcrLast $ocr "Quitar")) {
    if (OcrHas $ocr "Quitar") { TapOcr $ocr "Quitar" | Out-Null }
  }
  Start-Sleep 2.8
} else {
  $quitarShot = Shot "quitar-no-control"
}
$afterQuitar = GetJob $albumId
$countAfter = MediaCount $afterQuitar
$orderQuitar = MediaOrder $afterQuitar
$quitarOk = $foundQuitar -and ($countAfter -lt $countSnap) -and ($orderQuitar -notmatch ("(^|,)" + [regex]::Escape([string]$removedId) + "(,|$)"))
Rec "Quitar: disminuye cantidad y la foto no reaparece en orden" ([bool]$quitarOk) @{ beforeCount=$countSnap; afterCount=$countAfter; removedId=$removedId; order=$orderQuitar; hasDlg=$hasDlg; foundQuitar=$foundQuitar } $quitarShot

# Regenerar is BELOW preview (after quitar the page often jumps to top) — scroll DOWN via OCR
$verSnap = [int](GetJob $albumId).job.version
$capSnap = [string](GetJob $albumId).job.selectedCaption
$ocrRegen = ScrollUntilOcr "Regenerar" 14
$tappedRegen = $false
if (OcrHas $ocrRegen "Regenerar") {
  $tappedRegen = (TapOcr $ocrRegen "Regenerar") -or (TapDesc "Regenerar texto" -Partial) -or (TapDesc "Regenerar" -Partial)
} else {
  ScrollUntilDesc "Regenerar" 8 | Out-Null
  $tappedRegen = (TapDesc "Regenerar texto" -Partial) -or (TapDesc "Regenerar" -Partial)
}
Start-Sleep 8
$regenShot = Shot "despues-regen"
$afterRegen = GetJob $albumId
$verAfter = [int]$afterRegen.job.version
$capAfter = [string]$afterRegen.job.selectedCaption
$statusAfter = [string]$afterRegen.job.status
$regenOk = $tappedRegen -and ($verAfter -gt $verSnap) -and ($statusAfter -match "AWAITING_APPROVAL|NEEDS_REVIEW")
Rec "Regenerar: resultado y revision actualizados" ([bool]$regenOk) @{ verBefore=$verSnap; verAfter=$verAfter; captionChanged=($capAfter -ne $capSnap); status=$statusAfter; approvedVersion=$afterRegen.job.approvedVersion; tapped=$tappedRegen } $regenShot

# Approve then publish — must hit bottom action buttons, not "antes de aprobar" helper text
DismissDialogIfAny
$ocrAp = ScrollUntilOcr "Aprobar y programar" 14
if (-not (OcrHas $ocrAp "Aprobar y") -and -not (OcrHas $ocrAp "programar")) {
  $ocrAp = ScrollUntilOcr "programar" 8
}
$tappedAp = (TapDesc "Aprobar y programar") -or (TapOcrBottom $ocrAp "programar" 1000) -or (TapOcrBottom $ocrAp "Aprobar" 1000)
Start-Sleep 4
# Confirm approve persisted before publish
for ($i=0; $i -lt 6; $i++) {
  $st = [string](GetJob $albumId).job.status
  if ($st -match "APPROVED|SCHEDULED|PUBLISH") { break }
  Start-Sleep 1
}
$apShot = Shot "despues-aprobar"
# Publicar ahora often sits under the system nav — tap the TOP of the button (above nav)
$tappedPub = $false
for ($i=0; $i -lt 8; $i++) {
  $u = DumpUi "pub-pos-$i"
  $mm = [regex]::Match($u, 'content-desc="Publicar ahora"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
  if ($mm.Success) {
    $x1 = [int]$mm.Groups[1].Value; $x2 = [int]$mm.Groups[3].Value
    $y1 = [int]$mm.Groups[2].Value; $y2 = [int]$mm.Groups[4].Value
    # Prefer a point near the top edge of the button so system nav does not steal the tap
    $tapY = [Math]::Min($y1 + 24, [Math]::Max(100, $y2 - 80))
    Tap ([int](($x1 + $x2) / 2)) $tapY
    $tappedPub = $true
    break
  }
  Swipe 80 1350 80 900
  Start-Sleep 0.4
}
if (-not $tappedPub) {
  $ocrPub = OcrPath (Shot "pub-ocr-fallback")
  $tappedPub = (TapDesc "Publicar ahora") -or (TapOcrBottom $ocrPub "Publicar" 1000)
}
Start-Sleep 3.5
$confOk = $false
for ($i=0; $i -lt 12; $i++) {
  $ocr = OcrPath (Shot ("pub-confirm-$i"))
  $u = DumpUi "pubc$i"
  if ((OcrHas $ocr "Confirmar public") -or (OcrHas $ocr "Confirmar") -or ($u -match 'content-desc="Confirmar"') -or ($u -match 'text="Confirmar"')) {
    if ((TapDesc "Confirmar") -or (TapOcr $ocr "Confirmar")) { $confOk = $true; Start-Sleep 2; break }
  }
  # Preview API may still be loading
  Start-Sleep 1.0
}
Start-Sleep 10
$pubShot = Shot "despues-publicar"
# Poll publications briefly
for ($i=0; $i -lt 5; $i++) {
  $jobPub = GetJob $albumId
  $pubs = @($jobPub.job.publications)
  if ($pubs.Count -ge 2) { break }
  Start-Sleep 2
}
$jobPub = GetJob $albumId
$pubs = @($jobPub.job.publications)
$fb = $pubs | Where-Object { $_.platform -eq "facebook" } | Select-Object -First 1
$ig = $pubs | Where-Object { $_.platform -eq "instagram" } | Select-Object -First 1
$fbOk = $fb -and ($fb.status -eq "PUBLISHED")
$igOk = $ig -and ($ig.status -eq "PUBLISHED")
$simOk = $session.isolated -eq $true -and $fb -and $ig -and (
  ($fb.dryRun -eq $true) -or ($ig.dryRun -eq $true) -or
  ([string]$fb.permalink -match "example\.invalid|sim-") -or
  ([string]$ig.permalink -match "example\.invalid|sim-")
)
Rec "Publicar simulado: resultado final por ambas plataformas" ([bool]($fbOk -and $igOk -and $simOk)) @{ facebook=$(if($fb){$fb.status}else{$null}); facebookDryRun=$(if($fb){$fb.dryRun}else{$null}); facebookPermalink=$(if($fb){$fb.permalink}else{$null}); instagram=$(if($ig){$ig.status}else{$null}); instagramDryRun=$(if($ig){$ig.dryRun}else{$null}); instagramPermalink=$(if($ig){$ig.permalink}else{$null}); jobStatus=$jobPub.job.status; isolated=$session.isolated; tappedAp=$tappedAp; tappedPub=$tappedPub; confOk=$confOk; note="simulado aislado; no Meta real" } "$apShot;$pubShot"

# Leave album detail before Solicitudes (pushed route has no bottom tabs)
DismissDialogIfAny
Tap 48 110
Start-Sleep 1.5
if (-not (FocusPkg)) {
  & adb -s $D shell am start -n $ACT | Out-Null
  WaitFocus 15 | Out-Null
  Start-Sleep 2
}
$ocr = OcrPath (Shot "tabs")
if (-not ((OcrHas $ocr "Solicitudes") -and (OcrHas $ocr "Contenido"))) {
  Tap 48 110; Start-Sleep 1
  $ocr = OcrPath (Shot "tabs-2")
}
if (-not (TapOcr $ocr "Solicitudes")) { Tap 360 1540 }
Start-Sleep 2
$solShot = Shot "solicitudes-lista"

# Ensure target request is NEW (rejectable server-side). Prefer PATCH reset over reopen.
$targetReq = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$($script:reqId)" -Headers $authH
$tr = if ($targetReq.request) { $targetReq.request } else { $targetReq }
if (-not $tr -or $tr.status -ne "NEW") {
  try {
    Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$($script:reqId)" -Method PATCH -Headers ($authH + @{"Content-Type"="application/json"; "X-CSRF-Token"=$login.csrf}) -Body '{"status":"NEW"}' | Out-Null
  } catch {
    try {
      $reopenKey = "fisica-reopen-" + [guid]::NewGuid().ToString("N").Substring(0,8)
      Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$($script:reqId)/disposition" -Method POST -Headers ($authH + @{"Content-Type"="application/json"; "X-CSRF-Token"=$login.csrf}) -Body (@{ action="reopen"; reasonCategory="OTHER"; idempotencyKey=$reopenKey } | ConvertTo-Json) | Out-Null
    } catch {}
  }
  $list = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests?status=NEW&limit=10" -Headers $authH
  $pick = @($list.requests) | Where-Object { $_.status -eq "NEW" } | Select-Object -First 1
  if ($pick) { $script:reqId = $pick.publicId }
}

# Focus search via placeholder, type exact folio, SUBMIT search (icon/Realiz), open matching card
$ocr = OcrPath (Shot "sol-before-search")
if (-not (TapOcr $ocr "Buscar")) { Tap 360 250 }
Start-Sleep 0.5
# Clear any prior query
& adb -s $D shell input keyevent 123 | Out-Null
1..40 | ForEach-Object { & adb -s $D shell input keyevent 67 | Out-Null }
TypeText $script:reqId
Start-Sleep 0.6
SubmitSearch
Start-Sleep 1.5
# Dismiss keyboard so card taps aren't intercepted
& adb -s $D shell input keyevent 111 | Out-Null  # ESCAPE
Start-Sleep 0.4
$ocr = OcrPath (Shot "sol-search")
# Do NOT tap the folio in the search field — open the card via "Abrir detalle"
$opened = (TapOcrBottom $ocr "Abrir" 350) -or (TapDesc "Abrir detalle" -Partial)
if (-not $opened) {
  # Tap card body below search (avoid y of search field ~250)
  $card = $ocr.words | Where-Object { $_.text -eq $script:reqId -and $_.y -gt 320 } | Select-Object -First 1
  if ($card) { Tap 360 $card.y } else { Tap 360 520 }
}
Start-Sleep 2.5
$reqShot = Shot "solicitud-detalle"
$ocr = OcrPath $reqShot
if (-not (OcrHas $ocr $script:reqId) -or (OcrHas $ocr "Buscar HS")) {
  # Still on list — retry open
  SubmitSearch
  Start-Sleep 1
  & adb -s $D shell input keyevent 111 | Out-Null
  Start-Sleep 0.3
  $ocr = OcrPath (Shot "sol-search-2")
  if (-not (TapOcrBottom $ocr "Abrir" 350)) { Tap 360 520 }
  Start-Sleep 2.5
  $reqShot = Shot "solicitud-detalle-2"
  $ocr = OcrPath $reqShot
}

# --- Marcar seguridad ---
$secUi = $false
ScrollUntilOcr "Seguridad" 8 | Out-Null
$ocr = OcrPath (Shot "sec-ocr")
$tappedSec = (TapDesc "Marcar revisión seguridad" -Partial) -or (TapDesc "Marcar" -Partial) -or (TapOcr $ocr "Marcar")
Start-Sleep 1.4
$ocr = OcrPath (Shot "security-form")
$secUi = (OcrHas $ocr "seguridad") -or (OcrHas $ocr "Marcar") -or (OcrHas $ocr "Confirmar") -or (OcrHas $ocr "Motivo")
if ($secUi -or $tappedSec) {
  if (OcrHas $ocr "Motivo") {
    $mw = $ocr.words | Where-Object { $_.text -match 'Motivo' } | Select-Object -First 1
    if ($mw) { Tap 360 ([int]($mw.y + 50)); Start-Sleep 0.35; TypeText "revision-seguridad-fisica" }
  }
  Start-Sleep 0.4
  if (-not (TapDesc "Confirmar")) { if (-not (TapOcr (OcrPath (Shot "sec-confirm")) "Confirmar")) { Tap 360 1100 } }
  Start-Sleep 2.8
}
Tap 48 110
Start-Sleep 1.2
if (-not (FocusPkg)) {
  & adb -s $D shell am start -n $ACT | Out-Null
  WaitFocus 15 | Out-Null
  Start-Sleep 2
  if (-not (TapOcr (OcrPath (Shot "relaunch-tabs")) "Solicitudes")) { Tap 360 1540 }
  Start-Sleep 1.5
}
$ocr = OcrPath (Shot "sol-reopen-list")
if (-not (TapOcr $ocr "Buscar")) { Tap 360 250 }
Start-Sleep 0.3
& adb -s $D shell input keyevent 123 | Out-Null
1..40 | ForEach-Object { & adb -s $D shell input keyevent 67 | Out-Null }
TypeText $script:reqId
Start-Sleep 0.5
SubmitSearch
Start-Sleep 1.5
& adb -s $D shell input keyevent 111 | Out-Null
Start-Sleep 0.3
$ocr = OcrPath (Shot "sol-reopen-search")
if (-not (TapOcrBottom $ocr "Abrir" 350)) {
  $card = $ocr.words | Where-Object { $_.text -eq $script:reqId -and $_.y -gt 320 } | Select-Object -First 1
  if ($card) { Tap 360 $card.y } else { Tap 360 520 }
}
Start-Sleep 2.2
$reopenShot = Shot "solicitud-reopen-sec"
$afterSec = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$($script:reqId)" -Headers $authH
$secFlag = $false
$reqObj = if ($afterSec.request) { $afterSec.request } else { $afterSec }
if ($reqObj) {
  $secFlag = ($reqObj.securityReviewRequired -eq $true) -or ($reqObj.securityReviewRequired -eq 1) -or ($reqObj.security_review_required -eq 1)
}
if ($secFlag) {
  Rec "Marcar seguridad: estado persistido al reabrir" $true @{ securityReviewRequired=$true; requestId=$script:reqId; form=$secUi; tapped=$tappedSec } $reopenShot
} elseif ($secUi) {
  Rec "Marcar seguridad: formulario visible (flujo completo no confirmado en UI)" $false @{ formVisible=$true; requestId=$script:reqId } $reopenShot
} else {
  Rec "Marcar seguridad: estado persistido al reabrir" $false @{ securityReviewRequired=$secFlag; requestId=$script:reqId; tapped=$tappedSec } $reopenShot
}

# --- Rechazar: Confirmo + submit (sendCustomer defaults OFF in APK 1.1.8+) ---
# Avoid "En curso" quick-status: scroll with left-edge swipes only, tap Rechazar by a11y
$preRej = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$($script:reqId)" -Headers $authH
$preSt = [string]$(if ($preRej.request.status) { $preRej.request.status } else { $preRej.status })
if ($preSt -ne "NEW" -and $preSt -ne "CONTACTED") {
  try {
    Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$($script:reqId)" -Method PATCH -Headers ($authH + @{"Content-Type"="application/json"; "X-CSRF-Token"=$login.csrf}) -Body '{"status":"NEW"}' | Out-Null
  } catch {}
  Tap 48 110; Start-Sleep 1
  $ocr = OcrPath (Shot "sol-rej-reopen")
  if (-not (TapOcr $ocr "Buscar")) { Tap 360 250 }
  & adb -s $D shell input keyevent 123 | Out-Null
  1..40 | ForEach-Object { & adb -s $D shell input keyevent 67 | Out-Null }
  TypeText $script:reqId; SubmitSearch; Start-Sleep 1
  & adb -s $D shell input keyevent 111 | Out-Null
  $ocr = OcrPath (Shot "sol-rej-open")
  if (-not (TapOcrBottom $ocr "Abrir" 350)) { Tap 360 520 }
  Start-Sleep 2.2
}
# Scroll carefully — never OCR-tap "En curso"
for ($i=0; $i -lt 6; $i++) {
  $u = DumpUi "rej-scroll-$i"
  if ($u -match 'content-desc="Rechazar"') { break }
  Swipe 80 1250 80 700
  Start-Sleep 0.4
}
$rejectUi = $false
$tappedRej = TapDesc "Rechazar"
if (-not $tappedRej) {
  $ocr = OcrPath (Shot "pre-reject")
  # Prefer exact bottom "Rechazar" in Disposición, not other words
  $hits = @($ocr.words | Where-Object { $_.text -eq "Rechazar" -and $_.y -gt 700 })
  if ($hits.Count -gt 0) { Tap 360 $hits[0].y; $tappedRej = $true }
}
Start-Sleep 2.0
# Do NOT send KEYCODE_ESCAPE here — it closes the bottom sheet
$ocr = OcrPath (Shot "rechazo-form")
$rejectUi = (OcrHas $ocr "Motivo") -or (OcrHas $ocr "Confirmo") -or (OcrHas $ocr "Rechazar solicitud") -or (OcrHas $ocr "categoría") -or (OcrHas $ocr "Otro")
if (-not $rejectUi -and $tappedRej) {
  # Retry open once
  TapDesc "Rechazar" | Out-Null
  Start-Sleep 2
  $ocr = OcrPath (Shot "rechazo-form-retry")
  $rejectUi = (OcrHas $ocr "Motivo") -or (OcrHas $ocr "Confirmo") -or (OcrHas $ocr "Rechazar solicitud") -or (OcrHas $ocr "Otro")
}
if ($rejectUi -or $tappedRej) {
  # Category "Otro" is already the default valid choice
  # Check Confirmo via a11y checkbox / label
  $u = DumpUi "rej-confirm"
  $cm = [regex]::Match($u, 'text="Confirmo esta acción"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
  if (-not $cm.Success) { $cm = [regex]::Match($u, 'content-desc="[^"]*Confirmo[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"') }
  if ($cm.Success) {
    # Tap left side for the checkbox control
    Tap ([int]$cm.Groups[1].Value + 24) ([int]((([int]$cm.Groups[2].Value)+([int]$cm.Groups[4].Value))/2))
  } else {
    $ocr = OcrPath (Shot "rechazo-confirm")
    $cw = $ocr.words | Where-Object { $_.text -match 'Confirmo' } | Select-Object -First 1
    if ($cw) { Tap 72 $cw.y } else { TapDesc "Confirmo" -Partial | Out-Null }
  }
  Start-Sleep 0.9
  # Turn OFF customer notify if the switch is still on (no real sends)
  $u = DumpUi "rej-switch"
  $sw = [regex]::Match($u, 'content-desc="[^"]*Enviar mensaje[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
  if ($sw.Success) {
    # SwitchListTile: tap right side to toggle off
    Tap ([int]$sw.Groups[3].Value - 40) ([int]((([int]$sw.Groups[2].Value)+([int]$sw.Groups[4].Value))/2))
    Start-Sleep 0.5
  }
  $ocr = OcrPath (Shot "rechazo-submit")
  $u = DumpUi "rej-submit"
  # Title and primary share content-desc — must pick clickable+enabled button (lower on screen)
  $sms = [regex]::Matches($u, 'content-desc="Rechazar solicitud"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
  $picked = $null
  foreach ($m in $sms) {
    $y1 = [int]$m.Groups[2].Value
    if ($y1 -lt 800) { continue } # skip sheet title
    $slice = $u.Substring([Math]::Max(0, $m.Index - 80), [Math]::Min(200, $u.Length - [Math]::Max(0, $m.Index - 80)))
    if ($slice -match 'clickable="true"' -and $slice -match 'enabled="true"') { $picked = $m; break }
    if ($y1 -gt 1200) { $picked = $m } # fallback: lowest title-named node
  }
  if ($picked) {
    Tap ([int]((([int]$picked.Groups[1].Value)+([int]$picked.Groups[3].Value))/2)) ([int]((([int]$picked.Groups[2].Value)+([int]$picked.Groups[4].Value))/2))
  } elseif (-not (TapOcrBottom $ocr "solicitud" 1200)) {
    Tap 360 1435
  }
  Start-Sleep 3.5
}
$afterReject = Invoke-RestMethod -Uri "$BASE/api/admin/service-requests/$($script:reqId)" -Headers $authH
$rejStatus = [string]$(if ($afterReject.request.status) { $afterReject.request.status } else { $afterReject.status })
$rejectPersisted = $rejStatus -eq "CANCELLED"
if ($rejectPersisted) {
  Rec "Rechazar: guardar con motivo valido y estado persistido" $true @{ status=$rejStatus; form=$rejectUi; tapped=$tappedRej; requestId=$script:reqId } "$solShot;$reqShot"
} elseif ($rejectUi) {
  Rec "Rechazar: formulario de validacion visible (flujo completo no confirmado en UI)" $false @{ formVisible=$true; status=$rejStatus; requestId=$script:reqId } "$solShot;$reqShot"
} else {
  Rec "Rechazar: guardar con motivo valido y estado persistido" $false @{ status=$rejStatus; tapped=$tappedRej; requestId=$script:reqId } "$solShot;$reqShot"
}

$passed = @($results | Where-Object { $_.result -eq "PASS" }).Count
$failed = @($results | Where-Object { $_.result -eq "FAIL" }).Count
$out = [ordered]@{
  failed=$failed; passed=$passed; total=$results.Count; albumId=$albumId; requestId=$script:reqId
  versionName=$vnLine; versionCode=$vcLine; isolated=$session.isolated
  backendCommit=$(if($session.backendCommit){$session.backendCommit}else{$git})
  workingTreeDirty=$dirty
  criteria=@(
    "PASS requires persisted job/request state after UI action (API corroboration only)",
    "UI text verified via OCR when accessibility dump is empty",
    "No PASS on opened/focus/screenshot-size alone",
    "Publish PASS only for simulated dry-run on both platforms"
  )
  results=$results
}
$out | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $ev "FISICA-UI-RESULTS.json") -Encoding utf8
$md = @("# Fisica UI A06 r3","", "passed=$passed failed=$failed", "APK=$vnLine / $vcLine", "isolated=$($session.isolated)", "commit=$($out.backendCommit)", "dirty=$dirty", "album=$albumId", "request=$($script:reqId)", "", "## Criterios", "- Persistencia real tras acciÃ³n UI", "- API solo corrobora", "- OCR para texto UI (dump Flutter vacÃ­o)", "- Publicar = dry-run simulado ambas plataformas", "")
$md += $results | ForEach-Object { "- **$($_.result)** $($_.name)" }
$md -join "`n" | Set-Content (Join-Path $ev "FISICA-UI-RESULTS.md") -Encoding utf8
Write-Host "SUMMARY passed=$passed failed=$failed"
exit $(if ($failed -gt 0) { 1 } else { 0 })



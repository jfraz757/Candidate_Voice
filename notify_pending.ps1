<#
Show a Windows notification when there are pending reviews or company notes you haven't been
told about.

Run by the "CandidateVoice Pending Alert" scheduled task every 10 minutes (set up by
install_pending_alert.ps1). Each run makes two small requests to Supabase and exits.

Checks both queues the admin panel moderates: `submissions` (new reviews and edits) and
`company_comments` (company notes). Each pending item alerts once. The IDs already announced
are kept in backups/.notify_pending_state.json (backups/ is gitignored); approving or
rejecting an item drops it from that list. Clicking the notification opens the admin page at
http://localhost:8766/admin.html if admin_server.py is up, otherwise admin.html directly.

Reads SUPABASE_URL and the service-role key out of admin.html, same as backup_supabase.py,
so the key lives in exactly one place on disk. The anon key cannot read pending submissions
(no anon SELECT policy) -- which is why the old anon-key check_pending_submissions.ps1 was
replaced by this.

Failures are appended to backups/notify_pending.log; nothing is shown on screen for them.

    powershell -ExecutionPolicy Bypass -File notify_pending.ps1          # normal run
    powershell -ExecutionPolicy Bypass -File notify_pending.ps1 -Test    # show a sample notification
#>
param([switch]$Test)

$ErrorActionPreference = 'Stop'

$BaseDir   = $PSScriptRoot
$AdminFile = Join-Path $BaseDir 'admin.html'
$DataDir   = Join-Path $BaseDir 'backups'
$StateFile = Join-Path $DataDir '.notify_pending_state.json'
$LogFile   = Join-Path $DataDir 'notify_pending.log'
$AdminUrl  = 'http://localhost:8766/admin.html'

# Windows PowerShell's registered app ID. Toasts need one; borrowing this avoids registering our own.
$AppId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'

function Write-Log($msg) {
    if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }
    Add-Content -Path $LogFile -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding utf8
}

# The taskbar badge and service worker only work over localhost, so prefer the server; fall
# back to the file so a click still opens something if admin_server.py isn't running.
function Get-LaunchTarget {
    try {
        Invoke-WebRequest -Uri $AdminUrl -Method Head -TimeoutSec 3 -UseBasicParsing | Out-Null
        return $AdminUrl
    } catch {
        return ([System.Uri]$AdminFile).AbsoluteUri
    }
}

function Show-Toast($title, $body) {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

    # Employer names are submitter-controlled text, so they must be XML-escaped.
    $t = [System.Security.SecurityElement]::Escape($title)
    $b = [System.Security.SecurityElement]::Escape($body)
    $launch = [System.Security.SecurityElement]::Escape((Get-LaunchTarget))

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml(@"
<toast activationType="protocol" launch="$launch" scenario="reminder">
  <visual><binding template="ToastGeneric"><text>$t</text><text>$b</text></binding></visual>
  <actions>
    <action content="Open admin page" activationType="protocol" arguments="$launch"/>
    <action content="Dismiss" activationType="system" arguments="dismiss"/>
  </actions>
</toast>
"@)
    $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($toast)
}

try {
    if ($Test) {
        Show-Toast 'New review: TEST Employer' 'This is a test notification. Click to open the admin page.'
        return
    }

    if (-not (Test-Path $AdminFile)) { throw "admin.html not found at $AdminFile" }
    $html = Get-Content -Path $AdminFile -Raw -Encoding utf8
    $url = [regex]::Match($html, 'SUPABASE_URL\s*=\s*"([^"]+)"').Groups[1].Value.TrimEnd('/')
    $key = [regex]::Match($html, 'SUPABASE_ADMIN_KEY\s*=\s*"([^"]+)"').Groups[1].Value
    if (-not $url -or -not $key) { throw 'Could not parse SUPABASE_URL / SUPABASE_ADMIN_KEY from admin.html' }

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $headers = @{ apikey = $key; Authorization = "Bearer $key" }

    # PowerShell 5.1's Invoke-RestMethod hands back a JSON array as ONE object, so an empty
    # result wrapped in @() becomes a one-item list holding an empty array -- which reads as a
    # nameless pending item. Piping through ForEach-Object unrolls it properly.
    $subs = @(Invoke-RestMethod -TimeoutSec 30 -Headers $headers `
        -Uri "$url/rest/v1/submissions?status=eq.pending&select=id,employer_name,update_notes&order=created_at.asc" |
        ForEach-Object { $_ })
    $comments = @(Invoke-RestMethod -TimeoutSec 30 -Headers $headers `
        -Uri "$url/rest/v1/company_comments?status=eq.pending&select=id,employer_name&order=created_at.asc" |
        ForEach-Object { $_ })

    # IDs are per-table, so prefix them to keep a submission and a comment with the same id apart.
    # Same edit test admin.html uses (isEdit).
    $pending = @(
        $subs | ForEach-Object {
            $kind = if ($_.update_notes -and $_.update_notes.StartsWith('Update to review ID')) { 'review edit' } else { 'review' }
            [pscustomobject]@{ key = "s$($_.id)"; name = $_.employer_name; kind = $kind }
        }
        $comments | ForEach-Object { [pscustomobject]@{ key = "c$($_.id)"; name = $_.employer_name; kind = 'company note' } }
    )

    $announced = @()
    if (Test-Path $StateFile) { $announced = @((Get-Content $StateFile -Raw | ConvertFrom-Json).announced | Where-Object { $_ -ne $null }) }

    $fresh = @($pending | Where-Object { $announced -notcontains $_.key })

    if ($fresh.Count -gt 0) {
        $names = ($fresh | ForEach-Object { if ($_.name) { $_.name } else { '(no name)' } }) -join ', '
        if ($fresh.Count -eq 1) {
            $title = "New $($fresh[0].kind): $names"
            $body  = "$($pending.Count) pending in total. Click to review."
        } else {
            $title = "$($fresh.Count) new submissions"
            $body  = "$names`n$($pending.Count) pending in total. Click to review."
        }
        Show-Toast $title $body
    }

    # Keep only keys that are still pending, so the file never grows and a resolved item is forgotten.
    if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }
    ConvertTo-Json -InputObject @{ announced = @($pending | ForEach-Object { $_.key }) } | Set-Content -Path $StateFile -Encoding utf8
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}

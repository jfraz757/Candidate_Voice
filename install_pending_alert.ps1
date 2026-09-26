<#
Create (or remove) the "CandidateVoice Pending Alert" scheduled task that runs
notify_pending.ps1 every 10 minutes and at logon.

    powershell -ExecutionPolicy Bypass -File install_pending_alert.ps1              # install / update
    powershell -ExecutionPolicy Bypass -File install_pending_alert.ps1 -Uninstall   # remove

Runs only while you're logged in (a notification needs a desktop to appear on). Won't wake a
sleeping PC; StartWhenAvailable makes it check as soon as the PC wakes instead.
conhost --headless keeps a console window from flashing up on every run.
#>
param([switch]$Uninstall, [int]$Minutes = 10)

$TaskName = 'CandidateVoice Pending Alert'

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    "Removed '$TaskName'."
    return
}

$script = Join-Path $PSScriptRoot 'notify_pending.ps1'

$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
    -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`"" `
    -WorkingDirectory $PSScriptRoot

$triggers = @(
    (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $Minutes)),
    (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME")
)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
    -Principal $principal -Description "Windows notification when CandidateVoice has a new review or company note awaiting approval. See notify_pending.ps1." `
    -Force | Out-Null

"Installed '$TaskName': checks every $Minutes minutes and at logon."

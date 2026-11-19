$manualWord = $null
$manualDoc = $null
$manualRoot = Split-Path -Parent $PSScriptRoot
[string]$manualPdfPath = Join-Path $manualRoot 'output\pdf\AZ_Client_Manual_AR.pdf'
function Invoke-WordAction([scriptblock]$Action) {
 for ($attempt=0; $attempt -lt 60; $attempt++) {
  try { return (& $Action) } catch {
   if ($_.Exception.Message -notmatch 'rejected|RPC_E_CALL_REJECTED') { throw }
   Start-Sleep -Milliseconds 500
  }
 }
 throw 'Word remained busy for 30 seconds.'
}
try {
 $manualWord = New-Object -ComObject Word.Application
 $manualWord.Visible = $false
 $manualWord.DisplayAlerts = 0
 Write-Output 'Opening manual'
 $manualDoc = $manualWord.Documents.Open((Join-Path $manualRoot 'output\documents\AZ_Client_Manual_AR.docx'))
 Write-Output 'Updating contents'
 foreach ($toc in $manualDoc.TablesOfContents) { Invoke-WordAction { $toc.Update() } }
 Invoke-WordAction { $manualDoc.Fields.Update() } | Out-Null
 Invoke-WordAction { $manualDoc.Repaginate() }
 Invoke-WordAction { $manualDoc.Save() }
 Write-Output 'Exporting PDF'
 Invoke-WordAction { $manualDoc.ExportAsFixedFormat($manualPdfPath,17) }
 Write-Output "Exported pages: $($manualDoc.ComputeStatistics(2))"
} finally {
 if ($manualDoc) { $manualDoc.Close(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($manualDoc) }
 if ($manualWord) { $manualWord.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($manualWord) }
}

param(
    [Parameter(Mandatory = $true)][string]$Exports,
    [string]$WindowsSdkBin,
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
$exportRoot = (Resolve-Path -LiteralPath $Exports).Path
if (-not $WindowsSdkBin) {
    $sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    $WindowsSdkBin = Get-ChildItem -LiteralPath $sdkRoot -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64' } |
        Where-Object { (Test-Path -LiteralPath "$_/fxc.exe") -and (Test-Path -LiteralPath "$_/dxc.exe") } |
        Select-Object -First 1
}
if (-not $WindowsSdkBin) { throw 'Install Windows SDK shader tools or supply -WindowsSdkBin.' }
$extracted = @(Get-Content -LiteralPath "$exportRoot/shader-extraction.json" -Raw | ConvertFrom-Json)
$summary = Get-Content -LiteralPath "$exportRoot/probe-summary.json" -Raw | ConvertFrom-Json
if (-not $extracted.Count -or $extracted.Count -ne $summary.requestedShaders -or
    $extracted.Count -ne $summary.extractedShaders -or @($extracted | Where-Object { $_.error }).Count) {
    throw 'Expected every requested shader to be extracted successfully.'
}
$validated = foreach ($entry in $extracted) {
    $shader = Join-Path "$exportRoot/shaders" $entry.file
    $actualHash = (Get-FileHash -LiteralPath $shader -Algorithm SHA256).Hash
    if ($actualHash -ne $entry.sha256) { throw "Shader hash changed: $($entry.file)" }
    if ($entry.file.EndsWith('.dxbc')) {
        $assembly = "$shader.asm"
        $tool = Join-Path $WindowsSdkBin 'fxc.exe'
        $messages = & $tool /nologo /dumpbin /Fc $assembly $shader 2>&1
    } else {
        $assembly = "$shader.ll"
        $tool = Join-Path $WindowsSdkBin 'dxc.exe'
        $messages = & $tool -dumpbin -Fc $assembly $shader 2>&1
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $assembly)) {
        throw "Disassembly failed for $($entry.file): $messages"
    }
    if ((Get-Item -LiteralPath $assembly).Length -eq 0) { throw "Empty disassembly: $assembly" }
    [pscustomobject]@{
        file = $entry.file
        sha256 = $actualHash
        disassembly = [IO.Path]::GetFileName($assembly)
        tool = [IO.Path]::GetFileName($tool)
        toolVersion = (Get-Item -LiteralPath $tool).VersionInfo.FileVersion
        exitCode = 0
    }
}
& $Python (Join-Path $PSScriptRoot 'inspect-bindings.py') $exportRoot
if ($LASTEXITCODE -ne 0) { throw 'Material parameter binding validation failed.' }
$bindings = @(Get-Content -LiteralPath "$exportRoot/bindings/summary.json" -Raw | ConvertFrom-Json)
$sm5 = @($bindings | Where-Object { $null -ne $_.sm5Coverage })
if ($bindings.Count -ne $extracted.Count -or $sm5.Count -ne @($extracted | Where-Object { $_.Platform -eq 'SP_PCD3D_SM5' }).Count) {
    throw 'Incomplete material binding results.'
}
$referenced = ($sm5 | ForEach-Object { $_.sm5Coverage.referencedComponents } | Measure-Object -Sum).Sum
$mapped = ($sm5 | ForEach-Object { $_.sm5Coverage.mappedComponents } | Measure-Object -Sum).Sum
if ($referenced -ne $mapped) { throw 'Some material buffer components are unmapped.' }
$validation = [pscustomobject]@{
    verifiedAt = [DateTimeOffset]::UtcNow.ToString('o')
    shaders = @($validated)
    materialBindings = $bindings
    sm5ReferencedComponents = $referenced
    sm5MappedComponents = $mapped
    limitations = @(
        'Disassembly and binding checks do not establish visual fidelity.'
        'Numeric component read coverage is checked against SM5; SM6 resource layouts and preshaders are decoded separately.'
        'Only the Num quality permutation and TGPUSkinVertexFactoryDefault base-pass pixel shader are selected.'
        'Original editor graphs are not recovered. View, scene, lighting, and G-buffer conventions still require interpretation.'
    )
}
$validation | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$exportRoot/validation.json" -Encoding utf8
$report = [Collections.Generic.List[string]]::new()
$report.Add('# THE FINALS shader extraction check')
$report.Add('')
$report.Add("The selected clothing shader extraction passed. Microsoft FXC/DXC successfully disassembled all $($validated.Count) requested compiled shaders recovered from the installed game.")
$report.Add('')
$report.Add('| Material | SM5 / SM6 extracted | Decoded fields per platform | Material textures | SM5 buffer components mapped |')
$report.Add('|---|---|---:|---:|---:|')
foreach ($entry in $sm5) {
    $name = $entry.material.Replace('.SP_PCD3D_SM5.basepass-pixel', '')
    $report.Add("| $name | Yes / Yes | $($entry.fields) | $($entry.textureBindings) | $($entry.sm5Coverage.mappedComponents) / $($entry.sm5Coverage.referencedComponents) |")
}
$report.Add('')
$report.Add('Material instances without their own shader resources inherit a parent permutation. Bytecode extraction selects the Num quality variant for SM5 and SM6; full material exports also preserve other available resources.')
$report.Add('')
$report.Add('The material uniform-buffer layout hash matches the resource table embedded in every extracted shader. All preshader instructions and fields were decoded within their declared bounds. Every material-buffer component read by the selected SM5 shaders maps to a decoded field. Texture slots were recovered from the embedded resource tables and matched to the exported material layout.')
$report.Add('')
$report.Add('These checks establish access to compiled code and parameter bindings. They do not establish a visually accurate renderer or recover the original Unreal editor graphs. The engine view/scene inputs and G-buffer outputs still need interpretation, and texture/default resolution must be checked through each material instance parent chain.')
$report.Add('')
$report.Add('Files: probe-summary.json records source container hashes and mapping hash; shader-extraction.json records the material hash, resource index, archive/group location, bytecode hash and container parts; shaders/ contains the extracted code and disassembly; bindings/ contains named material expressions, texture slots, annotated SM5 assembly and coverage checks; validation.json records the successful disassembler runs.')
$report.Add('')
$report.Add('Surface reconstruction and visual comparison are separate checks. Dynamic and view-dependent operations must remain in the runtime shader when they affect the selected surface.')
$report | Set-Content -LiteralPath "$exportRoot/REPORT.md" -Encoding utf8
Write-Output "Validated $($validated.Count) shaders; mapped $mapped/$referenced SM5 material-buffer components."
Write-Output "Report: $exportRoot/REPORT.md"

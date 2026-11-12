#requires -Version 5.1
<#
.SYNOPSIS
  用 GitHub REST API 把 MaiMemo Reader 发布到 GitHub Pages（不需要安装 git / gh）。

.DESCRIPTION
  做的事：
    1. 校验 token，取到登录名；
    2. 确保同名仓库存在（不存在就创建，默认 public，因为 Pages 私有仓库需要付费计划）；
    3. 把源码推到 main（不含 .github，避免与分支发布互相打架）；
    4. 把已构建好的 dist 推到 gh-pages 分支（附 .nojekyll）；
    5. 把 Pages 的来源设为 gh-pages 分支，并等待第一次构建完成；
    6. 打印最终网址。

  之后更新站点：重新 `npm run build`，再跑一次本脚本即可（会覆盖两个分支）。

.PARAMETER Token
  GitHub Personal Access Token。Classic token 勾选 repo 即可；
  fine-grained token 需要目标仓库的 Administration / Contents / Pages 读写权限。

.PARAMETER Repo
  仓库名，默认 MaiMemoReader。

.PARAMETER Private
  创建私有仓库（注意：GitHub Pages 对私有仓库通常需要付费计划）。

.EXAMPLE
  # 在项目根目录执行
  powershell -ExecutionPolicy Bypass -File scripts\deploy-github.ps1 -Token ghp_xxx

.NOTES
  脚本不会把 token 写到任何文件，也不会输出它。
#>
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Repo = 'MaiMemoReader',
  [string]$Description = 'AI 英语精读 PWA：读取墨墨背单词当日学习数据，由 DeepSeek 选词、组篇、命题',
  [string]$SourceRoot = '',
  [switch]$Private
)

$ErrorActionPreference = 'Stop'
if (-not $SourceRoot) {
  $here = $PSScriptRoot
  if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
  $SourceRoot = (Resolve-Path (Join-Path $here '..')).Path
}
if ($PSVersionTable.PSVersion.Major -lt 6) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

$Api = 'https://api.github.com'
$Headers = @{
  Authorization          = "Bearer $Token"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'           = 'memo-reader-deploy'
}

function Invoke-Api {
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    $Body
  )
  $params = @{ Method = $Method; Uri = "$Api$Path"; Headers = $Headers; ErrorAction = 'Stop' }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 12 -Compress)
    $params.ContentType = 'application/json; charset=utf-8'
  }
  try {
    return Invoke-RestMethod @params
  } catch {
    $status = $null
    $detail = ''
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $raw = $reader.ReadToEnd()
        $json = $raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($json.message) { $detail = $json.message }
        if ($json.errors) {
          $detail += ' ' + (($json.errors | ForEach-Object { if ($_.message) { $_.message } else { $_.code } }) -join '; ')
        }
      } catch { }
    }
    throw ("GitHub API $Method $Path 失败" + $(if ($status) { "（HTTP $status）" } else { '' }) + "：$detail")
  }
}

function Get-RelativeFiles {
  param([string[]]$ExcludeDirs, [string]$Root)
  $skip = @('node_modules', 'dist', '.git')
  $exclude = @($ExcludeDirs)
  Get-ChildItem -LiteralPath $Root -Recurse -File -Force | Where-Object {
    $rel = $_.FullName.Substring($Root.Length).TrimStart('\', '/') -replace '\\', '/'
    $parts = $rel.Split('/')
    $bad = $false
    foreach ($p in $parts) {
      if ($skip -contains $p) { $bad = $true; break }
      if ($exclude -contains $p) { $bad = $true; break }
    }
    -not $bad -and $rel -notmatch '(^|/)\.DS_Store$' -and $rel -notmatch '\.tsbuildinfo$'
  } | ForEach-Object {
    [pscustomobject]@{
      Rel  = ($_.FullName.Substring($Root.Length).TrimStart('\', '/') -replace '\\', '/')
      Full = $_.FullName
    }
  }
}

function Initialize-EmptyRepo {
  param([string]$Owner, [string]$Name)
  # 空仓库直接 POST /git/trees 会返回 409，先用 Contents API 造出第一个提交
  $info = Invoke-Api -Method GET -Path "/repos/$Owner/$Name"
  $branch = $info.default_branch
  $content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("bootstrap`n"))
  Invoke-Api -Method PUT -Path "/repos/$Owner/$Name/contents/.bootstrap" -Body @{
    message = 'chore: bootstrap repository'
    content = $content
    branch  = $branch
  } | Out-Null
  Write-Host ("  已用 Contents API 初始化 {0} 分支" -f $branch)
}

function Publish-Tree {
  param(
    [Parameter(Mandatory)][string]$Owner,
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Branch,
    [Parameter(Mandatory)][array]$Files,
    [Parameter(Mandatory)][string]$Message,
    [switch]$Force
  )

  # 逐文件创建 blob（Git Trees API 的 content 字面量不认 base64，必须走 Blob API）
  $treeEntries = @()
  $i = 0
  foreach ($f in $Files) {
    $i++
    $bytes = [System.IO.File]::ReadAllBytes($f.Full)
    $b64 = [Convert]::ToBase64String($bytes)
    if ([string]::IsNullOrEmpty($b64)) { $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("`n")) }
    $blob = Invoke-Api -Method POST -Path "/repos/$Owner/$Name/git/blobs" -Body @{ content = $b64; encoding = 'base64' }
    $treeEntries += @{ path = $f.Rel; mode = '100644'; type = 'blob'; sha = $blob.sha }
    if ($i % 10 -eq 0) { Write-Host ("  已上传 {0}/{1} 个文件…" -f $i, $Files.Count) }
  }

  try {
    $tree = Invoke-Api -Method POST -Path "/repos/$Owner/$Name/git/trees" -Body @{ tree = $treeEntries }
  } catch {
    if ($_.Exception.Message -match '409|empty') {
      Initialize-EmptyRepo -Owner $Owner -Name $Name
      $tree = Invoke-Api -Method POST -Path "/repos/$Owner/$Name/git/trees" -Body @{ tree = $treeEntries }
    } else {
      throw
    }
  }
  $commit = Invoke-Api -Method POST -Path "/repos/$Owner/$Name/git/commits" -Body @{
    message = $Message
    tree    = $tree.sha
    parents = @()
  }

  $existing = $null
  try { $existing = Invoke-Api -Method GET -Path "/repos/$Owner/$Name/git/ref/heads/$Branch" } catch { $existing = $null }
  if ($existing) {
    Invoke-Api -Method PATCH -Path "/repos/$Owner/$Name/git/refs/heads/$Branch" -Body @{ sha = $commit.sha; force = [bool]$Force } | Out-Null
  } else {
    Invoke-Api -Method POST -Path "/repos/$Owner/$Name/git/refs" -Body @{ ref = "refs/heads/$Branch"; sha = $commit.sha } | Out-Null
  }
  Write-Host ("  {0} → {1}" -f $Branch, $commit.sha.Substring(0, 7))
}

# ---------------------------------------------------------------- 1. 身份
Write-Host '[1/6] 校验 token…'
$user = Invoke-Api -Method GET -Path '/user'
$Owner = $user.login
Write-Host ("  登录为 {0}" -f $Owner)

# ---------------------------------------------------------------- 2. 仓库
Write-Host ("[2/6] 检查仓库 {0}/{1}…" -f $Owner, $Repo)
$repoInfo = $null
try { $repoInfo = Invoke-Api -Method GET -Path "/repos/$Owner/$Repo" } catch { $repoInfo = $null }
if (-not $repoInfo) {
  $repoInfo = Invoke-Api -Method POST -Path '/user/repos' -Body @{
    name        = $Repo
    description = $Description
    private     = [bool]$Private
    auto_init   = $false
    has_issues  = $false
    has_wiki    = $false
  }
  Write-Host '  已创建新仓库'
} else {
  Write-Host '  仓库已存在，将覆盖 main / gh-pages 两个分支'
}

$distPath = Join-Path $SourceRoot 'app\dist'
if (-not (Test-Path (Join-Path $distPath 'index.html'))) {
  throw "找不到构建产物：$distPath\index.html。请先在 app\ 下执行 npm run build。"
}

# ---------------------------------------------------------------- 3. 源码分支
Write-Host '[3/6] 上传源码到 main…'
$sourceFiles = Get-RelativeFiles -Root $SourceRoot -ExcludeDirs @('.github')
Publish-Tree -Owner $Owner -Name $Repo -Branch 'main' -Files $sourceFiles `
  -Message "chore: publish source $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -Force

# ---------------------------------------------------------------- 4. 站点分支
Write-Host '[4/6] 上传构建产物到 gh-pages…'
$siteFiles = @(Get-RelativeFiles -Root $distPath -ExcludeDirs @())
$nojekyll = [pscustomobject]@{ Rel = '.nojekyll'; Full = $null }
$siteAll = @($nojekyll) + $siteFiles
# .nojekyll 是空文件，单独造一个临时文件
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) '.nojekyll'
[System.IO.File]::WriteAllText($tmp, '')
$siteAll = @([pscustomobject]@{ Rel = '.nojekyll'; Full = $tmp }) + $siteFiles
Publish-Tree -Owner $Owner -Name $Repo -Branch 'gh-pages' -Files $siteAll `
  -Message "build: site $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -Force

# ---------------------------------------------------------------- 5. Pages
Write-Host '[5/6] 配置 GitHub Pages（来源：gh-pages 分支）…'
$pagesBody = @{ source = @{ branch = 'gh-pages'; path = '/' } }
try {
  Invoke-Api -Method POST -Path "/repos/$Owner/$Repo/pages" -Body $pagesBody | Out-Null
  Write-Host '  已开启 Pages'
} catch {
  if ($_.Exception.Message -match '409|已存在|already enabled') {
    Invoke-Api -Method PUT -Path "/repos/$Owner/$Repo/pages" -Body $pagesBody | Out-Null
    Write-Host '  已更新 Pages 配置'
  } else {
    try {
      Invoke-Api -Method PUT -Path "/repos/$Owner/$Repo/pages" -Body $pagesBody | Out-Null
      Write-Host '  已更新 Pages 配置'
    } catch { throw }
  }
}

$siteUrl = "https://$Owner.github.io/$Repo/"
Write-Host '[6/6] 等待首次构建…'
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 5
  try {
    $build = Invoke-Api -Method GET -Path "/repos/$Owner/$Repo/pages/builds/latest"
    Write-Host ("  状态：{0}" -f $build.status)
    if ($build.status -eq 'built') { break }
    if ($build.status -eq 'errored') { throw 'Pages 构建失败，请到仓库 Actions / Pages 面板查看日志' }
  } catch {
    if ($_.Exception.Message -match '404') { continue }
    throw
  }
}

Write-Host ''
Write-Host '部署完成 🎉' -ForegroundColor Green
Write-Host ("  仓库： https://github.com/{0}/{1}" -f $Owner, $Repo)
Write-Host ("  站点： {0}" -f $siteUrl) -ForegroundColor Cyan
Write-Host ''
Write-Host '下一步：'
Write-Host '  1. 手机 Safari 打开站点 → 分享 → 添加到主屏幕'
Write-Host '  2. 设置里填自己的墨墨 Token 与 DeepSeek Key'
Write-Host '  3. 以后更新：app\ 下 npm run build，再跑一次本脚本'
Write-Host ''
Write-Host '首次生效可能需要 1–2 分钟；若 404，等一会儿再刷新。'

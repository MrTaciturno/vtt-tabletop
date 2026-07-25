$port = 8000
$root = $PSScriptRoot

$ipList = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | 
    Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -ne '127.0.0.1' } | 
    Select-Object -ExpandProperty IPAddressToString

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:8000/')

foreach ($ip in $ipList) {
    try {
        $listener.Prefixes.Add("http://$ip`:8000/")
    } catch {}
}

try {
    $listener.Start()
} catch {
    Write-Host 'Erro ao iniciar servidor' -ForegroundColor Red
    exit 1
}

Write-Host '==========================================================' -ForegroundColor Green
Write-Host '   SERVIDOR VTT - ACESSO EM REDE LOCAL / WI-FI            ' -ForegroundColor Cyan
Write-Host '==========================================================' -ForegroundColor Green
Write-Host ' Neste computador: http://localhost:8000                  ' -ForegroundColor Yellow

if ($ipList) {
    foreach ($ip in $ipList) {
        Write-Host " Outros dispositivos no Wi-Fi: http://$ip`:8000" -ForegroundColor Green
    }
}

Write-Host '==========================================================' -ForegroundColor Green

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.LocalPath
        if ($path -eq '/' -or [string]::IsNullOrWhiteSpace($path)) { $path = '/index.html' }
        $localPath = Join-Path $root ($path.TrimStart('/').Replace('/', '\'))

        if (Test-Path $localPath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($localPath)
            $ext = [System.IO.Path]::GetExtension($localPath)
            switch ($ext) {
                '.html' { $response.ContentType = 'text/html; charset=utf-8' }
                '.css'  { $response.ContentType = 'text/css; charset=utf-8' }
                '.js'   { $response.ContentType = 'application/javascript; charset=utf-8' }
                '.json' { $response.ContentType = 'application/json; charset=utf-8' }
                '.png'  { $response.ContentType = 'image/png' }
                '.jpg'  { $response.ContentType = 'image/jpeg' }
                '.svg'  { $response.ContentType = 'image/svg+xml' }
                default { $response.ContentType = 'application/octet-stream' }
            }
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $buf = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
            $response.OutputStream.Write($buf, 0, $buf.Length)
        }
        $response.Close()
    }
} finally {
    $listener.Stop()
}

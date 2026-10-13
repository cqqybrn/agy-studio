# WinCred helper for Antigravity CLI OAuth (target: gemini:antigravity)
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('read', 'write', 'delete', 'exists')]
  [string]$Action,

  [string]$BlobBase64,
  [string]$UserName = 'antigravity',
  [string]$Target = 'gemini:antigravity'
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class AgyCred {
  public const int CRED_TYPE_GENERIC = 1;
  public const int CRED_PERSIST_LOCAL_MACHINE = 2;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite([In] ref CREDENTIAL userCredential, int flags);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, int type, int flags);

  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr buffer);
}
"@

function Read-Cred {
  $ptr = [IntPtr]::Zero
  $ok = [AgyCred]::CredRead($Target, [AgyCred]::CRED_TYPE_GENERIC, 0, [ref]$ptr)
  if (-not $ok) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($err -eq 1168) {
      Write-Output '{"ok":false,"exists":false,"error":"not_found"}'
      return
    }
    throw "CredRead failed: Win32 $err"
  }
  try {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][AgyCred+CREDENTIAL])
    $bytes = New-Object byte[] $cred.CredentialBlobSize
    if ($cred.CredentialBlobSize -gt 0) {
      [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
    }
    $b64 = [Convert]::ToBase64String($bytes)
    $obj = [ordered]@{
      ok       = $true
      exists   = $true
      target   = $cred.TargetName
      username = $cred.UserName
      persist  = $cred.Persist
      blobSize = $cred.CredentialBlobSize
      blobB64  = $b64
    }
    ($obj | ConvertTo-Json -Compress)
  }
  finally {
    [AgyCred]::CredFree($ptr)
  }
}

function Write-Cred {
  if ([string]::IsNullOrWhiteSpace($BlobBase64)) {
    throw "BlobBase64 required for write"
  }
  $bytes = [Convert]::FromBase64String($BlobBase64)
  $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
    $cred = New-Object AgyCred+CREDENTIAL
    $cred.Type = [AgyCred]::CRED_TYPE_GENERIC
    $cred.TargetName = $Target
    $cred.UserName = $UserName
    $cred.CredentialBlobSize = $bytes.Length
    $cred.CredentialBlob = $ptr
    $cred.Persist = [AgyCred]::CRED_PERSIST_LOCAL_MACHINE
    $ok = [AgyCred]::CredWrite([ref]$cred, 0)
    if (-not $ok) {
      throw "CredWrite failed: Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    Write-Output '{"ok":true,"written":true}'
  }
  finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
  }
}

function Delete-Cred {
  $ok = [AgyCred]::CredDelete($Target, [AgyCred]::CRED_TYPE_GENERIC, 0)
  if (-not $ok) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($err -eq 1168) {
      Write-Output '{"ok":true,"deleted":false,"exists":false}'
      return
    }
    throw "CredDelete failed: Win32 $err"
  }
  Write-Output '{"ok":true,"deleted":true}'
}

switch ($Action) {
  'read' { Read-Cred }
  'write' { Write-Cred }
  'delete' { Delete-Cred }
  'exists' {
    $ptr = [IntPtr]::Zero
    $ok = [AgyCred]::CredRead($Target, [AgyCred]::CRED_TYPE_GENERIC, 0, [ref]$ptr)
    if ($ok) {
      [AgyCred]::CredFree($ptr)
      Write-Output '{"ok":true,"exists":true}'
    } else {
      Write-Output '{"ok":true,"exists":false}'
    }
  }
}

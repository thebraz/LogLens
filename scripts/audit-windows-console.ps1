$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This verification requires Windows.' }
$consoleEvidence = if ($env:LOGLENS_EVIDENCE_DIR) { $env:LOGLENS_EVIDENCE_DIR } else { Join-Path (Get-Location) 'evidence\stage-3-final-security' }
New-Item -ItemType Directory -Path $consoleEvidence -Force | Out-Null
$consoleRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('loglens-console-audit-' + [Guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory -Path $consoleRoot | Out-Null
try {
  # Test-only Win32 calls deliver Ctrl+C to a hidden, isolated console, never to the operator's console.
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class LogLensConsoleAudit {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI {
    public int cb; public string reserved, desktop, title; public int x,y,xSize,ySize,xChars,yChars,fill,flags;
    public short show,reservedBytes; public IntPtr reservedPointer,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public uint id,threadId; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SA attributes, int size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref SA attributes, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr environment, string cwd, ref SI startup, out PI process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AttachConsole(uint process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GenerateConsoleCtrlEvent(uint type, uint group);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr handle, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static double[] Run(string node, string bin, string directory) {
    IntPtr read=IntPtr.Zero,write=IntPtr.Zero,stdout=IntPtr.Zero,stderr=IntPtr.Zero; PI pi=new PI(); bool attached=false;
    try {
      SA sa=new SA { length=Marshal.SizeOf<SA>(), inherit=1 };
      Check(CreatePipe(out read,out write,ref sa,0)); Check(SetHandleInformation(write,1,0));
      stdout=CreateFileW(Path.Combine(directory,"stdout.txt"),0x40000000,3,ref sa,1,0,IntPtr.Zero);
      stderr=CreateFileW(Path.Combine(directory,"stderr.txt"),0x40000000,3,ref sa,1,0,IntPtr.Zero);
      Check(stdout!=new IntPtr(-1) && stderr!=new IntPtr(-1));
      SI si=new SI { cb=Marshal.SizeOf<SI>(), flags=0x101, show=0, input=read, output=stdout, error=stderr };
      string command="\""+node+"\" \""+bin+"\" inspect - --output-format=json --output \""+Path.Combine(directory,"result.json")+"\"";
      // CREATE_NEW_CONSOLE with STARTF_USESHOWWINDOW/SW_HIDE; stdin stays open until the signal is handled.
      Check(CreateProcessW(node,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x10,IntPtr.Zero,directory,ref si,out pi));
      CloseHandle(read); read=IntPtr.Zero; CloseHandle(stdout); stdout=IntPtr.Zero; CloseHandle(stderr); stderr=IntPtr.Zero;
      var ready=Stopwatch.StartNew();
      while (Directory.GetFiles(directory,".loglens-*.tmp").Length!=1) {
        if (ready.ElapsedMilliseconds>5000 || WaitForSingleObject(pi.process,0)==0) throw new InvalidOperationException("CLI did not reach pending input with a temporary output");
        Thread.Sleep(10);
      }
      FreeConsole(); Check(AttachConsole(pi.id)); attached=true;
      // The helper ignores Ctrl+C only after child creation; the child retains its normal handler.
      Check(SetConsoleCtrlHandler(IntPtr.Zero,true)); var latency=Stopwatch.StartNew();
      Check(GenerateConsoleCtrlEvent(0,0));
      if (WaitForSingleObject(pi.process,5000)!=0) throw new InvalidOperationException("Ctrl+C did not finish the CLI");
      latency.Stop(); Check(GetExitCodeProcess(pi.process,out uint code));
      return new double[] {code,latency.Elapsed.TotalMilliseconds};
    } finally {
      if (attached) FreeConsole();
      if (pi.process!=IntPtr.Zero) { if (WaitForSingleObject(pi.process,0)!=0) TerminateProcess(pi.process,250); CloseHandle(pi.process); }
      if (pi.thread!=IntPtr.Zero) CloseHandle(pi.thread);
      foreach (IntPtr h in new IntPtr[] {read,write,stdout,stderr}) if (h!=IntPtr.Zero && h!=new IntPtr(-1)) CloseHandle(h);
    }
  }
}
'@
  $consoleResult = [LogLensConsoleAudit]::Run((Get-Command node).Source, (Join-Path (Get-Location) 'dist\bin.js'), $consoleRoot)
  if ($consoleResult[0] -ne 130 -or $consoleResult[1] -ge 2000) { throw 'Native Ctrl+C exit/latency assertion failed.' }
  if ((Get-Item -LiteralPath (Join-Path $consoleRoot 'stdout.txt')).Length -ne 0 -or (Get-Item -LiteralPath (Join-Path $consoleRoot 'stderr.txt')).Length -ne 0) { throw 'Unexpected completion output.' }
  if (Test-Path -LiteralPath (Join-Path $consoleRoot 'result.json')) { throw 'Interrupted destination was published.' }
  if (Get-ChildItem -LiteralPath $consoleRoot -Filter '.loglens-*.tmp') { throw 'Interrupted temporary output remained.' }
  [ordered]@{ status='PASS'; platform='Windows'; method='CreateProcessW hidden isolated new console, real GenerateConsoleCtrlEvent CTRL_C_EVENT; no injected Node signal'; exitCode=130; signalLatencyMs=$consoleResult[1]; noDestination=$true; noTemporaryResidue=$true; noCompletionOutput=$true; nativeSigterm='NOT TESTED: no POSIX SIGTERM delivery claim on Windows' } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $consoleEvidence 'windows-console.json') -Encoding utf8
  Write-Output ('PASS: native Windows Ctrl+C, exit 130; cleanup in ' + [Math]::Round($consoleResult[1],2) + ' ms.')
} finally {
  if ([IO.Path]::GetDirectoryName($consoleRoot) -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or -not [IO.Path]::GetFileName($consoleRoot).StartsWith('loglens-console-audit-')) { throw 'Unsafe cleanup.' }
  Remove-Item -LiteralPath $consoleRoot -Recurse -Force
}

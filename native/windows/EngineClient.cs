using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;

namespace ClefVoice.Windows;

/// <summary>
/// Manages the Go core engine (<c>clefd.exe</c>) child process and speaks its
/// line-delimited JSON protocol over stdio.
/// </summary>
public sealed class EngineClient : IDisposable
{
    private Process? _process;
    private StreamWriter? _writer;
    private readonly object _writeLock = new();

    public event Action? OnReady;
    public event Action<JsonObject>? OnStatus;
    public event Action<JsonObject>? OnTranscribed;

    public bool IsRunning => _process is { HasExited: false };

    public void Start()
    {
        string? exe = LocateEngine();
        if (exe == null)
        {
            Console.Error.WriteLine("[ClefVoice] clefd.exe not found next to helper.");
            return;
        }

        var psi = new ProcessStartInfo
        {
            FileName = exe,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        _process = Process.Start(psi)!;
        _writer = _process.StandardInput;
        _writer.AutoFlush = true;

        _process.ErrorDataReceived += (_, e) =>
        {
            if (e.Data != null) Console.Error.WriteLine(e.Data);
        };
        _process.BeginErrorReadLine();

        var reader = new Thread(() => ReadLoop(_process.StandardOutput)) { IsBackground = true };
        reader.Start();
    }

    private void ReadLoop(StreamReader reader)
    {
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                var root = JsonNode.Parse(line)?.AsObject();
                if (root == null || !root.TryGetPropertyValue("type", out var typeNode)) continue;
                Dispatch(typeNode?.GetValue<string>(), root);
            }
            catch
            {
                // Ignore malformed lines.
            }
        }
    }

    private void Dispatch(string? type, JsonObject root)
    {
        switch (type)
        {
            case "ready":
                OnReady?.Invoke();
                break;
            case "status":
            case "error":
                OnStatus?.Invoke(root);
                break;
            case "transcribed":
                OnTranscribed?.Invoke(root);
                break;
        }
    }

    public void Send(JsonObject message)
    {
        lock (_writeLock)
        {
            _writer?.WriteLine(message.ToJsonString());
        }
    }

    public void StartDictation() => Send(new JsonObject { ["cmd"] = "start" });
    public void StopDictation() => Send(new JsonObject { ["cmd"] = "stop" });
    public void ToggleDictation() => Send(new JsonObject { ["cmd"] = "toggle" });
    public void Shutdown() => Send(new JsonObject { ["cmd"] = "shutdown" });

    private static string? LocateEngine()
    {
        var dir = AppContext.BaseDirectory;
        var exe = Path.Combine(dir, "clefd.exe");
        return File.Exists(exe) ? exe : null;
    }

    public void Dispose()
    {
        try
        {
            if (_process is { HasExited: false })
            {
                Shutdown();
                if (!_process.WaitForExit(1000)) _process.Kill();
            }
        }
        catch { }
        _process?.Dispose();
    }
}

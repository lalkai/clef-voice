using System;
using System.Text.Json.Nodes;
using System.Windows.Forms;

namespace ClefVoice.Windows;

internal static class Program
{
    private static EngineClient? _engine;
    private static HotkeyManager? _hotkey;
    private static NotifyIcon? _trayIcon;
    private static ToolStripMenuItem? _dictationItem;

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();

        _engine = new EngineClient();
        _engine.OnReady += OnEngineReady;
        _engine.OnTranscribed += OnTranscribed;
        _engine.OnStatus += OnStatus;
        _engine.Start();

        _hotkey = new HotkeyManager();
        _hotkey.HotkeyDown += () => _engine.StartDictation();
        _hotkey.HotkeyUp += () => _engine.StopDictation();
        _hotkey.Install();

        _trayIcon = BuildTrayIcon();

        Application.ApplicationExit += (_, _) =>
        {
            _hotkey.Dispose();
            _engine.Dispose();
            _trayIcon.Dispose();
        };

        Application.Run();
    }

    private static void OnEngineReady()
    {
        SetTrayText("ClefVoice — loading model…");
    }

    private static void OnTranscribed(JsonObject root)
    {
        string? text = root["text"]?.GetValue<string>();
        if (string.IsNullOrEmpty(text)) return;
        TextInserter.Insert(text);
        SetTrayText("ClefVoice — inserted");
    }

    private static void OnStatus(JsonObject root)
    {
        string? status = root["status"]?.GetValue<string>();
        string? message = root["message"]?.GetValue<string>();

        if (_dictationItem != null)
        {
            _dictationItem.Text = status == "recording" ? "Stop Dictation" : "Start Dictation";
        }

        if (status == "error" && message != null)
        {
            SetTrayText($"ClefVoice — {message}");
        }
    }

    private static NotifyIcon BuildTrayIcon()
    {
        var menu = new ContextMenuStrip();
        _dictationItem = new ToolStripMenuItem("Start Dictation", null, (_, _) => _engine!.ToggleDictation());
        menu.Items.Add(_dictationItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => Application.Exit());

        var icon = new NotifyIcon
        {
            Text = "ClefVoice — Voice Dictation",
            Icon = SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = true,
        };

        icon.DoubleClick += (_, _) => _engine!.ToggleDictation();
        return icon;
    }

    private static void SetTrayText(string text)
    {
        if (_trayIcon != null) _trayIcon.Text = text;
    }
}

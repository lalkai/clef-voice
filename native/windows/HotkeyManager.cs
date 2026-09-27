using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace ClefVoice.Windows;

/// <summary>
/// Hold-to-talk hotkey via a low-level keyboard hook. Defaults to holding Left Control.
/// </summary>
public sealed class HotkeyManager : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_LCONTROL = 0xA2;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    private LowLevelKeyboardProc? _proc;
    private IntPtr _hookId = IntPtr.Zero;
    private bool _isDown;

    public event Action? HotkeyDown;
    public event Action? HotkeyUp;

    public void Install()
    {
        _proc = HookCallback;
        _hookId = SetHook(_proc);
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using var current = Process.GetCurrentProcess();
        using var module = current.MainModule!;
        return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(module.ModuleName), 0);
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int vkCode = Marshal.ReadInt32(lParam);
            if (vkCode == VK_LCONTROL)
            {
                int msg = (int)wParam;
                if ((msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) && !_isDown)
                {
                    _isDown = true;
                    HotkeyDown?.Invoke();
                }
                else if ((msg == WM_KEYUP || msg == WM_SYSKEYUP) && _isDown)
                {
                    _isDown = false;
                    HotkeyUp?.Invoke();
                }
            }
        }
        return CallNextHookEx(_hookId, nCode, wParam, lParam);
    }

    public void Dispose()
    {
        if (_hookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hookId);
            _hookId = IntPtr.Zero;
        }
    }
}

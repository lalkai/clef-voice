using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace ClefVoice.Windows;

/// <summary>
/// Inserts text at the current cursor using the clipboard + synthesized Ctrl+V.
/// </summary>
public static class TextInserter
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const ushort VK_CONTROL = 0x11;
    private const ushort VK_V = 0x56;

    public static void Insert(string text)
    {
        if (string.IsNullOrEmpty(text)) return;

        string? saved = null;
        try
        {
            if (Clipboard.ContainsText())
            {
                saved = Clipboard.GetText();
            }
            Clipboard.SetText(text);
        }
        catch
        {
            // Clipboard access might be locked temporarily by another app
        }

        try
        {
            SendCtrlV();
        }
        finally
        {
            RestoreClipboardAsync(saved);
        }
    }

    private static void SendCtrlV()
    {
        var inputs = new INPUT[]
        {
            KeyDown(VK_CONTROL),
            KeyDown(VK_V),
            KeyUp(VK_V),
            KeyUp(VK_CONTROL),
        };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    }

    private static INPUT KeyDown(ushort vk) => new()
    {
        type = INPUT_KEYBOARD,
        u = new InputUnion { ki = new KEYBDINPUT { wVk = vk } }
    };

    private static INPUT KeyUp(ushort vk) => new()
    {
        type = INPUT_KEYBOARD,
        u = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = KEYEVENTF_KEYUP } }
    };

    private static void RestoreClipboardAsync(string? saved)
    {
        var t = new Thread(() =>
        {
            try
            {
                Thread.Sleep(300);
                if (!string.IsNullOrEmpty(saved))
                {
                    Clipboard.SetText(saved);
                }
                else
                {
                    Clipboard.Clear();
                }
            }
            catch { }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.IsBackground = true;
        t.Start();
    }
}

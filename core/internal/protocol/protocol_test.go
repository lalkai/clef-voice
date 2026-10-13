package protocol

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestSessionIdentitySurvivesWireEncoding(t *testing.T) {
	var out bytes.Buffer
	emitter := NewEmitter(&out)
	emitter.Status("recording", "", "session-A")
	emitter.Transcribed("ข้อความ", 100, "th", 16000, "session-A")
	emitter.Status("idle", "", "session-A")
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatal(err)
		}
		if event["session_id"] != "session-A" {
			t.Fatal(event)
		}
	}
	var cmd Command
	if err := json.Unmarshal([]byte(`{"cmd":"start","session_id":"session-A"}`), &cmd); err != nil || cmd.SessionID != "session-A" {
		t.Fatal(cmd, err)
	}
}

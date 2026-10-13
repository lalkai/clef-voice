package main

import (
	"bytes"
	"github.com/clefvoice/core/internal/appconfig"
	"github.com/clefvoice/core/internal/protocol"
	"strings"
	"testing"
)

func TestOversizedInputDoesNotHideNextCommand(t *testing.T) {
	var errors bytes.Buffer
	ch := make(chan protocol.Command, 3)
	readCommands(strings.NewReader(strings.Repeat("x", appconfig.CommandBytes+1)+"\n{\"cmd\":\"ping\"}\n"), ch, protocol.NewEmitter(&errors))
	if cmd, ok := <-ch; !ok || cmd.Cmd != "ping" {
		t.Fatal("valid command after oversized input was lost")
	}
	if !strings.Contains(errors.String(), "input limit") {
		t.Fatal(errors.String())
	}
}

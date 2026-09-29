package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/clefvoice/core/internal/appconfig"
	"github.com/clefvoice/core/internal/engine"
	"github.com/clefvoice/core/internal/protocol"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Println(appconfig.Version)
		return
	}
	modelsDir := parseArgs()

	emit := protocol.NewEmitter(os.Stdout)
	e := engine.New(modelsDir, emit)
	emit.Ready(appconfig.Version)
	emit.Config(e.GetConfig())
	e.Handle(protocol.Command{Cmd: protocol.CmdLoadModel, Model: e.GetConfig().Model})

	cmdCh := make(chan protocol.Command, 64)
	go readStdin(cmdCh)

	var lastLevel = time.Now()
	var lastAutoStop = time.Now()

	for {
		shutdown := false
	drain:
		for {
			select {
			case cmd, ok := <-cmdCh:
				if !ok {
					shutdown = true
					break drain
				}
				if e.Handle(cmd) {
					shutdown = true
					break drain
				}
			default:
				break drain
			}
		}
		if shutdown {
			break
		}

		e.PollLoad()
		e.PollTranscribe()

		if e.IsRecording() {
			e.DrainAudio()
			if time.Since(lastLevel) >= 33*time.Millisecond {
				lastLevel = time.Now()
				emit.Level(e.CurrentLevel())
			}
			if time.Since(lastAutoStop) >= 300*time.Millisecond {
				lastAutoStop = time.Now()
				if e.AutoStopCheck() {
					e.StopRecording()
				}
			}
		}

		time.Sleep(10 * time.Millisecond)
	}

	e.Shutdown()
}

func readStdin(ch chan<- protocol.Command) {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var cmd protocol.Command
		if err := json.Unmarshal([]byte(line), &cmd); err != nil {
			fmt.Fprintf(os.Stderr, "clefd: ignoring malformed command: %v\n", err)
			continue
		}
		ch <- cmd
	}
	close(ch)
}

func parseArgs() string {
	args := os.Args[1:]
	for i := 0; i < len(args); i++ {
		if args[i] == "--models-dir" && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

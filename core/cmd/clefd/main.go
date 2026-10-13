package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
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
	e.Startup()

	cmdCh := make(chan protocol.Command, 64)
	go readStdin(cmdCh)

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	var lastLevel = time.Now()
	var lastAutoStop = time.Now()

	for {
		shutdown := false
	drain:
		for {
			select {
			case <-signals:
				shutdown = true
				break drain
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

func readStdin(ch chan<- protocol.Command) { readCommands(os.Stdin, ch, nil) }

func readCommands(input io.Reader, ch chan<- protocol.Command, errors *protocol.Emitter) {
	defer close(ch)
	reader := bufio.NewReaderSize(input, 64*1024)
	var line []byte
	oversized := false
	for {
		fragment, err := reader.ReadSlice('\n')
		if len(line)+len(fragment) > appconfig.CommandBytes {
			oversized = true
			line = nil
		}
		if !oversized {
			line = append(line, fragment...)
		}
		if err == bufio.ErrBufferFull {
			continue
		}
		if oversized {
			reportInputError(ch, errors, "Command exceeds the input limit.")
		} else if text := strings.TrimSpace(string(line)); text != "" {
			var cmd protocol.Command
			if decodeErr := json.Unmarshal([]byte(text), &cmd); decodeErr != nil {
				reportInputError(ch, errors, "Malformed command.")
			} else {
				ch <- cmd
			}
		}
		line, oversized = nil, false
		if err != nil {
			if err != io.EOF {
				reportInputError(ch, errors, "Could not read command input: "+err.Error())
			}
			return
		}
	}
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

func reportInputError(ch chan<- protocol.Command, errors *protocol.Emitter, message string) {
	if errors != nil {
		errors.OperationError(message)
		return
	}
	ch <- protocol.Command{Cmd: "input_error", ID: message}
}

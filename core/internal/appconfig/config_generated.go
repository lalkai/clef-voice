// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.
package appconfig

const Version = "0.4.1"
const Name = "ClefVoice"
const BundleIdentifier = "com.clefvoice.app"
const TypingWPM = 40
const DefaultModel = "base"
const DefaultVADThreshold = 0.012
const DefaultHotkey = "Fn"
const DefaultVADEnabled = true
const DefaultAutoStopEnabled = false
const DefaultAutoStopSeconds = 0.9
const DefaultRemoveFiller = true
const DefaultAutoCapitalize = true
func DefaultVocabulary() []string { return []string{"ClefVoice", "TypeScript", "TailwindCSS"} }
const VocabularyWords = 64
const WordCharacters = 64
const VocabularyCharacters = 512
const CommandBytes = 1000000

type Model struct {
	ID            string
	Label         string
	Name          string
	SizeLabel     string
	SHA256        string
	Filename      string
	URL           string
	SizeBytes     int64
	Group         string
	Languages     []string
	LanguageLabel string
	Quantization  string
}

var Models = []Model{
	{"tiny", "Whisper Tiny (~78 MB)", "Whisper Tiny", "~78 MB", "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21", "ggml-tiny.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.bin", 77691713, "general", []string{}, "Multilingual", "F16"},
	{"base", "Whisper Base (~148 MB)", "Whisper Base", "~148 MB", "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe", "ggml-base.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin", 147951465, "general", []string{}, "Multilingual", "F16"},
	{"small", "Whisper Small (~488 MB)", "Whisper Small", "~488 MB", "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b", "ggml-small.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin", 487601967, "general", []string{}, "Multilingual", "F16"},
	{"medium", "Whisper Medium (~492 MB)", "Whisper Medium", "~492 MB", "79283fc1f9fe12ca3248543fbd54b73292164d8df5a16e095e2bceeaaabddf57", "whisper-medium-q4_1.bin", "https://huggingface.co/coco-research/coco-voice-models/resolve/3cb3e6de7c20f58fe5beaaab3d5159384feff3f0/medium/whisper-medium-q4_1.bin", 491852915, "general", []string{}, "Multilingual", "Q4_1"},
	{"large-v3-turbo", "Whisper Large V3 Turbo (~1.62 GB)", "Whisper Large V3 Turbo", "~1.62 GB", "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69", "ggml-large-v3-turbo.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo.bin", 1624555275, "general", []string{}, "Multilingual", "F16"},
	{"large-v3", "Whisper Large V3 (~1.08 GB)", "Whisper Large V3", "~1.08 GB", "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1", "ggml-large-v3-q5_0.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-q5_0.bin", 1081140203, "general", []string{}, "Multilingual", "Q5_0"},
	{"tiny-en", "Whisper Tiny (English) (~78 MB)", "Whisper Tiny (English)", "~78 MB", "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f", "ggml-tiny.en.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.en.bin", 77704715, "english", []string{"en"}, "English only", "F16"},
	{"base-en", "Whisper Base (English) (~148 MB)", "Whisper Base (English)", "~148 MB", "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002", "ggml-base.en.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin", 147964211, "english", []string{"en"}, "English only", "F16"},
	{"small-en", "Whisper Small (English) (~488 MB)", "Whisper Small (English)", "~488 MB", "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d", "ggml-small.en.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.en.bin", 487614201, "english", []string{"en"}, "English only", "F16"},
	{"medium-en", "Whisper Medium (English) (~1.53 GB)", "Whisper Medium (English)", "~1.53 GB", "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356", "ggml-medium.en.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-medium.en.bin", 1533774781, "english", []string{"en"}, "English only", "F16"},
	{"breeze-asr", "Breeze ASR 25 (~1.08 GB)", "Breeze ASR 25", "~1.08 GB", "8efbf0ce8a3f50fe332b7617da787fb81354b358c288b008d3bdef8359df64c6", "breeze-asr-q5_k.bin", "https://huggingface.co/coco-research/coco-voice-models/resolve/3cb3e6de7c20f58fe5beaaab3d5159384feff3f0/breeze-asr/breeze-asr-q5_k.bin", 1080732108, "specialized", []string{"zh", "en"}, "Mandarin & English", "Q5_K"},
	{"large-v1", "Whisper Large V1 (~3.09 GB)", "Whisper Large V1", "~3.09 GB", "7d99f41a10525d0206bddadd86760181fa920438b6b33237e3118ff6c83bb53d", "ggml-large-v1.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v1.bin", 3094623691, "legacy", []string{}, "Multilingual", "F16"},
	{"large-v2", "Whisper Large V2 (~3.09 GB)", "Whisper Large V2", "~3.09 GB", "9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487", "ggml-large-v2.bin", "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v2.bin", 3094623691, "legacy", []string{}, "Multilingual", "F16"},
}

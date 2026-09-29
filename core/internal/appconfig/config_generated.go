// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.
package appconfig

const Version = "0.4.0"
const Name = "ClefVoice"
const BundleIdentifier = "com.clefvoice.app"
const TypingWPM = 40
const DefaultModel = "base"
const DefaultVADThreshold = 0.012

type Model struct {
	ID     string
	Label  string
	SHA256 string
}

var Models = []Model{
	{"tiny", "Tiny (~75 MB - Fast)", "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"},
	{"base", "Base (~142 MB - Balanced)", "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"},
	{"small", "Small (~466 MB - Accurate)", "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"},
	{"large-v3-turbo", "Large V3 Turbo (~1.5 GB - Best)", "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69"},
}

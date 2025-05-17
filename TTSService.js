// TTSService.js
const fs = require("fs");
const util = require("util");
const textToSpeech = require("@google-cloud/text-to-speech");

const client = new textToSpeech.TextToSpeechClient({
  keyFilename: "./googleTTSKey.json",
});

async function speakText(text, voiceName = "en-US-Wavenet-F") {
  console.log(`\uD83D\uDDE3 Speaking: "${text}" with voice ${voiceName}`);

  const request = {
    input: { text },
    voice: {
      languageCode: "en-US",
      name: voiceName,
    },
    audioConfig: {
      audioEncoding: "LINEAR16",
    },
  };

  try {
    const [response] = await client.synthesizeSpeech(request);
    const writeFile = util.promisify(fs.writeFile);
    await writeFile("sample.wav", response.audioContent, "binary");
    console.log("\u2705 Audio saved to sample.wav");
  } catch (err) {
    console.error("\u274C TTS error:", err);
    throw err;
  }
}

module.exports = { speakText };



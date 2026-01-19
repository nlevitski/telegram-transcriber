import { ElevenLabsClient, ElevenLabs } from "elevenlabs";
// import { Readable } from "stream"; // Not needed if using File/Blob

// Initialize the client
const client = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY
});

export async function transcribeAudioStream(audioBuffer: Buffer): Promise<string> {
    try {
        console.log(`Sending ${audioBuffer.length} bytes to ElevenLabs Scribe v2...`);

        // The SDK expects File | fs.ReadStream | Blob.
        // Raw streams often lack filename metadata, causing "file unknown is corrupted".
        // Using Bun's global File object to provide name and type.
        const audioFile = new File([audioBuffer], "voice.ogg", { type: "audio/ogg" });

        const response = await client.speechToText.convert({
            file: audioFile,
            model_id: "scribe_v2",
        });

        console.log("Transcription response received.");
        // The response body is the text?
        // Let's check the return type. It usually returns the text directly or a JSON.
        // The previous file view of `Client.js` line 120: `return _response.body;`
        // And `BodySpeechToTextV1SpeechToTextPost` didn't show response type.
        // It's likely the text string or a JSON with text.
        // Scribe v1 returns text. Scribe v2 likely the same.
        // In the absence of strong typing, I'll log and return string.

        // If response is an object, try to extract text.
        if (typeof response === 'object' && response !== null && 'text' in response) {
            return (response as any).text;
        }

        return String(response);

    } catch (error) {
        console.error("ElevenLabs REST API Error:", error);
        throw error;
    }
}

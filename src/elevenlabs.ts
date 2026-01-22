import { ElevenLabsClient } from "elevenlabs";

const client = new ElevenLabsClient({
    apiKey: Bun.env.ELEVENLABS_API_KEY
});

export async function transcribeAudioStream(audioBuffer: Buffer, extension: string = "ogg"): Promise<string> {
    try {
        console.log(`Sending ${audioBuffer.length} bytes to ElevenLabs Scribe v2...`);

        const mimeType = extension === "mp4" ? "video/mp4" : `audio/${extension}`;
        const audioFile = new File([audioBuffer], `file.${extension}`, { type: mimeType });

        const response = await client.speechToText.convert({
            file: audioFile,
            model_id: "scribe_v2",
        });

        console.log("Transcription response received.");

        if (typeof response === 'object' && response !== null && 'text' in response) {
            return (response as any).text;
        }

        return String(response);

    } catch (error) {
        console.error("ElevenLabs REST API Error:", error);
        throw error;
    }
}

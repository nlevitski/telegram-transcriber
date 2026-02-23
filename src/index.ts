import { Bot } from "grammy";
import { transcribeAudioStream } from "./elevenlabs";

const token = Bun.env.BOT_TOKEN;

if (!token) {
    throw new Error(`BOT_TOKEN is not defined in environment variables (${Bun.env.NODE_ENV || 'production'} mode)`);
}

const bot = new Bot(token);
const TELEGRAM_MESSAGE_LIMIT = 4096;

function splitTextByLimit(text: string, limit: number): string[] {
    if (text.length <= limit) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > limit) {
        const slice = remaining.slice(0, limit);
        let splitAt = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(" "));

        // If no good boundary is found, split hard at the limit.
        if (splitAt < 1 || splitAt < Math.floor(limit * 0.5)) {
            splitAt = limit;
        }

        const chunk = remaining.slice(0, splitAt).trimEnd();
        chunks.push(chunk.length > 0 ? chunk : remaining.slice(0, limit));
        remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining.length > 0) {
        chunks.push(remaining);
    }

    return chunks;
}

function splitTranscriptionForTelegram(text: string): string[] {
    if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
        return [text];
    }

    let expectedTotal = 2;

    while (true) {
        const prefix = `[${expectedTotal}/${expectedTotal}] `;
        const perChunkLimit = TELEGRAM_MESSAGE_LIMIT - prefix.length;
        const chunks = splitTextByLimit(text, perChunkLimit);

        if (chunks.length <= 1) {
            return [text];
        }

        if (chunks.length === expectedTotal) {
            return chunks.map((chunk, index) => `[${index + 1}/${chunks.length}] ${chunk}`);
        }

        expectedTotal = chunks.length;
    }
}

/**
 * Handles the transcription process: downloading, sending to ElevenLabs, and updating the status message.
 */
async function handleTranscription(ctx: any, fileId: string, replyToMessageId: number) {
    let sentMessage: any = null;

    try {
        sentMessage = await ctx.reply("📥 Downloading...", { reply_to_message_id: replyToMessageId });

        const file = await ctx.api.getFile(fileId);
        const path = file.file_path;

        if (!path) {
            throw new Error("Could not get file path from Telegram");
        }

        const fileUrl = `https://api.telegram.org/file/bot${token}/${path}`;
        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        await ctx.api.editMessageText(
            ctx.chat.id,
            sentMessage.message_id,
            "🚀 Transcribing..."
        );

        const finalTranscription = await transcribeAudioStream(buffer, path.split('.').pop() || "ogg");

        if (finalTranscription && finalTranscription.trim().length > 0) {
            const messageChunks = splitTranscriptionForTelegram(finalTranscription);

            await ctx.api.editMessageText(
                ctx.chat.id,
                sentMessage.message_id,
                messageChunks[0]
            );

            for (let i = 1; i < messageChunks.length; i++) {
                await ctx.reply(messageChunks[i], { reply_to_message_id: replyToMessageId });
            }
        } else {
            await ctx.api.editMessageText(
                ctx.chat.id,
                sentMessage.message_id,
                "⚠️ Transcription returned empty."
            );
        }

    } catch (error) {
        console.error("Error handling transcription:", error);
        const errorMessage = "❌ Failed to transcribe the message.";
        if (sentMessage) {
            try {
                await ctx.api.editMessageText(ctx.chat.id, sentMessage.message_id, errorMessage);
            } catch (e) { }
        } else {
            await ctx.reply(errorMessage, { reply_to_message_id: replyToMessageId });
        }
    }
}

function isBotMentioned(ctx: any): boolean {
    const botUsername = ctx.me.username;
    const text = ctx.message?.text ?? "";

    if (text.includes(`@${botUsername}`)) {
        return true;
    }

    const entities = ctx.message?.entities ?? [];
    for (const entity of entities) {
        if (entity.type !== "mention") continue;
        const mention = text.slice(entity.offset, entity.offset + entity.length);
        if (mention.toLowerCase() === `@${botUsername.toLowerCase()}`) {
            return true;
        }
    }

    return false;
}

function getReplyMediaFileId(ctx: any): string | null {
    const repliedMessage = ctx.message?.reply_to_message;
    const externalReply = ctx.message?.external_reply;

    const mediaFromReply = repliedMessage?.voice || repliedMessage?.audio || repliedMessage?.video_note;
    if (mediaFromReply?.file_id) return mediaFromReply.file_id;

    // Bot API may return replied content under external_reply in some contexts.
    const mediaFromExternalReply = externalReply?.voice || externalReply?.audio || externalReply?.video_note;
    if (mediaFromExternalReply?.file_id) return mediaFromExternalReply.file_id;

    // Some clients send audio as generic documents.
    const docMime = repliedMessage?.document?.mime_type || externalReply?.document?.mime_type;
    const doc = repliedMessage?.document || externalReply?.document;
    if (doc?.file_id && typeof docMime === "string" && docMime.startsWith("audio/")) {
        return doc.file_id;
    }

    return null;
}

// 1. Group Chats: Handle mentions in replies to voice/audio/video note messages
bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return;

    const isReply = !!ctx.message.reply_to_message || !!ctx.message.external_reply;
    if (!isReply) return;

    if (!isBotMentioned(ctx)) return;

    const mediaFileId = getReplyMediaFileId(ctx);
    if (!mediaFileId) {
        await ctx.reply(
            "⚠️ I can’t access media in that replied message. Ask the sender to resend voice/audio after I’m in the group, then reply-mention me again.",
            { reply_to_message_id: ctx.message.message_id }
        );
        return;
    }

    await handleTranscription(ctx, mediaFileId, ctx.message.reply_to_message?.message_id || ctx.message.message_id);
});

// 2. Group Chats: Auto-transcribe new voice/audio/video note messages without mentions
bot.on(["message:voice", "message:audio", "message:video_note"], async (ctx) => {
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
        const media = ctx.message.voice || ctx.message.audio || ctx.message.video_note;
        if (media) {
            await handleTranscription(ctx, media.file_id, ctx.message.message_id);
        }
    }
});

// 3. Private Chats: Auto-transcribe voice, audio, and video notes
bot.on(["message:voice", "message:audio", "message:video_note"], async (ctx) => {
    if (ctx.chat.type === "private") {
        const media = ctx.message.voice || ctx.message.audio || ctx.message.video_note;
        if (media) {
            await handleTranscription(ctx, media.file_id, ctx.message.message_id);
        }
    }
});

bot.start({
    onStart: (botInfo) => {
        console.log(`Bot @${botInfo.username} started! (Mode: ${Bun.env.NODE_ENV || 'production'})`);
    }
});

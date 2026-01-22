import { Bot } from "grammy";
import { transcribeAudioStream } from "./elevenlabs";

const token = Bun.env.BOT_TOKEN;

if (!token) {
    throw new Error(`BOT_TOKEN is not defined in environment variables (${Bun.env.NODE_ENV || 'production'} mode)`);
}

const bot = new Bot(token);

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
            await ctx.api.editMessageText(
                ctx.chat.id,
                sentMessage.message_id,
                finalTranscription
            );
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

// 1. Group Chats: Handle mentions in replies to voice/audio/video messages
bot.on("message:text", async (ctx) => {
    const isReply = !!ctx.message.reply_to_message;
    if (!isReply) return;

    const botUsername = ctx.me.username;
    const isMentioned = ctx.message.text?.includes(`@${botUsername}`);
    if (!isMentioned) return;

    const repliedMessage = ctx.message.reply_to_message;
    const media = repliedMessage?.voice || repliedMessage?.audio || repliedMessage?.video_note;

    if (media) {
        await handleTranscription(ctx, media.file_id, repliedMessage.message_id);
    }
});

// 2. Private Chats: Auto-transcribe voice, audio, and video notes
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


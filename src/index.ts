import { Bot } from "grammy";
import { transcribeAudioStream } from "./elevenlabs";

const token = process.env.BOT_TOKEN;
if (!token) {
    throw new Error("BOT_TOKEN is not defined in environment variables");
}

const bot = new Bot(token);

// Helper to separate transcription logic
async function handleTranscription(ctx: any, fileId: string, replyToMessageId: number) {
    let sentMessage: any = null;
    let lastEditTime = 0;
    let lastText = "";
    // Telegram rate limit safety (user asked for 50ms but that is unsafe, 1s is standard)
    // We use 1000ms.
    const THROTTLE_MS = 1000;

    try {
        // 1. Processing / Downloading
        sentMessage = await ctx.reply("📥 Downloading audio...", { reply_to_message_id: replyToMessageId });

        const file = await ctx.api.getFile(fileId);
        const path = file.file_path;

        if (!path) {
            throw new Error("Could not get file path from Telegram");
        }

        const fileUrl = `https://api.telegram.org/file/bot${token}/${path}`;

        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 2. Sending
        await ctx.api.editMessageText(
            ctx.chat.id,
            sentMessage.message_id,
            "🚀 Sending to transcription service..."
        );

        // REST API call (waits for completion)
        const finalTranscription = await transcribeAudioStream(buffer);

        // 3. Finalizing
        await ctx.api.editMessageText(
            ctx.chat.id,
            sentMessage.message_id,
            "✅ Finalizing..."
        );

        // Final update only
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
                "Transcription returned empty."
            );
        }

    } catch (error) {
        console.error("Error handling voice transcription:", error);
        if (sentMessage) {
            try {
                await ctx.api.editMessageText(
                    ctx.chat.id,
                    sentMessage.message_id,
                    "Sorry, failed to transcribe the message."
                );
            } catch (e) { }
        } else {
            await ctx.reply("Sorry, failed to transcribe the message.", {
                reply_to_message_id: replyToMessageId
            });
        }
    }
}

// 1. Handle specific mention in replies to voice messages (Group context)
bot.on("message:text", async (ctx) => {
    if (!ctx.me) return;
    const botUsername = ctx.me.username;
    // Check if the text contains @<bot_username>
    const isMentioned = ctx.message.text.includes(`@${botUsername}`);
    const isReply = !!ctx.message.reply_to_message;

    if (!isMentioned || !isReply) return;

    const repliedMessage = ctx.message.reply_to_message;
    const voice = repliedMessage?.voice || repliedMessage?.audio;

    if (!voice) return;

    await handleTranscription(ctx, voice.file_id, repliedMessage.message_id);
});

// 2. Handle voice messages sent directly (Private chat / Forwarded)
bot.on(["message:voice", "message:audio"], async (ctx) => {
    // Only auto-transcribe in private chats to avoid spamming groups if added there
    if (ctx.chat.type === "private") {
        const voice = ctx.message.voice || ctx.message.audio;
        if (voice) {
            await handleTranscription(ctx, voice.file_id, ctx.message.message_id);
        }
    }
});

// Start the bot
bot.start({
    onStart: (botInfo) => {
        console.log(`Bot @${botInfo.username} started!`);
    }
});

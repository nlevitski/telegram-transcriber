import { ElevenLabsClient } from "elevenlabs";

type ElevenLabsAccount = {
    name: string;
    envName: string;
    client: ElevenLabsClient;
};

type CreditStatus = {
    used: number;
    limit: number;
    remaining: number;
    remainingPercent: number;
};

const CREDIT_THRESHOLD_PERCENT = parseCreditThresholdPercent(Bun.env.ELEVENLABS_MIN_CREDIT_PERCENT);

const accounts = [
    createAccount("default", "ELEVENLABS_API_KEY", Bun.env.ELEVENLABS_API_KEY),
    createAccount("levitenv", "ELEVENLABS_API_KEY_LEVITENV", Bun.env.ELEVENLABS_API_KEY_LEVITENV),
].filter((account): account is ElevenLabsAccount => account !== null);

if (accounts.length === 0) {
    throw new Error("No ElevenLabs API keys configured. Set ELEVENLABS_API_KEY at minimum.");
}

let activeAccountIndex = 0;

function createAccount(name: string, envName: string, apiKey: string | undefined): ElevenLabsAccount | null {
    if (!apiKey) {
        return null;
    }

    return {
        name,
        envName,
        client: new ElevenLabsClient({ apiKey }),
    };
}

function parseCreditThresholdPercent(value: string | undefined): number {
    if (!value) {
        return 0.5;
    }

    const parsed = Number(value.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        throw new Error(`ELEVENLABS_MIN_CREDIT_PERCENT must be a number between 0 and 100, got "${value}".`);
    }

    return parsed;
}

function getCreditStatus(subscription: Awaited<ReturnType<ElevenLabsClient["user"]["getSubscription"]>>): CreditStatus {
    const used = subscription.character_count;
    const limit = subscription.character_limit;
    const remaining = Math.max(limit - used, 0);
    const remainingPercent = limit > 0 ? (remaining / limit) * 100 : 0;

    return { used, limit, remaining, remainingPercent };
}

function formatPercent(value: number): string {
    return value.toFixed(3).replace(/\.?0+$/, "");
}

async function getAccountCreditStatus(account: ElevenLabsAccount): Promise<CreditStatus> {
    const subscription = await account.client.user.getSubscription({
        timeoutInSeconds: 10,
        maxRetries: 1,
    });

    return getCreditStatus(subscription);
}

function isAboveCreditThreshold(status: CreditStatus): boolean {
    return status.remainingPercent > CREDIT_THRESHOLD_PERCENT;
}

async function getActiveAccount(): Promise<ElevenLabsAccount> {
    const checkedAccounts: string[] = [];
    let checkedAnyCreditStatus = false;

    for (let offset = 0; offset < accounts.length; offset++) {
        const index = (activeAccountIndex + offset) % accounts.length;
        const account = accounts[index]!;

        try {
            const status = await getAccountCreditStatus(account);
            checkedAnyCreditStatus = true;
            const statusText = `${account.name}: ${status.remaining}/${status.limit} credits left (${formatPercent(status.remainingPercent)}%)`;
            checkedAccounts.push(statusText);

            if (isAboveCreditThreshold(status)) {
                if (activeAccountIndex !== index) {
                    console.log(`Switching ElevenLabs account to ${account.name} (${account.envName}).`);
                }

                activeAccountIndex = index;
                console.log(`Using ElevenLabs account ${statusText}.`);
                return account;
            }

            console.warn(
                `ElevenLabs account ${statusText}; threshold is ${formatPercent(CREDIT_THRESHOLD_PERCENT)}%, trying next key.`
            );
        } catch (error) {
            checkedAccounts.push(`${account.name}: failed to read subscription (${error instanceof Error ? error.message : String(error)})`);
            console.warn(`Could not read ElevenLabs subscription for ${account.name}; trying next key.`, error);
        }
    }

    if (!checkedAnyCreditStatus) {
        const account = accounts[activeAccountIndex]!;
        console.warn(
            `Could not read ElevenLabs credit status for any configured key. ` +
            `Using ${account.name} (${account.envName}) without rotation. Checked: ${checkedAccounts.join("; ")}`
        );
        return account;
    }

    throw new Error(
        `No ElevenLabs API key has more than ${formatPercent(CREDIT_THRESHOLD_PERCENT)}% credits remaining. Checked: ${checkedAccounts.join("; ")}`
    );
}

export async function transcribeAudioStream(audioBuffer: Buffer, extension: string = "ogg"): Promise<string> {
    try {
        console.log(`Sending ${audioBuffer.length} bytes to ElevenLabs Scribe v2...`);

        const mimeType = extension === "mp4" ? "video/mp4" : `audio/${extension}`;
        const audioFile = new File([audioBuffer], `file.${extension}`, { type: mimeType });
        const account = await getActiveAccount();

        const response = await account.client.speechToText.convert({
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

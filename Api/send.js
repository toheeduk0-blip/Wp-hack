// File: /api/send.js

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'TEJAS-AI-Official';
const GITHUB_REPO = 'Wphackserver';
const FILE_PATH = 'keys.json';

// In-memory cache for keys to reduce GitHub API calls
let keyCache = {
    data: null,
    lastFetched: 0,
    etag: null // Use ETag for conditional fetching
};
const CACHE_DURATION_MS = 60 * 1000; // Cache for 1 minute

async function getKeys() {
    const now = Date.now();
    if (keyCache.data && (now - keyCache.lastFetched < CACHE_DURATION_MS)) {
        return keyCache.data;
    }

    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    const headers = {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
    };
    
    if (keyCache.etag) {
        headers['If-None-Match'] = keyCache.etag;
    }

    try {
        const response = await fetch(url, { headers });

        if (response.status === 304) {
            keyCache.lastFetched = now;
            return keyCache.data;
        }

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.statusText}`);
        }
        
        const fileData = await response.json();
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        const keys = JSON.parse(content);
        
        keyCache.data = keys;
        keyCache.lastFetched = now;
        keyCache.etag = response.headers.get('etag');

        return keys;
    } catch (error) {
        console.error("Failed to fetch/update keys from GitHub:", error);
        return keyCache.data || null;
    }
}

// Function to send a notification message to the user's bot
// This is a "fire-and-forget" function; it won't block the main response.
function sendTelegramNotification(botToken, chatId, text) {
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
            }),
        }); // No await, just fire and forget.
    } catch (notificationError) {
        // Log the error on the server, but don't let it affect the main flow.
        console.error('Failed to send notification:', notificationError.message);
    }
}


export default async function handler(request, response) {
    // Standard CORS headers for preflight requests
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    if (request.method !== 'POST') {
        return response.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    if (!GITHUB_TOKEN) {
        return response.status(500).json({ success: false, message: 'Server configuration error: GITHUB_TOKEN is not set.' });
    }

    try {
        const { accessKey, message } = request.body;

        if (!accessKey || !message) {
            return response.status(400).json({ success: false, message: 'Missing accessKey or message in request body.' });
        }

        const allKeys = await getKeys();
        if (!allKeys) {
            return response.status(503).json({ success: false, message: 'Service Unavailable: Could not retrieve API keys.' });
        }
        
        const keyData = allKeys.find(k => k.accessKey === accessKey);

        // --- MODIFICATION 1: HANDLE DELETED/INVALID KEYS ---
        // If key is not found, we can't send a Telegram message because we don't have the bot token.
        // So, we return a helpful error message in the API response.
        if (!keyData) {
            return response.status(403).json({
                success: false,
                message: 'Your key has been expired or is invalid. Buy a new key.\nDM: @SG_Moddder'
            });
        }

        const now = new Date();
        const expiryDate = new Date(keyData.expiresAt);

        // --- MODIFICATION 2: HANDLE EXPIRED KEYS ---
        // If key is found but expired, send a notification to the user's bot and return an error.
        if (now > expiryDate) {
            const expiredMessage = 'Your key has been expired. Buy a new key.\nDM: @SG_Moddder';
            // Send the notification to the user's own bot
            sendTelegramNotification(keyData.botToken, keyData.chatId, expiredMessage);
            
            // Return the error response to the API caller
            return response.status(403).json({ success: false, message: 'Access key has expired.' });
        }

        // If key is valid, proceed to send the user's message
        const finalMessage = `${message}\n\nMade by @sgmoddernew`;

        const { botToken, chatId } = keyData;
        const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        
        const telegramResponse = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: finalMessage,
                parse_mode: 'Markdown'
            }),
        });

        const telegramResult = await telegramResponse.json();

        if (!telegramResult.ok) {
            console.error("Telegram API Error:", telegramResult.description);
            if (telegramResult.description.includes("chat not found") || telegramResult.description.includes("bot token")) {
                return response.status(400).json({ success: false, message: `Telegram error: ${telegramResult.description}. Please check your Bot Token and Chat ID in the panel.` });
            }
            return response.status(502).json({ success: false, message: 'Bad Gateway: Failed to send message via Telegram.' });
        }

        return response.status(200).json({ success: true, message: 'Message sent successfully.' });

    } catch (error) {
        console.error('API Error in /api/send:', error);
        return response.status(500).json({ success: false, message: 'An internal server error occurred.' });
    }
}

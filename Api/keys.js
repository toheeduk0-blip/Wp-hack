// File: /api/keys.js

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'TEJAS-AI-Official';
const GITHUB_REPO = 'Wphackserver';
const FILE_PATH = 'keys.json';

const API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;

async function getFileFromGithub() {
    try {
        const response = await fetch(API_URL, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` },
        });

        if (response.status === 404) {
            return { keys: [], sha: null };
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`GitHub API Error: ${response.status} ${response.statusText}. Response: ${errorText}`);
        }

        const data = await response.json();
        let keys;
        try {
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            keys = JSON.parse(content);
        } catch (parseError) {
             console.log("File is empty or contains invalid JSON. Initializing as empty array.");
             keys = [];
        }
        
        return { keys: keys, sha: data.sha };

    } catch (error) {
        if (error instanceof SyntaxError) {
             return { keys: [], sha: null };
        }
        console.error("Error in getFileFromGithub:", error);
        throw error;
    }
}

async function saveFileToGithub(keys, sha, commitMessage) {
    const content = Buffer.from(JSON.stringify(keys, null, 2)).toString('base64');
    const body = {
        message: commitMessage,
        content: content,
        sha: sha,
    };

    const response = await fetch(API_URL, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`GitHub API Error: ${errorData.message}`);
    }
    return await response.json();
}

export default async function handler(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }
    
    if (!GITHUB_TOKEN) {
        return response.status(500).json({ message: 'Server configuration error: GITHUB_TOKEN is not set.' });
    }

    try {
        switch (request.method) {
            case 'GET':
                const { keys } = await getFileFromGithub();
                return response.status(200).json(keys);

            case 'POST':
                const { name, botToken, chatId, days } = request.body;
                if (!name || !botToken || !chatId || !days) {
                    return response.status(400).json({ message: 'Missing required fields.' });
                }

                const { keys: currentKeys, sha } = await getFileFromGithub();
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + days);
                const newKey = {
                    name,
                    accessKey: 'key-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
                    botToken,
                    chatId,
                    createdAt: new Date().toISOString(),
                    expiresAt: expiresAt.toISOString(),
                };
                
                currentKeys.push(newKey);
                await saveFileToGithub(currentKeys, sha, `[Panel] Create key: ${name}`);
                return response.status(201).json(newKey);

            case 'PUT':
                const { accessKey: extendKey } = request.body;
                if (!extendKey) {
                    return response.status(400).json({ message: 'Missing accessKey.' });
                }

                const { keys: extendKeys, sha: extendSha } = await getFileFromGithub();
                const keyIndex = extendKeys.findIndex(k => k.accessKey === extendKey);

                if (keyIndex === -1) return response.status(404).json({ message: 'Key not found.' });

                const currentExpiry = new Date(extendKeys[keyIndex].expiresAt);
                const baseDate = new Date() > currentExpiry ? new Date() : currentExpiry;
                baseDate.setDate(baseDate.getDate() + 30);
                extendKeys[keyIndex].expiresAt = baseDate.toISOString();
                
                await saveFileToGithub(extendKeys, extendSha, `[Panel] Extend key: ${extendKeys[keyIndex].name}`);
                return response.status(200).json(extendKeys[keyIndex]);

            case 'DELETE':
                const { key: deleteKey } = request.query;
                if (!deleteKey) return response.status(400).json({ message: 'Missing key parameter.' });
                
                const { keys: deleteKeys, sha: deleteSha } = await getFileFromGithub();
                const updatedKeys = deleteKeys.filter(k => k.accessKey !== deleteKey);

                if (updatedKeys.length === deleteKeys.length) return response.status(404).json({ message: 'Key not found.' });

                await saveFileToGithub(updatedKeys, deleteSha, `[Panel] Delete key: ${deleteKey}`);
                return response.status(200).json({ message: 'Key deleted successfully.' });

            default:
                return response.status(405).json({ message: 'Method Not Allowed' });
        }
    } catch (error) {
        console.error('API Error in /api/keys:', error);
        return response.status(500).json({ message: `Internal Server Error: ${error.message}` });
    }
}

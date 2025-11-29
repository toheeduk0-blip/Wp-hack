// File: /api/auth.js

export default async function handler(request, response) {
    // Only allow POST requests
    if (request.method !== 'POST') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }

    // Pull credentials securely from Environment Variables
    const correctUsername = process.env.PANEL_USER;
    const correctPassword = process.env.PANEL_PASS;

    if (!correctUsername || !correctPassword) {
        return response.status(500).json({ message: 'Server configuration error: Credentials not set.' });
    }

    try {
        const { username, password } = request.body;

        if (username === correctUsername && password === correctPassword) {
            // Authentication successful
            return response.status(200).json({ success: true, message: 'Login successful.' });
        } else {
            // Authentication failed
            return response.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

    } catch (error) {
        console.error('Auth API Error:', error);
        return response.status(500).json({ message: 'An internal server error occurred.' });
    }
}

/**
 * games.random - Express API Server
 * 
 * RESTful API server for AI game generation with Google OAuth authentication,
 * MongoDB persistence, and real-time streaming capabilities.
 * 
 * Features:
 * - Google OAuth 2.0 authentication
 * - MongoDB storage for users and generated games
 * - AI game generation (standard and streaming)
 * - Interactive code assistant chatbot
 * - Session management with Passport.js
 * 
 * @module server
 * @author Shayan Mazahir, Rayyan Moosani
 * @license GPL-3.0-or-later
 */

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import mongoose from 'mongoose';
import { generateGame, chatWithCodeAssistant, generateGameStreaming } from './main.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';


// Load environment variables from .env file
dotenv.config();

const app = express();

// ========== CONFIGURATION ==========

// ES module path resolution (required for __dirname in ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment variables with fallback defaults
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'your-client-id';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'your-client-secret';
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-secret-change-in-production';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://......';
const PORT = process.env.PORT || 3000;

// Validate OAuth configuration
const isOAuthConfigured = GOOGLE_CLIENT_ID !== 'your-client-id' && GOOGLE_CLIENT_SECRET !== 'your-client-secret';

if (!isOAuthConfigured) {
    console.warn('⚠️  WARNING: Google OAuth not configured!');
    console.warn('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file');
}

// ========== MONGODB CONNECTION ==========

/**
 * Connect to MongoDB database
 * Uses MONGODB_URI from environment variables
 */
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB');
    })
    .catch((err) => {
        console.error('❌ MongoDB connection error:', err);
        console.error('Make sure MONGODB_URI is set in your .env file');
    });

// ========== MONGOOSE SCHEMAS ==========

/**
 * User Schema - Stores authenticated user information
 * 
 * @typedef {Object} User
 * @property {string} googleId - Unique Google account ID
 * @property {string} email - User's email address
 * @property {string} name - User's display name
 * @property {string} avatar - URL to user's profile picture
 * @property {Date} createdAt - Account creation timestamp
 */
const userSchema = new mongoose.Schema({
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: String,
    avatar: String,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

/**
 * Game Schema - Stores user-generated games
 * 
 * @typedef {Object} Game
 * @property {string} userId - ID of the user who created this game
 * @property {string} title - Game title
 * @property {string} description - Natural language description used to generate the game
 * @property {string} code - Generated JavaScript game code
 * @property {string} library - Game library used ('p5js' or 'phaser')
 * @property {Date} createdAt - Game creation timestamp
 * @property {Date} updatedAt - Last modification timestamp
 */
const gameSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    code: { type: String, required: true },
    library: { type: String, required: true, enum: ['p5js', 'phaser'] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Index for faster queries by user and creation date
gameSchema.index({ userId: 1, createdAt: -1 });

const Game = mongoose.model('Game', gameSchema);

// ========== MIDDLEWARE ==========

/**
 * CORS configuration - Allow cross-origin requests with credentials
 * Enable credentials for session cookie support
 */
app.use(cors({
    origin: true,  // Allow all origins (configure stricter for production)
    credentials: true
}));

// Parse JSON request bodies
app.use(express.json());

/**
 * Session configuration
 * Sessions are stored in memory (use MongoDB store for production)
 */
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,  // Set to true in production with HTTPS
        maxAge: 24 * 60 * 60 * 1000  // 24 hours
    }
}));

// Initialize Passport for authentication
app.use(passport.initialize());
app.use(passport.session());

// ========== PASSPORT CONFIGURATION ==========

/**
 * Google OAuth Strategy Configuration
 * Handles user authentication via Google accounts
 */
if (isOAuthConfigured) {
    passport.use(new GoogleStrategy({
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: `http://localhost:${PORT}/auth/google/callback`
    },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // Find existing user or create new one
                let user = await User.findOne({ googleId: profile.id });

                if (!user) {
                    // Create new user in database
                    user = await User.create({
                        googleId: profile.id,
                        email: profile.emails[0].value,
                        name: profile.displayName,
                        avatar: profile.photos[0].value
                    });
                    console.log(`✅ New user created: ${user.name}`);
                } else {
                    console.log(`✅ User logged in: ${user.name}`);
                }

                // Return user object for session
                return done(null, {
                    id: user.googleId,
                    name: user.name,
                    email: user.email,
                    avatar: user.avatar
                });
            } catch (error) {
                console.error('Error in OAuth callback:', error);
                return done(error, null);
            }
        }
    ));

    // Serialize user for session storage
    passport.serializeUser((user, done) => {
        done(null, user);
    });

    // Deserialize user from session
    passport.deserializeUser((user, done) => {
        done(null, user);
    });
}

// ========== AUTHENTICATION ROUTES ==========

/**
 * GET /auth/google
 * Initiate Google OAuth flow
 * Redirects user to Google sign-in page
 */
app.get('/auth/google', (req, res, next) => {
    console.log('🔐 /auth/google route hit');
    if (!isOAuthConfigured) {
        return res.status(500).send(`
            <h1>❌ OAuth Not Configured</h1>
            <p>Please set up your Google OAuth credentials in the .env file</p>
            <ol>
                <li>Go to <a href="https://console.cloud.google.com/">Google Cloud Console</a></li>
                <li>Create OAuth 2.0 credentials</li>
                <li>Add http://localhost:3000/auth/google/callback as redirect URI</li>
                <li>Copy credentials to .env file</li>
            </ol>
            <a href="/">Go back</a>
        `);
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

/**
 * GET /auth/google/callback
 * Google OAuth callback endpoint
 * Handles successful authentication and redirects to home
 */
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        console.log('✅ OAuth callback successful');
        res.redirect('/');
    }
);

/**
 * GET /auth/logout
 * Log out current user and destroy session
 */
app.get('/auth/logout', (req, res) => {
    console.log('👋 /auth/logout route hit');
    req.logout((err) => {
        if (err) {
            console.error('❌ Logout error:', err);
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }
        console.log('✅ User logged out');
        res.redirect('/');
    });
});

/**
 * GET /auth/current-user
 * Get currently authenticated user information
 * 
 * @returns {Object} User object or null if not authenticated
 */
app.get('/auth/current-user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({
            success: true,
            user: req.user
        });
    } else {
        res.json({
            success: false,
            user: null
        });
    }
});

// ========== MIDDLEWARE: REQUIRE AUTH ==========

/**
 * Authentication middleware
 * Protects routes that require user to be logged in
 * 
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Next middleware function
 * @returns {void|Response} Proceeds to next middleware or returns 401 error
 */
function requireAuth(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({
        success: false,
        error: 'Authentication required'
    });
}

// ========== API ROUTES ==========

/**
 * GET /api
 * API status and documentation endpoint
 * Shows server status, auth status, and available endpoints
 */
app.get('/api', (req, res) => {
    const authStatus = req.isAuthenticated() ? `✅ Logged in as ${req.user.name}` : '❌ Not authenticated';
    const dbStatus = mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Disconnected';

    res.send(`
        <h1>🎮 games.random API Server</h1>
        <p>Server is running!</p>
        <p><strong>Auth Status:</strong> ${authStatus}</p>
        <p><strong>OAuth Configured:</strong> ${isOAuthConfigured ? '✅ Yes' : '❌ No'}</p>
        <p><strong>Database:</strong> ${dbStatus}</p>
        <p>Available endpoints:</p>
        <ul>
            <li>POST /api/generate - Generate a game</li>
            <li>POST /api/generate-stream - Generate a game (streaming)</li>
            <li>POST /api/chat - Chat with code assistant</li>
            <li><strong>GET /auth/google - Login with Google</strong></li>
            <li>GET /auth/logout - Logout</li>
            <li>GET /auth/current-user - Get current user</li>
            <li>POST /api/save-game - Save a game (auth required)</li>
            <li>GET /api/my-games - Get saved games (auth required)</li>
            <li>DELETE /api/games/:id - Delete a game (auth required)</li>
        </ul>
    `);
});

/**
 * POST /api/save-game
 * Save a generated game to user's account
 * Requires authentication
 * 
 * @param {Object} req.body - Request body
 * @param {string} req.body.title - Game title
 * @param {string} req.body.description - Game description
 * @param {string} req.body.code - Generated game code
 * @param {string} req.body.library - Library used ('p5js' or 'phaser')
 * @returns {Object} Saved game object with ID
 */
app.post('/api/save-game', requireAuth, async (req, res) => {
    try {
        const { title, description, code, library } = req.body;
        const userId = req.user.id;

        // Validate required fields
        if (!title || !description || !code || !library) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        // Create new game document in MongoDB
        const newGame = await Game.create({
            userId,
            title,
            description,
            code,
            library
        });

        console.log(`💾 Game saved to MongoDB: "${title}" for user ${req.user.name}`);

        res.json({
            success: true,
            game: {
                id: newGame._id.toString(),
                title: newGame.title,
                description: newGame.description,
                code: newGame.code,
                library: newGame.library,
                createdAt: newGame.createdAt
            }
        });

    } catch (error) {
        console.error('❌ Error saving game:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/my-games
 * Retrieve all games created by the authenticated user
 * Requires authentication
 * 
 * @returns {Array<Object>} Array of user's saved games, sorted by creation date
 */
app.get('/api/my-games', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;

        // Fetch games from MongoDB, sorted by most recent first
        const games = await Game.find({ userId })
            .sort({ createdAt: -1 })
            .lean(); // Convert to plain JavaScript objects for better performance

        console.log(`📂 Fetching ${games.length} games from MongoDB for user ${req.user.name}`);

        // Transform MongoDB _id to id for frontend consistency
        const gamesFormatted = games.map(game => ({
            id: game._id.toString(),
            title: game.title,
            description: game.description,
            code: game.code,
            library: game.library,
            createdAt: game.createdAt
        }));

        res.json({
            success: true,
            games: gamesFormatted
        });

    } catch (error) {
        console.error('❌ Error fetching games:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/games/:gameId
 * Delete a specific game from user's account
 * Requires authentication and ownership verification
 * 
 * @param {string} req.params.gameId - MongoDB ObjectId of the game to delete
 * @returns {Object} Success confirmation
 */
app.delete('/api/games/:gameId', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { gameId } = req.params;

        // Find and delete game only if it belongs to the authenticated user
        const deletedGame = await Game.findOneAndDelete({
            _id: gameId,
            userId: userId
        });

        if (!deletedGame) {
            return res.status(404).json({
                success: false,
                error: 'Game not found or you do not have permission to delete it'
            });
        }

        console.log(`🗑️ Game deleted from MongoDB: "${deletedGame.title}" by user ${req.user.name}`);

        res.json({
            success: true,
            message: 'Game deleted successfully'
        });

    } catch (error) {
        console.error('❌ Error deleting game:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/generate
 * Generate game code using AI
 * Public endpoint - no authentication required
 * 
 * @param {Object} req.body - Request body
 * @param {string} req.body.description - Natural language game description
 * @param {string} req.body.library - Game library ('p5js' or 'phaser')
 * @returns {Object} Generated game code and metadata
 */
app.post('/api/generate', async (req, res) => {
    try {
        const { description, library } = req.body;

        // Validate description
        if (!description) {
            return res.status(400).json({
                success: false,
                error: 'Description is required. Please describe the game you want to create.'
            });
        }

        if (description.trim().length < 5) {
            return res.status(400).json({
                success: false,
                error: 'Description is too short. Please provide more details.'
            });
        }

        // Validate library
        if (!library) {
            return res.status(400).json({
                success: false,
                error: 'Library is required. Choose either "p5js" or "phaser".'
            });
        }

        const normalizedLibrary = library.toLowerCase();
        if (!['p5js', 'phaser'].includes(normalizedLibrary)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid library. Must be either "p5js" or "phaser".'
            });
        }

        console.log(`🎮 Request: Generate ${normalizedLibrary} game: "${description}"`);

        // Generate game code using AI
        const startTime = performance.now();
        const gameCode = await generateGame(description, normalizedLibrary);
        const endTime = performance.now();

        console.log('✅ Game generated successfully!');
        console.log(`⏱️ Generation time: ${((endTime - startTime) / 1000).toFixed(2)}s`);

        res.json({
            success: true,
            code: gameCode,
            library: normalizedLibrary
        });

    } catch (error) {
        console.error('❌ Server Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/generate-stream
 * Generate game code with real-time streaming
 * Uses Server-Sent Events (SSE) to stream code as it's generated
 * Public endpoint - no authentication required
 * 
 * @param {Object} req.body - Request body
 * @param {string} req.body.description - Natural language game description
 * @param {string} req.body.library - Game library ('p5js' or 'phaser')
 * @returns {Stream} SSE stream of code chunks
 */
app.post('/api/generate-stream', async (req, res) => {
    try {
        const { description, library } = req.body;

        // Validate input
        if (!description || description.trim().length < 5) {
            return res.status(400).json({
                success: false,
                error: 'Description is required and must be at least 5 characters.'
            });
        }

        const normalizedLibrary = (library || 'p5js').toLowerCase();
        if (!['p5js', 'phaser'].includes(normalizedLibrary)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid library. Must be either "p5js" or "phaser".'
            });
        }

        console.log(`⚡ Streaming request: ${normalizedLibrary} - "${description}"`);

        // Set up Server-Sent Events headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');  // Disable nginx buffering

        // Stream game generation with callback for each chunk
        await generateGameStreaming(description, normalizedLibrary, (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        });

        res.end();

    } catch (error) {
        console.error('❌ Streaming Server Error:', error.message);
        res.write(`data: ${JSON.stringify({
            type: 'error',
            error: error.message
        })}\n\n`);
        res.end();
    }
});

/**
 * POST /api/chat
 * Interactive code assistant for modifying generated games
 * Public endpoint - no authentication required
 * 
 * @param {Object} req.body - Request body
 * @param {string} req.body.message - User's question or request
 * @param {string} req.body.gameCode - Current game code for context
 * @param {string} req.body.library - Game library being used
 * @returns {Object} AI assistant's response
 */
app.post('/api/chat', async (req, res) => {
    try {
        const { message, gameCode, library } = req.body;

        // Validate message
        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: "Message is required."
            });
        }

        // Validate context
        if (!gameCode || !library) {
            return res.status(400).json({
                success: false,
                error: "Game code and library information are required."
            });
        }

        console.log(`💬 Chat request for ${library} game`);

        // Get AI response
        const reply = await chatWithCodeAssistant(message, gameCode, library);

        res.json({
            success: true,
            reply
        });

    } catch (error) {
        console.error("❌ Chatbot API Error:", error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========== STATIC FILE SERVING ==========

/**
 * Serve frontend static files
 * Serves HTML, CSS, JS, and other assets from the front-end directory
 */
app.use(express.static(path.join(__dirname, '../../front-end/public')));

// ========== START SERVER ==========

/**
 * Start Express server and listen on configured port
 * Displays startup information and configuration status
 */
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📝 Ready to generate games!`);
    console.log(`🔐 Google OAuth configured: ${isOAuthConfigured ? '✅' : '❌'}`);
    console.log(`🗄️  MongoDB URI: ✅`);
    if (!isOAuthConfigured) {
        console.log('   ⚠️  Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env to enable auth');
    }
});
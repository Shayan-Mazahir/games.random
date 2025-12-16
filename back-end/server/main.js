/**
 * games.random - AI Game Generator Core Module
 * 
 * This module handles AI-powered game code generation using Claude API.
 * Supports p5.js and Phaser game libraries with prompt caching for performance.
 * 
 * @module main
 * @author Shayan Mazahir
 * @license GPL-3.0-or-later
 */

import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module (server.js)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from secrets directory
// Use absolute path based on server.js location
dotenv.config({ path: join(__dirname, '../secrets/.env') });

// Initialize Anthropic API client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Load game generation prompts for different libraries
// Use absolute paths based on server.js location
const p5jsPrompt = await readFile(join(__dirname, '../prompts/prompt-p5js.txt'), 'utf8');
const phaserPrompt = await readFile(join(__dirname, '../prompts/prompt-phaser.txt'), 'utf8');
const AIchatbotPrompt = await readFile(join(__dirname, '../prompts/AIchatbot-Prompts.txt'), 'utf8');

// Cache the most recently generated clean code for chat context
let TheCleanCode = "";

/**
 * Removes markdown formatting from AI-generated code responses
 * Strips code blocks, bold text, headers, and excessive whitespace
 * 
 * @param {string} text - Raw markdown text from AI response
 * @returns {string} Clean JavaScript code ready for execution
 */
function stripMarkdownCodeBlocks(text) {
    return text
        .replace(/```(?:javascript|js|typescript|ts)?\s*/gi, '')  // Remove code block starts
        .replace(/\s*```/g, '')                                    // Remove code block ends
        .replace(/\*\*([^*]+)\*\*/g, '$1')                        // Remove bold ** but keep text
        .replace(/^---+$/gm, '')                                   // Remove horizontal rules ---
        .replace(/^#+\s*/gm, '')                                   // Remove headers #
        .replace(/\n{3,}/g, '\n\n')                               // Clean up extra newlines
        .trim();
}

/**
 * Generate a complete game using Claude AI with prompt caching
 * 
 * Uses ephemeral caching to speed up repeated requests with the same system prompt.
 * First call creates cache (~5s), subsequent calls use cache (~0.5s, 90% faster).
 * 
 * @param {string} description - Natural language description of the game to generate
 * @param {string} [library='p5js'] - Game library to use ('p5js' or 'phaser')
 * @returns {Promise<string>} Clean, executable JavaScript game code
 * @throws {Error} If API call fails or authentication issues occur
 * 
 * @example
 * const code = await generateGame("Make a space invaders clone", "p5js");
 */
export async function generateGame(description, library = 'p5js') {
    try {
        console.log(`\n🤖 Asking Claude (using ${library.toUpperCase()})...\n`);

        // Choose the correct system prompt based on library
        const systemPrompt = library === 'phaser' ? phaserPrompt : p5jsPrompt;

        // Log prompt sizes for debugging
        console.log(`📏 System prompt length: ${systemPrompt.length} characters`);
        console.log(`📏 User message length: ${description.length} characters`);
        console.log(`📏 Total input: ${systemPrompt.length + description.length} chars`);

        const startTime = performance.now();

        // Create API request with prompt caching enabled
        // Cache reduces cost by ~90% and latency by ~90% on repeat calls
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 7000, // Balanced for complex games
            system: [
                {
                    type: "text",
                    text: systemPrompt,
                    cache_control: { type: "ephemeral" } // Enable caching
                }
            ],
            messages: [
                {
                    role: 'user',
                    content: description
                }
            ]
        });

        const endTime = performance.now();
        const apiTime = ((endTime - startTime) / 1000).toFixed(2);

        // Extract text content from response blocks
        let response = '';
        for (const block of message.content) {
            if (block.type === 'text') {
                response += block.text;
            }
        }

        // Clean markdown formatting
        const cleanCode = stripMarkdownCodeBlocks(response);

        // Log performance metrics
        const usage = message.usage;
        console.log(`⏱️  Claude API time: ${apiTime}s`);
        console.log(`📊 Tokens used: ${usage.output_tokens} output`);
        if (usage.cache_creation_input_tokens) {
            console.log(`💾 Cache created: ${usage.cache_creation_input_tokens} tokens (first call)`);
        }
        if (usage.cache_read_input_tokens) {
            console.log(`⚡ Cache hit: ${usage.cache_read_input_tokens} tokens (90% faster!)`);
        }

        console.log('✅ Game generated successfully!\n');

        // Warn if response was truncated
        if (message.stop_reason === 'max_tokens') {
            console.log('⚠️  Warning: Response may be incomplete (hit token limit)\n');
            console.log('💡 Consider increasing max_tokens or simplifying the request\n');
        }

        // Cache for chat assistant context
        TheCleanCode = cleanCode;
        return cleanCode;

    } catch (error) {
        console.error('❌ Error calling Claude API:', error.message);
        throw error;
    }
}

/**
 * Interactive code assistant for modifying and debugging generated games
 * 
 * Provides conversational help for editing game code, fixing bugs, and adding features.
 * Uses the most recently generated game code as context.
 * 
 * @param {string} userMessage - User's question or request about the code
 * @param {string} gameCode - Current game code (deprecated, uses cached code)
 * @param {string} library - Game library being used (deprecated, inferred from context)
 * @returns {Promise<string>} AI assistant's response with code suggestions
 * @throws {Error} If API call fails
 * 
 * @example
 * const help = await chatWithCodeAssistant("How do I make the player jump higher?");
 */
export async function chatWithCodeAssistant(userMessage, gameCode, library) {
    try {
        console.log("\n🤖 Code Assistant request received...\n");

        // Combine assistant prompt with cached game code
        const PromptWithCode = AIchatbotPrompt + TheCleanCode;
        const startTime = performance.now();

        // Create API request with code context cached
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 7000,
            system: [
                {
                    type: "text",
                    text: PromptWithCode,
                    cache_control: { type: "ephemeral" } // Cache code context
                }
            ],
            messages: [
                {
                    role: 'user',
                    content: userMessage
                }
            ]
        });

        const endTime = performance.now();
        console.log(`⏱️  Chat response time: ${((endTime - startTime) / 1000).toFixed(2)}s`);

        // Extract response text
        let response = '';
        for (const block of message.content) {
            if (block.type === 'text') {
                response += block.text;
            }
        }

        return response.trim();

    } catch (error) {
        console.error("❌ Code Assistant Error:", error);
        throw error;
    }
}

/**
 * Generate game code with real-time streaming for progressive rendering
 * 
 * Streams code generation in real-time, allowing UI to display code as it's generated.
 * Provides better user experience for long generations.
 * 
 * @param {string} description - Natural language description of the game
 * @param {string} [library='p5js'] - Game library to use ('p5js' or 'phaser')
 * @param {Function} onChunk - Callback function called for each chunk of streamed data
 * @returns {Promise<string>} Complete clean game code
 * @throws {Error} If streaming fails
 * 
 * @example
 * await generateGameStreaming("Make pong", "p5js", (data) => {
 *   if (data.type === 'chunk') {
 *     console.log(data.text); // Display progressive output
 *   } else if (data.type === 'complete') {
 *     console.log('Done!', data.code);
 *   }
 * });
 */
export async function generateGameStreaming(description, library = 'p5js', onChunk) {
    try {
        console.log(`\n⚡ Streaming ${library.toUpperCase()} game generation...\n`);

        // Select appropriate system prompt
        const systemPrompt = library === 'phaser' ? phaserPrompt : p5jsPrompt;

        console.log(`📏 System prompt: ${systemPrompt.length} chars`);
        console.log(`📏 User message: ${description.length} chars`);

        const startTime = performance.now();

        // Create streaming API request
        const stream = await anthropic.messages.stream({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 7000,
            system: systemPrompt,
            messages: [{ role: 'user', content: description }]
        });

        let fullResponse = '';
        let chunkCount = 0;

        // Handle incoming text chunks
        stream.on('text', (textDelta, textSnapshot) => {
            fullResponse = textSnapshot;
            chunkCount++;

            // Send chunk to callback for UI update
            if (onChunk) {
                onChunk({
                    type: 'chunk',
                    text: textDelta,           // New text in this chunk
                    full: textSnapshot,         // Full text so far
                    chunkNumber: chunkCount
                });
            }

            // Log progress periodically
            if (chunkCount % 50 === 0) {
                console.log(`📝 Streamed ${chunkCount} chunks...`);
            }
        });

        // Wait for stream completion
        const finalMessage = await stream.finalMessage();

        const endTime = performance.now();
        const totalTime = ((endTime - startTime) / 1000).toFixed(2);

        // Clean markdown formatting
        const cleanCode = stripMarkdownCodeBlocks(fullResponse);

        // Log completion metrics
        console.log(`✅ Streaming complete!`);
        console.log(`⏱️  Total time: ${totalTime}s`);
        console.log(`📊 Chunks: ${chunkCount}`);
        console.log(`📊 Tokens: ${finalMessage.usage.output_tokens}`);

        // Send completion event to callback
        if (onChunk) {
            onChunk({
                type: 'complete',
                code: cleanCode,
                totalTime: totalTime,
                chunks: chunkCount,
                tokens: finalMessage.usage.output_tokens
            });
        }

        // Warn if truncated
        if (finalMessage.stop_reason === 'max_tokens') {
            console.log('⚠️  Warning: Response may be incomplete\n');
        }

        // Cache for assistant
        TheCleanCode = cleanCode;
        return cleanCode;

    } catch (error) {
        console.error('❌ Streaming error:', error.message);
        if (onChunk) {
            onChunk({ type: 'error', error: error.message });
        }
        throw error;
    }
}
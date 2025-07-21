// This is the backend API for a persistent-memory chatbot using Google Gemini AI and Vercel KV for storage.
// - Handles POST (send message), GET (load history), and DELETE (clear history) requests.
// - Stores and retrieves chat history in Vercel KV using a key based on userId and sessionId.
// - Passes full conversation history to Gemini AI for context-aware responses.
// - Supports CORS for cross-origin requests from the frontend.
// - Designed for serverless deployment on Vercel.

import { GoogleGenerativeAI } from "@google/generative-ai"; // Gemini AI SDK
import { kv } from "@vercel/kv"; // Vercel KV for persistent storage

// Main API handler for all HTTP methods
export default async function handler(req, res) {
  // --- CORS HEADERS ---
  // Allow cross-origin requests for frontend integration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // --- CORS preflight ---
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // --- GET: Retrieve conversation history ---
  if (req.method === 'GET') {
    const { sessionId, userId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'SessionId is required' });
    }

    try {
      // Use the same key format as POST for consistency
      const userKey = userId ? `user:${userId}:chat:${sessionId}` : `user:default:chat:${sessionId}`;
      const simpleKey = `chat:${sessionId}`;
      let history = await kv.get(userKey) || [];
      if (history.length === 0) {
        history = await kv.get(simpleKey) || [];
      }

      return res.status(200).json({
        success: true,
        history: history,
        sessionId: sessionId,
        userId: userId || 'default'
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve conversation history: ' + error.message
      });
    }
  }

  // --- DELETE: Clear conversation history ---
  if (req.method === 'DELETE') {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'SessionId is required' });
    }

    try {
      // Use the same key format as POST for consistency
      const userKey = `user:default:chat:${sessionId}`;
      await kv.del(userKey);
      return res.status(200).json({
        success: true,
        message: 'Conversation history cleared'
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to clear conversation history: ' + error.message
      });
    }
  }

  // --- POST: Handle chat message and update memory ---
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extract message, sessionId, and userId from request
    const { message, sessionId, userId } = req.body;
    if (!message || !sessionId) {
      return res.status(400).json({ error: 'Message and sessionId are required' });
    }

    const start = Date.now(); // For backend timing

    // --- Gemini AI Setup ---
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // --- Conversation Key ---
    // Use userId+sessionId for per-user, per-session memory
    const userKey = userId ? `user:${userId}:chat:${sessionId}` : `chat:${sessionId}`;

    // --- Retrieve history from KV ---
    let history = [];
    try {
      history = await kv.get(userKey) || [];
    } catch (error) {
      history = [];
    }

    // --- AI Chat with Context ---
    // Pass full history to Gemini for context-aware response
    const chat = model.startChat({
      history: history,
      generationConfig: {
        maxOutputTokens: 1000, // More tokens for longer context
      },
    });
    const result = await chat.sendMessage(message);
    if (!result || !result.response) {
      throw new Error('No valid response from the model');
    }

    const response = result.response;
    const botReply = response.text();

    // --- Update and Save History ---
    // Avoid repeated user/model pairs: only append if different from last
    const lastUserMsg = history.length >= 2 ? history[history.length - 2] : null;
    const lastModelMsg = history.length >= 1 ? history[history.length - 1] : null;
    const isUserRepeat = lastUserMsg && lastUserMsg.role === 'user' && lastUserMsg.parts[0].text === message;
    const isModelRepeat = lastModelMsg && lastModelMsg.role === 'model' && lastModelMsg.parts[0].text === botReply;
    if (!isUserRepeat || !isModelRepeat) {
      history.push({ role: 'user', parts: [{ text: message }] });
      history.push({ role: 'model', parts: [{ text: botReply }] });
    }

    if (history.length > 50) {
      history = history.slice(-50); // Limit to last 50 messages
    }

    try {
      await kv.set(userKey, history, { ex: 604800 }); // 7 days
    } catch (error) {
      // Continue without saving if there's an error
    }

    // --- Respond to Frontend ---
    const backendDelay = Date.now() - start;
    const region = process.env.VERCEL_REGION || 'unknown';
    return res.status(200).json({
      success: true,
      response: botReply,
      region,
      backendDelay,
      sessionId,
      messageCount: history.length
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to generate response: ' + error.message
    });
  }
}

// Import the GoogleGenerativeAI class from the @google/generative-ai package
import { GoogleGenerativeAI } from "@google/generative-ai";

// Import Vercel KV for storing chat history
import { kv } from "@vercel/kv";

// Export the default async handler function for the serverless API endpoint
export default async function handler(req, res) {
  // Set CORS headers to allow all origins and specify allowed methods and headers
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow requests from any origin
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS'); // Allow POST, GET, DELETE and OPTIONS methods
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allow Content-Type and Authorization headers
  res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours

  // Handle preflight OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    res.status(200).end(); // Respond with 200 OK for OPTIONS requests
    return;
  }

  // Handle different HTTP methods
  if (req.method === 'GET') {
    // Get conversation history
    const { sessionId, userId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'SessionId is required' });
    }
    
    try {
      console.log('Attempting to retrieve history for sessionId:', sessionId, 'userId:', userId);
      
      // Use the same key format as the POST endpoint
      const userKey = userId ? `user:${userId}:chat:${sessionId}` : `user:default:chat:${sessionId}`;
      const simpleKey = `chat:${sessionId}`;
      
      let history = await kv.get(userKey) || [];
      if (history.length === 0) {
        // Fallback to simple key
        history = await kv.get(simpleKey) || [];
      }
      
      console.log('Retrieved history:', history.length, 'messages');
      return res.status(200).json({
        success: true,
        history: history,
        sessionId: sessionId,
        userId: userId || 'default'
      });
    } catch (error) {
      console.error('Error retrieving history:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve conversation history: ' + error.message
      });
    }
  }

  if (req.method === 'DELETE') {
    // Clear conversation history
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'SessionId is required' });
    }
    
    try {
      console.log('Attempting to clear history for sessionId:', sessionId);
      // Use the same key format as the POST endpoint
      const userKey = `user:default:chat:${sessionId}`;
      await kv.del(userKey);
      console.log('Successfully cleared history for sessionId:', sessionId);
      return res.status(200).json({
        success: true,
        message: 'Conversation history cleared'
      });
    } catch (error) {
      console.error('Error clearing history:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to clear conversation history: ' + error.message
      });
    }
  }

  // Only allow POST requests for chat messages; reject others
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' }); // Respond with 405 if not POST
  }

  try {
    // Extract the message, sessionId, and userId from the request body
    const { message, sessionId, userId } = req.body;
    
    // If no message or sessionId is provided, return a 400 error
    if (!message || !sessionId) {
      return res.status(400).json({ error: 'Message and sessionId are required' });
    }

    // Record the start time to measure backend processing delay
    const start = Date.now();

    // Initialize the GoogleGenerativeAI instance with the API key from environment variables
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Get the generative model
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Create a unique key for this user's conversation
    const userKey = userId ? `user:${userId}:chat:${sessionId}` : `chat:${sessionId}`;
    
    // Test KV connection first
    try {
      await kv.set('test:connection', 'test-value', { ex: 60 });
      const testValue = await kv.get('test:connection');
      console.log('KV connection test:', testValue === 'test-value' ? 'SUCCESS' : 'FAILED');
    } catch (error) {
      console.error('KV connection test failed:', error);
    }
    
    // Retrieve existing chat history from Vercel KV (or initialize as empty array)
    let history = [];
    try {
      history = await kv.get(userKey) || [];
      console.log('Retrieved history for', userKey, ':', history.length, 'messages');
    } catch (error) {
      console.error('Error retrieving history:', error);
      history = [];
    }

    // Start a chat session with the retrieved history
    const chat = model.startChat({
      history: history,
      generationConfig: {
        maxOutputTokens: 1000, // Increased for better context
      },
    });

    // Send the new message and generate a response
    const result = await chat.sendMessage(message);

    // Add check for valid response to prevent TypeError
    if (!result || !result.response) {
      throw new Error('No valid response from the model');
    }

    const response = result.response;
    const botReply = response.text(); // This should now be safe

    // Append the new user message and bot reply to the history
    history.push({ role: 'user', parts: [{ text: message }] });
    history.push({ role: 'model', parts: [{ text: botReply }] });

    // Limit history to last 50 messages to prevent token limits and storage issues
    if (history.length > 50) {
      history = history.slice(-50);
    }

    // Save the updated history back to KV with longer TTL (7 days for persistent memory)
    try {
      await kv.set(userKey, history, { ex: 604800 }); // 7 days
      console.log('Successfully saved history for', userKey, 'with', history.length, 'messages');
    } catch (error) {
      console.error('Error saving history:', error);
      // Continue without saving if there's an error
    }

    // Calculate backend processing delay in milliseconds
    const backendDelay = Date.now() - start;

    // Get the Vercel region from environment variables, or 'unknown' if not set
    const region = process.env.VERCEL_REGION || 'unknown';

    // Return the chatbot reply, region, and backend delay in the response
    return res.status(200).json({
      success: true, // Indicate success
      response: botReply, // The chatbot's reply
      region, // The region where the function ran
      backendDelay, // Backend processing delay in ms
      sessionId: sessionId, // Return the session ID for reference
      messageCount: history.length // Return message count for debugging
    });
  } catch (error) {
    // Enhanced error handling: Log details and return a user-friendly message
    console.error('Error details:', error.message, error.stack);
    return res.status(500).json({
      success: false, // Indicate failure
      error: 'Failed to generate response: ' + error.message // Provide error details
    });
  }
}

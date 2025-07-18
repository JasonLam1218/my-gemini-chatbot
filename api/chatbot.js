// Import the GoogleGenerativeAI class from the @google/generative-ai package
import { GoogleGenerativeAI } from "@google/generative-ai";
// Import Vercel KV for storing chat history
import { kv } from "@vercel/kv";

// Export the default async handler function for the serverless API endpoint
export default async function handler(req, res) {
  // Set CORS headers to allow all origins and specify allowed methods and headers
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow requests from any origin
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); // Allow POST and OPTIONS methods
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // Allow Content-Type header

  // Handle preflight OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end(); // Respond with 200 OK for OPTIONS requests
  }

  // Only allow POST requests; reject others
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' }); // Respond with 405 if not POST
  }

  try {
    // Extract the message and sessionId from the request body
    const { message, sessionId } = req.body;

    // If no message or sessionId is provided, return a 400 error
    if (!message || !sessionId) {
      return res.status(400).json({ error: 'Message and sessionId are required' });
    }

    // Record the start time to measure backend processing delay
    const start = Date.now();

    // Initialize the GoogleGenerativeAI instance with the API key from environment variables
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Get the generative model (updated to gemini-1.5-flash for better performance; align with your original if needed)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Retrieve existing chat history from Vercel KV (or initialize as empty array)
    let history = await kv.get(`chat:${sessionId}`) || [];

    // Log the retrieved history for debugging (visible in Vercel logs)
    console.log('Retrieved history for session', sessionId, ':', history);

    // Start a chat session with the retrieved history for context-aware generation
    const chat = model.startChat({
      history: history,
      generationConfig: {
        maxOutputTokens: 500, // Limit output to manage costs and length
      },
    });

    // Send the new message and generate a response based on the history
    const result = await chat.sendMessage(message);
    const response = await result.response;
    const botReply = response.text();

    // Append the new user message and bot reply to the history
    history.push({ role: 'user', parts: [{ text: message }] });
    history.push({ role: 'model', parts: [{ text: botReply }] });

    // Save the updated history back to KV with TTL (e.g., 1 hour)
    await kv.set(`chat:${sessionId}`, history, { ex: 3600 });

    // Calculate backend processing delay in milliseconds
    const backendDelay = Date.now() - start;

    // Get the Vercel region from environment variables, or 'unknown' if not set
    const region = process.env.VERCEL_REGION || 'unknown';

    // Return the chatbot reply, region, and backend delay in the response
    return res.status(200).json({
      success: true, // Indicate success
      response: botReply, // The chatbot's reply
      region, // The region where the function ran
      backendDelay // Backend processing delay in ms
    });
  } catch (error) {
    // Handle any errors that occur during processing
    console.error(error); // Log for debugging
    return res.status(500).json({
      success: false, // Indicate failure
      error: 'Failed to generate response' // Error message
    });
  }
}

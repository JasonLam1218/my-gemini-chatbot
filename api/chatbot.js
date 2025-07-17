// Import the GoogleGenerativeAI class from the @google/generative-ai package
import { GoogleGenerativeAI } from "@google/generative-ai";

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
    // Extract the message from the request body
    const { message } = req.body;
    
    // If no message is provided, return a 400 error
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Record the start time to measure backend processing delay
    const start = Date.now();
    // Initialize the GoogleGenerativeAI instance with the API key from environment variables
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Get the generative model (Gemini 2.0 Flash Experimental)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Generate content using the model with the provided message
    const result = await model.generateContent(message);
    // Extract the response object from the result
    const response = await result.response;
    // Get the text reply from the response
    const botReply = response.text();
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
    return res.status(500).json({
      success: false, // Indicate failure
      error: 'Failed to generate response' // Error message
    });
  }
}

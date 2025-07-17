import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const start = Date.now();
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const result = await model.generateContent(message);
    const response = await result.response;
    const botReply = response.text();
    const backendDelay = Date.now() - start; 
    const region = process.env.VERCEL_REGION || 'unknown';

    return res.status(200).json({
      success: true,
      response: botReply,
      region,
      backendDelay
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to generate response'
    });
  }
}

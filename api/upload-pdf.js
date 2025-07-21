import { kv } from '@vercel/kv';
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as pdfjs from 'pdfjs-serverless';

const { getDocument } = pdfjs;

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '10mb'
  }
};

export default async function handler(req, res) {
  // --- CORS HEADERS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id, x-user-id');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Only POST requests are supported.'
    });
  }

  try {
    // Extract session/user from headers or query parameters
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    const userId = req.headers['x-user-id'] || req.query.userId;

    // Validate required parameters
    if (!sessionId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Valid session ID and user ID are required'
      });
    }

    // Read the request body chunks (binary data)
    const chunks = [];
    let totalSize = 0;
    const maxSize = 10 * 1024 * 1024; // 10MB limit

    try {
      for await (const chunk of req) {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          return res.status(413).json({
            success: false,
            error: 'File too large. Maximum size is 10MB.'
          });
        }
        chunks.push(chunk);
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Failed to read request body: ' + error.message
      });
    }

    const buffer = Buffer.concat(chunks);

    // Validate that we received data
    if (buffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No file data received'
      });
    }

    // Basic PDF validation (check PDF header)
    const pdfHeader = buffer.slice(0, 4).toString();
    if (pdfHeader !== '%PDF') {
      return res.status(400).json({
        success: false,
        error: 'Invalid PDF file format'
      });
    }

    let extractedText = '';
    let pageCount = 0;

    try {
      // Load PDF document using pdfjs-serverless (no worker issues)
      console.log('Starting PDF processing...');
      
      const pdfDoc = await getDocument({
        data: new Uint8Array(buffer)
      }).promise;

      pageCount = pdfDoc.numPages;
      console.log(`PDF loaded successfully. Page count: ${pageCount}`);

      // Limit processing to first 50 pages for performance
      const maxPages = Math.min(pageCount, 50);

      // Extract text from each page
      for (let i = 1; i <= maxPages; i++) {
        try {
          console.log(`Processing page ${i}/${maxPages}...`);
          const page = await pdfDoc.getPage(i);
          const textContent = await page.getTextContent();

          // Join text items with spaces and add page separator
          const pageText = textContent.items
            .map(item => item.str)
            .join(' ')
            .trim();

          if (pageText) {
            extractedText += pageText + '\n\n';
          }

          // Clean up page resources
          page.cleanup();
        } catch (pageError) {
          console.warn(`Error processing page ${i}:`, pageError.message);
          // Continue with other pages
        }
      }

      // Clean up document
      pdfDoc.cleanup();
      console.log('PDF processing completed successfully');

    } catch (pdfError) {
      console.error('PDF processing error:', pdfError);
      return res.status(400).json({
        success: false,
        error: 'Failed to process PDF: ' + pdfError.message
      });
    }

    // Process extracted text
    extractedText = extractedText.trim();
    if (!extractedText || extractedText.length === 0) {
      extractedText = 'No readable text found in PDF. The file may contain only images or scanned content.';
    }

    // Limit text size to prevent storage issues (max 500KB of text)
    const maxTextLength = 500000;
    if (extractedText.length > maxTextLength) {
      extractedText = extractedText.substring(0, maxTextLength) + '\n\n[Text truncated due to length...]';
    }

    // --- GENERATE AI SUMMARY ---
    let summary = '';
    try {
      console.log('Starting AI summary generation...');
      
      // Validate Gemini API key
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY environment variable is not set');
      }

      // Initialize Gemini AI
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

      // Create summarization prompt
      const summaryPrompt = `Please provide a comprehensive summary of the following PDF content. Include the main topics, key points, and important details. Keep the summary concise but informative (3-5 paragraphs maximum):

${extractedText}`;

      // Generate summary with timeout
      const result = await Promise.race([
        model.generateContent(summaryPrompt),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AI summary generation timed out')), 30000)
        )
      ]);

      const response = await result.response;
      summary = response.text();
      console.log('AI summary generated successfully');

    } catch (aiError) {
      console.error('AI summarization error:', aiError);
      summary = `Summary generation failed: ${aiError.message}. However, the full PDF text has been processed and stored successfully.`;
    }

    // Store both full text and summary in Vercel KV
    const pdfKey = `pdf:${userId}:session:${sessionId}`;
    const summaryKey = `pdf-summary:${userId}:session:${sessionId}`;
    const expirationTime = 7 * 24 * 3600; // 7 days

    try {
      console.log('Storing PDF content in KV...');
      
      // Store full text
      await kv.set(pdfKey, extractedText, { ex: expirationTime });
      
      // Store summary
      await kv.set(summaryKey, summary, { ex: expirationTime });
      
      console.log('PDF content stored successfully');

    } catch (kvError) {
      console.error('KV storage error:', kvError);
      return res.status(500).json({
        success: false,
        error: 'Failed to store PDF content: ' + kvError.message
      });
    }

    // --- UPDATE CONVERSATION HISTORY WITH SUMMARY ---
    try {
      console.log('Updating conversation history...');
      
      // Add the PDF summary to the conversation history
      const chatKey = `chat:${userId}:${sessionId}`;
      let history = await kv.get(chatKey) || [];

      // Add PDF upload and summary to conversation history
      history.push({
        role: 'user',
        parts: [{ text: 'PDF uploaded and processed' }]
      });

      history.push({
        role: 'model',
        parts: [{ text: `PDF Summary:\n\n${summary}` }]
      });

      // Limit history to last 50 messages
      if (history.length > 50) {
        history = history.slice(-50);
      }

      await kv.set(chatKey, history, { ex: expirationTime });
      console.log('Conversation history updated successfully');

    } catch (historyError) {
      console.warn('Failed to update conversation history:', historyError);
      // Continue without failing the whole request
    }

    // Successful response with summary
    return res.status(200).json({
      success: true,
      message: 'PDF processed successfully and summary generated.',
      summary: summary,
      metadata: {
        pageCount: pageCount,
        textLength: extractedText.length,
        summaryLength: summary.length,
        sessionId: sessionId,
        userId: userId,
        processedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Unexpected error in upload-pdf handler:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message
    });
  }
}

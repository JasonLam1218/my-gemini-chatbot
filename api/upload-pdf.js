// api/upload-pdf.js

import { kv } from '@vercel/kv';
import * as pdfjs from 'pdfjs-dist/build/pdf.js';
import 'pdfjs-dist/build/pdf.worker.entry';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  // Extract session/user from headers or query (adjust if using FormData fields)
  const sessionId = req.headers['x-session-id'] || req.query.sessionId || 'default';
  const userId = req.headers['x-user-id'] || req.query.userId || 'default';

  try {
    const pdfDoc = await pdfjs.getDocument({ data: buffer }).promise;
    let text = '';
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
    }

    text = text.trim() || 'No text found in PDF.';
    const key = `pdf:${userId}:session:${sessionId}`;
    await kv.set(key, text, { ex: 7 * 24 * 3600 }); // 7 days
    res.status(200).json({ success: true, message: 'PDF processed and ready for generation.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// --- Persistent user/session identity ---
// Generate a persistent user ID (stored in localStorage)
let userId = localStorage.getItem('chatbot_user_id');
if (!userId) {
  userId = 'user-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('chatbot_user_id', userId);
}

// Generate a persistent session ID for this chat session
let sessionId = localStorage.getItem('chatbot_session_id');
if (!sessionId) {
  sessionId = 'session-' + Date.now();
  localStorage.setItem('chatbot_session_id', sessionId);
}

let conversationHistory = [];

// --- UI rendering ---
// Add a message bubble to the chat display
function addMessageToDisplay(role, message) {
  const messageDiv = document.createElement('div');
  messageDiv.style.marginBottom = '10px';
  messageDiv.style.padding = '8px 12px';
  messageDiv.style.borderRadius = '8px';
  messageDiv.style.maxWidth = '80%';
  messageDiv.style.wordWrap = 'break-word';

  // User messages are right-aligned, purple; AI messages are left, gray
  if (role === 'user') {
    messageDiv.style.backgroundColor = '#6366f1';
    messageDiv.style.color = 'white';
    messageDiv.style.marginLeft = 'auto';
    messageDiv.style.textAlign = 'right';
  } else {
    messageDiv.style.backgroundColor = '#f1f5f9';
    messageDiv.style.color = '#222';
    messageDiv.style.border = '1px solid #d1d5db';
  }

  messageDiv.textContent = message;
  document.getElementById('out').appendChild(messageDiv);
  document.getElementById('out').scrollTop = document.getElementById('out').scrollHeight;
}

// --- Sending a message ---
// Handles sending user input to the backend and displaying the response
async function send() {
  const message = document.getElementById('message-input').value;
  if (!message.trim()) {
    return;
  }

  // Add user message to display
  addMessageToDisplay('user', message);

  // Clear input
  document.getElementById('message-input').value = '';

  // Show loading state
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'loading';
  loadingDiv.textContent = 'AI is thinking...';
  loadingDiv.style.color = '#666';
  loadingDiv.style.fontStyle = 'italic';
  document.getElementById('out').appendChild(loadingDiv);
  document.getElementById('out').scrollTop = document.getElementById('out').scrollHeight;

  try {
    // Use relative URL since frontend and API are on the same domain
    const apiUrl = '/api/chatbot';
    const start = Date.now(); // Record time before sending
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        sessionId: sessionId,
        userId: userId || 'default'
      }),
      mode: 'cors'
    });
    const end = Date.now(); // Record time after receiving

    // Remove loading indicator
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
      loadingElement.remove();
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (data.success) {
      addMessageToDisplay('assistant', data.response);

      // Display round-trip delay and region
      const roundTripDelay = end - start;
      const delayDiv = document.createElement('div');
      delayDiv.id = 'response-delay';
      delayDiv.textContent = `Total round-trip time: ${roundTripDelay} ms (Backend: ${data.backendDelay} ms) | Region: ${data.region}`;
      document.getElementById('out').appendChild(delayDiv);
      document.getElementById('out').scrollTop = document.getElementById('out').scrollHeight;
    } else {
      addMessageToDisplay('assistant', 'Error: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    // Remove loading indicator
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
      loadingElement.remove();
    }

    addMessageToDisplay('assistant', 'Error: ' + error.message);
    console.error('Fetch error:', error);
  }
}

// Add event listener for the button
// (defer until DOMContentLoaded to ensure elements exist)
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('send-button').addEventListener('click', send);

  // Allow pressing Enter to send
  document.getElementById('message-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      send();
    }
  });

  // Add clear button functionality
  document.getElementById('clear-button').addEventListener('click', clearConversation);

  document.getElementById('upload-pdf-button').addEventListener('click', function() {
    document.getElementById('pdf-upload').click();
  });

  document.getElementById('pdf-upload').addEventListener('change', async function(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      alert("Please upload a valid PDF file.");
      return;
    }

    addMessageToDisplay('assistant', 'Uploading and processing PDF...');

    try {
      const response = await fetch('/api/upload-pdf', {
        method: 'POST',
        headers: {
          'x-session-id': sessionId,
          'x-user-id': userId
        },
        body: file
      });

      const data = await response.json();
      if (data.success) {
        addMessageToDisplay('assistant', `PDF Summary:\n\n${data.summary}`);
      } else {
        addMessageToDisplay('assistant', 'Error processing PDF: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      addMessageToDisplay('assistant', 'Error uploading PDF: ' + error.message);
    }
  });

  loadConversationHistory();
});

// --- Conversation history loading ---
// Loads previous conversation from backend and displays it
async function loadConversationHistory() {
  try {
    const response = await fetch(`/api/chatbot?sessionId=${sessionId}&userId=${userId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      mode: 'cors'
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.history && data.history.length > 0) {
        // Clear current display
        document.getElementById('out').innerHTML = '';

        // Display conversation history
        data.history.forEach(msg => {
          if (msg.role === 'user') {
            addMessageToDisplay('user', msg.parts[0].text);
          } else if (msg.role === 'model') {
            addMessageToDisplay('assistant', msg.parts[0].text);
          }
        });

        addMessageToDisplay('assistant', 'Welcome back! I remember our previous conversation. How can I help you today?');
      } else {
        addMessageToDisplay('assistant', 'Hello! I\'m your AI assistant. How can I help you today?');
      }
    } else {
      addMessageToDisplay('assistant', 'Hello! I\'m your AI assistant. How can I help you today?');
    }
  } catch (error) {
    console.error('Error loading history:', error);
    addMessageToDisplay('assistant', 'Hello! I\'m your AI assistant. How can I help you today?');
  }
}

// --- Conversation clearing ---
// Deletes conversation memory from backend and clears UI
async function clearConversation() {
  try {
    const response = await fetch(`/api/chatbot?sessionId=${sessionId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      mode: 'cors'
    });

    if (response.ok) {
      // Clear display
      document.getElementById('out').innerHTML = '';
      addMessageToDisplay('assistant', 'Conversation cleared! How can I help you today?');
    } else {
      addMessageToDisplay('assistant', 'Error clearing conversation. Please try again.');
    }
  } catch (error) {
    console.error('Error clearing conversation:', error);
    addMessageToDisplay('assistant', 'Error clearing conversation. Please try again.');
  }
}

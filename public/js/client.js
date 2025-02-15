let editor;
let socket;
let ignoreChanges = false;
let currentDocumentId = null;
let currentLanguage = 'javascript';
let cursorMarkers = new Map(); // Store markers for remote cursors

function initializeEditor() {
  const editorElement = document.getElementById('code-editor');
  
  if (!editorElement) {
      console.error('Editor element not found');
      return;
  }
  
  if (editor) {
      console.log('Editor already initialized');
      return;
  }

  editor = CodeMirror.fromTextArea(editorElement, {
      mode: currentLanguage,
      theme: 'monokai',
      lineNumbers: true,
      autoCloseBrackets: true,
      matchBrackets: true,
      indentUnit: 2,
      tabSize: 2,
      lineWrapping: true,
      autofocus: true
  });

  // Add event listener for language selection
  const languageSelect = document.getElementById('language-select');
  if (languageSelect) {
      languageSelect.value = currentLanguage;
      languageSelect.addEventListener('change', (event) => {
          const newLanguage = event.target.value;
          changeLanguage(newLanguage);
      });
  }

  // Initialize run code button
  const runCodeBtn = document.getElementById('run-code');
  if (runCodeBtn) {
      runCodeBtn.addEventListener('click', handleCodeExecution);
  }
}

async function handleCodeExecution() {
  if (!editor) {
      console.error('Editor not initialized');
      return;
  }

  const outputElement = document.getElementById('execution-output');
  const lastExecutionElement = document.getElementById('last-execution');

  try {
      const code = editor.getValue();
      
      // Show loading state
      if (outputElement) {
          outputElement.textContent = "Running code...";
      }

      const response = await fetch('/api/run-code', {
          method: 'POST',
          headers: { 
              'Content-Type': 'application/json',
              'Accept': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ 
              code, 
              language: currentLanguage
          })
      });

      const result = await response.json();

      if (response.ok) {
          if (outputElement) {
              outputElement.textContent = result.output || 'No output';
          }
          if (lastExecutionElement) {
              lastExecutionElement.textContent = `Last Execution by: ${result.executedBy}`;
          }
      } else {
          const errorMessage = `Error: ${result.error || 'Unknown error occurred'}`;
          if (outputElement) {
              outputElement.textContent = errorMessage;
          }
      }
  } catch (error) {
      console.error("Error during code execution:", error);
      if (outputElement) {
          outputElement.textContent = `Error: ${error.message || 'Failed to execute code'}`;
      }
  }
}
// Track and share cursor position
function initializeCursorPositionSharing() {
  if (!editor || !socket) {
      console.error("Editor or Socket not initialized.");
      return;
  }

  console.log("Cursor sharing initialized using Cursor Everywhere method");

  const throttledSendCursor = throttle(sendCursorPosition, 100); // Prevents excessive updates

  editor.on("cursorActivity", () => {
      throttledSendCursor();
  });

  socket.on("cursor-position", ({ userId, username, position }) => {
      if (userId === socket.id) return; // Ignore self

      username = username.replace(/!$/, ""); // ✅ Remove trailing "!" if present
      console.log(`📥 Received cursor from ${username}: Line ${position.line}, Ch ${position.ch}`);

      updateCursorMarker(userId, position, username);
  });

  socket.on("user-disconnected", (userId) => {
      console.log(`Removing cursor for disconnected user: ${userId}`);
      removeCursorMarker(userId);
  });

  socket.on("participants-update", (participants) => {
      // Remove cursors for users no longer in the document
      const activeUserIds = participants.map((p) => p.id);
      [...cursorMarkers.keys()].forEach((userId) => {
          if (!activeUserIds.includes(userId)) {
              removeCursorMarker(userId);
          }
      });
  });
}


// **Throttle function to limit event frequency**
function throttle(func, limit) {
  let lastFunc;
  let lastRan;
  return function () {
      const context = this;
      const args = arguments;
      if (!lastRan) {
          func.apply(context, args);
          lastRan = Date.now();
      } else {
          clearTimeout(lastFunc);
          lastFunc = setTimeout(() => {
              if (Date.now() - lastRan >= limit) {
                  func.apply(context, args);
                  lastRan = Date.now();
              }
          }, limit - (Date.now() - lastRan));
      }
  };
}

function sendCursorPosition() {
  if (!socket || !currentDocumentId) return;

  const cursor = editor.getCursor();
  const coords = editor.charCoords(cursor, "local");

  let username = document.querySelector('.welcome-message')?.textContent.split(', ')[1] || "Anonymous";
  username = username.replace(/!$/, ""); // ✅ Remove trailing "!" if present

  const position = {
      line: cursor.line,
      ch: cursor.ch,
      top: coords.top,
      left: coords.left
  };

  console.log(`📤 Sending cursor: User: ${username}, Line ${cursor.line}, Ch ${cursor.ch}, X ${coords.left}, Y ${coords.top}`);

  socket.emit("cursor-position", {
      documentId: currentDocumentId,
      userId: socket.id,
      username: username, // ✅ Send corrected username
      position: position
  });
}



// **Remove cursor when a user disconnects**
function removeCursorMarker(userId) {
  const marker = cursorMarkers.get(userId);
  if (marker) {
      marker.remove();
      cursorMarkers.delete(userId);
  }
}



const userColors = new Map(); // Store colors for each user

function updateCursorMarker(userId, position, username) {
  let marker = cursorMarkers.get(userId);

  if (!marker) {
      marker = document.createElement("div");
      marker.className = "remote-cursor";
      marker.style.backgroundColor = userColors.get(userId) || getRandomColor();

      // Create username label
      const nameTag = document.createElement("div");
      nameTag.className = "cursor-username";
      nameTag.textContent = username;
      marker.appendChild(nameTag);
      editor.getWrapperElement().appendChild(marker);

      cursorMarkers.set(userId, marker);
  }

  // Get accurate cursor position
  const coords = editor.charCoords({ line: position.line, ch: position.ch }, "page");
  const cmWrapper = editor.getWrapperElement();
  const cmRect = cmWrapper.getBoundingClientRect();

  const adjustedTop = coords.top - cmRect.top;
  const adjustedLeft = coords.left - cmRect.left;

  // Apply correct positioning
  marker.style.top = `${adjustedTop}px`;
  marker.style.left = `${adjustedLeft}px`;

  // Ensure username label is updated correctly
  marker.querySelector(".cursor-username").textContent = username;

  // If cursor is in the topmost row, set a special attribute
  if (position.line === 0) {
      marker.setAttribute("data-top", "true");
  } else {
      marker.removeAttribute("data-top");
  }
}



// **Generate a random color for each user**
function getRandomColor() {
    const colors = ["#ff3333", "#33ff57", "#3357ff", "#ff33a8", "#ff8c33", "#33fff4"];
    return colors[Math.floor(Math.random() * colors.length)];
}




// Change editor language mode
function changeLanguage(language) {
  // Map of languages to CodeMirror modes
  const modeMap = {
    javascript: 'javascript',
    python: 'python',
    java: 'text/x-java',
    cpp: 'text/x-c++src',
    csharp: 'text/x-csharp',
    ruby: 'text/x-ruby',
    php: 'application/x-httpd-php',
    go: 'text/x-go',
    rust: 'text/x-rustsrc'
  };

  // Get the correct mode or default to plaintext
  const newMode = modeMap[language] || 'plaintext';
  editor.setOption('mode', newMode);
  currentLanguage = language;

  // Sync language change with other clients
  if (socket && currentDocumentId) {
    socket.emit('language-change', {
      documentId: currentDocumentId,
      language: newMode
    });
  }
}



// Initialize chat functionality
// Initialize chat functionality
function initializeChat() {
  const chatIcon = document.getElementById('chat-icon');
  const chatSection = document.getElementById('chat-section');
  const closeChatBtn = document.getElementById('close-chat');
  const chatInput = document.getElementById('chat-input');
  const chatForm = document.getElementById('chat-form');
  const chatMessages = document.getElementById('chat-messages');
  const notificationBadge = document.getElementById('chat-notification');

  let unreadMessages = 0;

  // Toggle chat section visibility
  chatIcon.addEventListener('click', () => {
    if (chatSection.classList.contains('hidden')) {
      chatSection.classList.remove('hidden');
      chatSection.style.display = 'block';
      unreadMessages = 0; // Reset unread count when chat is opened
      updateNotificationBadge();
    } else {
      chatSection.classList.add('hidden');
      chatSection.style.display = 'none';
    }
  });

  // Close chat section
  closeChatBtn.addEventListener('click', () => {
    chatSection.classList.add('hidden');
    chatSection.style.display = 'none';
  });

  // Handle form submission
  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = chatInput.value.trim();
    if (message && socket) {
      let username = document.querySelector('.welcome-message')?.textContent.split(', ')[1] || "Anonymous";
      console.log("Sending chat message:", username, message);
      socket.emit('chat-message', {
        documentId: currentDocumentId,
        username: username,
        message: message
      });
      chatInput.value = '';
    }
  });

  // Listen for incoming chat messages
  socket.on('chat-message', ({ username, message }) => {
    console.log("Received message:", username, message);
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');
    messageElement.innerHTML = `${username}: ${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Increment unread messages if chat is closed
    if (chatSection.classList.contains('hidden')) {
      unreadMessages++;
      updateNotificationBadge();
    }
  });

  // Update notification badge
  function updateNotificationBadge() {
    if (unreadMessages > 0) {
      notificationBadge.textContent = unreadMessages;
      notificationBadge.style.visibility = 'visible';
    } else {
      notificationBadge.style.visibility = 'hidden';
    }
  }
}

// Initialize Socket.io connection
function initializeSocket() {
  if (socket) {
    socket.disconnect();
  }
  socket = io({
    auth: {
      token: document.cookie
    }
  });

  socket.on('connect', async () => {
    console.log('Connected to server');
    try {
        const response = await fetch('/api/me', { credentials: 'include' });
        const userData = await response.json();
        socket.username = userData.user.username; // Set the username for the socket
        socket.emit('join-user-room', userData.user.id);
        setupDocument(userData.user.username); // Pass username to setupDocument
        initializeParticipantsList();
        initializeChat();
        initializeCursorPositionSharing();
    } catch (error) {
        console.error('Failed to join user room:', error);
    }
});


  socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    if (error.message === 'authentication failed') {
      window.location.href = '/?error=auth_required';
    }
  });

  // Document content handlers
  socket.on('document-content', ({ documentId, content, language }) => {
    console.log('Received initial content for document:', documentId);
    currentDocumentId = documentId;
    ignoreChanges = true;
    editor.setValue(content || '');
    ignoreChanges = false;
    // Set the language mode
    if (language) {
      currentLanguage = language;
      editor.setOption('mode', language);
      document.getElementById('language-select').value = language;
    }
  });

  socket.on('text-update', ({ documentId, content }) => {
    console.log('Received text change for document:', documentId);
    if (documentId === currentDocumentId && content !== editor.getValue()) {
      ignoreChanges = true;
      editor.setValue(content);
      ignoreChanges = false;
    }
  });

  socket.on('language-change', ({ documentId, language }) => {
    if (documentId === currentDocumentId) {
      currentLanguage = language;
      editor.setOption('mode', language);
      document.getElementById('language-select').value = language;
    }
  });

  socket.on('users-count', (count) => {
    document.getElementById('users-count').textContent = `Connected Users: ${count}`;
  });

  // Permission-related events
  socket.on('permission-request', ({ documentId, requesterId, requesterName }) => {
    const confirmGrant = confirm(`${requesterName} wants permission to access document ${documentId}. Grant permission?`);
    if (confirmGrant) {
      fetch('/api/grant-permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ documentId, userId: requesterId })
      }).then((response) => {
        if (response.ok) {
          alert('Permission granted successfully.');
        } else {
          alert('Failed to grant permission.');
        }
      });
    }
  });

  socket.on('permission-granted', ({ documentId }) => {
    alert(`You have been granted permission to access document ${documentId}.`);
  });

  // Setup editor change handler
  editor.on('change', (cm, change) => {
    if (!ignoreChanges && currentDocumentId) {
      const newContent = cm.getValue();
      socket.emit('text-change', {
        documentId: currentDocumentId,
        content: newContent
      });
    }
  });


  socket.on('code-execution-update', ({ output, executedBy }) => {
    const outputElement = document.getElementById('execution-output');
    const lastExecutionElement = document.getElementById('last-execution');
    
    if (outputElement) {
        outputElement.textContent = output;
    }
    if (lastExecutionElement) {
        lastExecutionElement.textContent = `Last Execution by: ${executedBy}`;
    }
});
}

// Setup the document: get documentId from URL or generate a new one, then join the document room
async function setupDocument(username) {
  const urlDocId = getDocumentIdFromURL();
  if (urlDocId) {
    currentDocumentId = urlDocId;
  } else {
    currentDocumentId = await generateDocumentId();
    const newUrl = `${window.location.pathname}?documentId=${currentDocumentId}`;
    window.history.pushState({ documentId: currentDocumentId }, '', newUrl);
  }
  console.log("Joining document:", currentDocumentId);
  socket.emit('join-document', currentDocumentId, username); // Pass username when joining document
}

// Generate document ID through server
async function generateDocumentId() {
  try {
    const response = await fetch('/api/init-document', {
      method: 'POST',
      credentials: 'include'
    });
    const data = await response.json();
    return data.documentId;
  } catch (error) {
    console.error('Failed to initialize document:', error);
    return 'doc-' + Math.random().toString(36).substring(2, 15);
  }
}

// Get document ID from URL
function getDocumentIdFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('documentId');
}

// Save document function
async function saveDocument() {
  if (!currentDocumentId) {
    alert('No document to save.');
    return;
  }
  const content = editor.getValue();
  try {
    const response = await fetch('/api/save-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        documentId: currentDocumentId,
        content,
        language: currentLanguage
      })
    });
    if (response.ok) {
      alert('Document saved successfully!');
    } else if (response.status === 403) {
      const result = await response.json();
      if (result.error.includes('permission')) {
        const confirmRequest = confirm('You need permission to save this document. Request permission?');
        if (confirmRequest) {
          await requestPermission(currentDocumentId);
        }
      } else {
        throw new Error(result.error);
      }
    } else {
      throw new Error('Failed to save document.');
    }
  } catch (error) {
    console.error('Save error:', error);
    alert('Failed to save document.');
  }
}

// Load documents function
async function loadDocuments() {
  // Check if modal already exists
  if (document.getElementById('document-modal')) return;

  try {
    const response = await fetch('/api/load-documents', {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('Failed to load documents.');
    }

    const { documents } = await response.json();
    if (documents.length === 0) {
      alert('No saved documents found.');
      return;
    }

    // Create modal container
    const modal = document.createElement('div');
    modal.id = 'document-modal';
    modal.className = 'modal-container';
    modal.innerHTML = `
      <div class="modal-content">
        <h2>Saved Documents</h2>
        <ul id="document-list"></ul>
        <button id="close-modal">Close</button>
      </div>
    `;
    document.body.appendChild(modal);

    // Add document list
    const documentList = document.getElementById('document-list');
    documents.forEach((doc) => {
      const li = document.createElement('li');
      li.textContent = `${doc.documentId} (${doc.language})`;
      li.style.cursor = 'pointer';
      li.onclick = () => loadDocument(doc.documentId);
      documentList.appendChild(li);
    });

    // Close modal logic
    document.getElementById('close-modal').addEventListener('click', () => {
      modal.remove();
    });

  } catch (error) {
    console.error('Load error:', error);
    alert('Failed to load documents.');
  }
}

// Load specific document function
async function loadDocument(documentId) {
  try {
    const response = await fetch(`/api/load-document/${documentId}`, {
      method: 'GET',
      credentials: 'include'
    });
    if (response.ok) {
      const { document } = await response.json();
      currentDocumentId = document.documentId;
      editor.setValue(document.content);
      changeLanguage(document.language);
      const newUrl = `${window.location.pathname}?documentId=${currentDocumentId}`;
      window.history.pushState({ documentId: currentDocumentId }, '', newUrl);
      socket.emit('join-document', currentDocumentId);
      alert('Document loaded successfully!');
    } else if (response.status === 403) {
      const result = await response.json();
      if (result.error.includes('permission')) {
        const confirmRequest = confirm('You need permission to load this document. Request permission?');
        if (confirmRequest) {
          await requestPermission(documentId);
        }
      } else {
        throw new Error(result.error);
      }
    } else {
      throw new Error('Failed to load document.');
    }
  } catch (error) {
    console.error('Load error:', error);
    alert('Failed to load document.');
  }
}

// Share document function
async function shareDocument() {
  if (currentDocumentId) {
    const shareableLink = `${window.location.origin}/editor.html?documentId=${currentDocumentId}`;
    try {
      await navigator.clipboard.writeText(shareableLink);
      alert('Link copied to clipboard!\nShare this link: ' + shareableLink);
    } catch (err) {
      console.error('Failed to copy link:', err);
      alert('Failed to copy link. The shareable URL is: ' + shareableLink);
    }
  } else {
    alert('No document ID available.');
  }
}

// Handle logout
async function handleLogout() {
  try {
    const response = await fetch('/api/logout', {
      method: 'POST',
      credentials: 'include'
    });
    if (response.ok) {
      if (socket) {
        socket.disconnect();
      }
      window.location.href = '/';
    } else {
      throw new Error('Logout failed');
    }
  } catch (error) {
    console.error('Logout error:', error);
    alert('Logout failed. Please try again.');
  }
}

// Check authentication and shared link validity
async function checkAuthAndShare() {
  try {
    const authResponse = await fetch('/api/me');
    if (!authResponse.ok) {
      window.location.href = '/?error=auth_required';
      return;
    }
    const userData = await authResponse.json();
    document.querySelector('.welcome-message').textContent = `Welcome, ${userData.user.username}!`;
    // Initialize socket after successful authentication
    initializeSocket();
  } catch (error) {
    console.error('Auth check failed:', error);
    window.location.href = '/?error=auth_required';
  }
}

// Request permission to save or load a document
async function requestPermission(documentId) {
  try {
    const response = await fetch('/api/request-permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ documentId })
    });
    if (response.ok) {
      alert('Permission request sent successfully. Please wait for approval.');
    } else {
      throw new Error('Failed to send permission request.');
    }
  } catch (error) {
    console.error('Permission request error:', error);
    alert('Failed to send permission request.');
  }
}

// Initialize event listeners based on page type
function initializePageEvents() {
  // Check if we're on the editor page
  const isEditorPage = window.location.pathname.includes('editor');
  
  if (isEditorPage) {
      initializeEditorEvents();
  } else {
      initializeAuthEvents();
  }
}

// Editor page specific initializations
function initializeEditorEvents() {
  initializeEditor();
  checkAuthAndShare();
  initializeRunCodeHandlers();
  initializeConsolePanel();
}

// Modified run code handlers initialization
function initializeRunCodeHandlers() {
  const runCodeButton = document.getElementById('run-code');
  const runCodeBtnAlternate = document.getElementById('run-code-btn');
  const outputElement = document.getElementById('execution-output');
  const outputPanel = document.getElementById('output-panel');
  const lastExecutionElement = document.getElementById('last-execution');

  async function handleCodeExecution() {
    if (!editor) {
        console.error('Editor not initialized');
        return;
    }

    const outputElement = document.getElementById('execution-output');
    const lastExecutionElement = document.getElementById('last-execution');

    try {
        const code = editor.getValue();
        
        // Show loading state
        if (outputElement) {
            outputElement.textContent = "Running code...";
        }

        const response = await fetch('/api/run-code', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ 
                code, 
                language: currentLanguage
            })
        });

        const result = await response.json();

        if (response.ok) {
            if (outputElement) {
                outputElement.textContent = result.output || 'No output';
            }
            if (lastExecutionElement) {
                lastExecutionElement.textContent = `Last Execution by: ${result.executedBy}`;
            }
        } else {
            const errorMessage = `Error: ${result.error || 'Unknown error occurred'}`;
            if (outputElement) {
                outputElement.textContent = errorMessage;
            }
        }
    } catch (error) {
        console.error("Error during code execution:", error);
        if (outputElement) {
            outputElement.textContent = `Error: ${error.message || 'Failed to execute code'}`;
        }
    }
}

  // Add event listeners only if elements exist
  if (runCodeButton) {
      runCodeButton.addEventListener('click', handleCodeExecution);
  }
  if (runCodeBtnAlternate) {
      runCodeBtnAlternate.addEventListener('click', handleCodeExecution);
  }
}

// Initialize everything when DOM is loaded
document.addEventListener("DOMContentLoaded", initializePageEvents);
// Initialize Console Tabs
function initializeConsolePanel() {
  const tabs = document.querySelectorAll("#console-tabs button");
  const contents = document.querySelectorAll(".console-content");

  if (!tabs.length || !contents.length) {
      console.error("Console tabs or contents not found!");
      return;
  }

  tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => {
          // Remove active class from all tabs and contents
          tabs.forEach(t => t.classList.remove("active-tab"));
          contents.forEach(c => c.classList.remove("active-content"));
          
          // Add active class to clicked tab and corresponding content
          tab.classList.add("active-tab");
          contents[index].classList.add("active-content");
      });
  });
}
// Handle Execution Logic

// Update Console Status Tab
function updateConsoleStatus(status) {
    const statusContent = document.getElementById("status-content");
    if (statusContent) {
        statusContent.textContent = `Status: ${status}`;
    }
}

// Update Console Output Tab
function updateConsoleOutput(output) {
    const outputContent = document.getElementById("output-content");
    if (outputContent) {
        outputContent.textContent = output;
    }
}
function initializeParticipantsList() {
  const participantsList = document.getElementById('participants-list');

  if (!participantsList) {
      console.error('Participants list element not found!');
      return;
  }

  // Listen for participants updates
  socket.on('participants-update', (participants) => {
      participantsList.innerHTML = ''; // Clear the existing list

      // Track unique participants to avoid duplicates
      const uniqueParticipants = new Map();

      participants.forEach((participant) => {
          const username = participant.username;
          const isCurrentUser = participant.id === socket.id;

          // Use participant ID to ensure uniqueness
          if (!uniqueParticipants.has(participant.id)) {
              uniqueParticipants.set(participant.id, {
                  username: username,
                  isCurrentUser: isCurrentUser
              });
          }
      });

      // Render the list of unique participants
      uniqueParticipants.forEach(({ username, isCurrentUser }) => {
          const listItem = document.createElement('li');
          listItem.textContent = `${username} ${isCurrentUser ? '(You)' : ''}`;
          participantsList.appendChild(listItem);
      });
  });
}



async function handleCodeExecution() {
  if (!editor) {
      console.error('Editor not initialized');
      return;
  }

  const outputElement = document.getElementById('execution-output');
  const lastExecutionElement = document.getElementById('last-execution');

  try {
      const code = editor.getValue();
      const language = document.getElementById('language-select').value;

      if (!code || !language) {
          alert('Please write code and select a language before running.');
          return;
      }

      if (outputElement) {
          outputElement.textContent = "Running code...";
      }

      const response = await fetch('/api/run-code', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ code, language }),
      });

      const result = await response.json();

      if (response.ok) {
          outputElement.textContent = result.output || 'No output';
          lastExecutionElement.textContent = `Last Execution by: ${result.executedBy || 'Unknown'}`;
      } else {
          outputElement.textContent = `Error: ${result.error || 'Unknown error occurred'}`;
      }
  } catch (error) {
      console.error('Code execution error:', error);
      if (outputElement) {
          outputElement.textContent = `Error: ${error.message || 'Failed to execute code'}`;
      }
  }
}



// Theme Management
// Theme Management
function initializeThemeManagement() {
  const themeToggle = document.getElementById('theme-toggle');
  const storedTheme = localStorage.getItem('theme') || 'light'; // Default to light

  // Apply initial theme
  document.documentElement.setAttribute('data-theme', storedTheme);
  themeToggle.checked = storedTheme === 'dark';

  // Set CodeMirror theme based on stored theme
  if (editor) {
    editor.setOption('theme', storedTheme === 'dark' ? 'monokai' : 'default');
  }

  // Handle theme toggle
  themeToggle.addEventListener('change', (e) => {
    const theme = e.target.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    // Update CodeMirror theme dynamically
    if (editor) {
      editor.setOption('theme', theme === 'dark' ? 'monokai' : 'default');
    }
  });
}



function generateColorForUsername(username) {
  const colors = ["#ff3333", "#33ff57", "#3357ff", "#ff33a8", "#ff8c33", "#33fff4", "#ffc107", "#8e24aa"];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}


// User Profile Management
function initializeUserProfile() {
  const userAvatar = document.getElementById('user-avatar');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const closeSettings = document.getElementById('close-settings');

  // Check if all required elements exist
  if (!userAvatar || !settingsBtn || !settingsPanel || !closeSettings) {
    console.error('User profile elements not found!');
    return;
  }

  // Utility to generate a unique color for a username
  function generateColorForUsername(username) {
    const colors = ["#ff3333", "#33ff57", "#3357ff", "#ff33a8", "#ff8c33", "#33fff4", "#ffc107", "#8e24aa"];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  // Fetch user data and set the initial letter and background color in the avatar
  fetch('/api/me', { credentials: 'include' })
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to fetch user data');
      }
      return response.json();
    })
    .then(data => {
      if (data.user && data.user.username) {
        const username = data.user.username;
        const userInitial = username.charAt(0).toUpperCase();
        const userColor = generateColorForUsername(username);

        userAvatar.textContent = userInitial;
        userAvatar.style.backgroundColor = userColor;
      } else {
        // Default to "A" and fallback color if username is unavailable
        userAvatar.textContent = 'A';
        userAvatar.style.backgroundColor = '#cccccc';
      }
    })
    .catch(error => {
      console.error('Error fetching user data:', error);
      // Fallback to default avatar and color
      userAvatar.textContent = 'A';
      userAvatar.style.backgroundColor = '#cccccc';
    });

  // Toggle settings panel visibility
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('visible');
  });

  closeSettings.addEventListener('click', () => {
    settingsPanel.classList.remove('visible');
  });

  // Font size preference
  const fontSizeSelect = document.getElementById('font-size-select');
  if (fontSizeSelect) {
    fontSizeSelect.addEventListener('change', (e) => {
      const fontSize = e.target.value + 'px';
      if (editor) {
        editor.getWrapperElement().style.fontSize = fontSize;
        localStorage.setItem('editorFontSize', fontSize);
      }
    });

    // Load saved font size
    const savedFontSize = localStorage.getItem('editorFontSize');
    if (savedFontSize) {
      fontSizeSelect.value = parseInt(savedFontSize);
      if (editor) {
        editor.getWrapperElement().style.fontSize = savedFontSize;
      }
    }
  }
}
function makeElementDraggable(elementId) {
  const element = document.getElementById(elementId);
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  element.addEventListener('mousedown', (event) => {
    isDragging = true;

    // Calculate initial offsets
    offsetX = event.clientX - element.getBoundingClientRect().left;
    offsetY = event.clientY - element.getBoundingClientRect().top;

    element.style.cursor = "grabbing"; // Visual feedback
    event.preventDefault(); // Prevent unwanted selection
  });

  document.addEventListener('mousemove', (event) => {
    if (!isDragging) return;

    // Calculate the new position
    const x = event.clientX - offsetX;
    const y = event.clientY - offsetY;

    // Constrain the element within the viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const elementWidth = element.offsetWidth;
    const elementHeight = element.offsetHeight;

    const constrainedX = Math.max(0, Math.min(x, viewportWidth - elementWidth));
    const constrainedY = Math.max(0, Math.min(y, viewportHeight - elementHeight));

    // Update the position
    element.style.left = `${constrainedX}px`;
    element.style.top = `${constrainedY}px`;
    element.style.position = "absolute";
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    element.style.cursor = "grab"; // Revert cursor style
  });
}


// Initialize everything
document.addEventListener("DOMContentLoaded", () => {
  // Initialize core components
  initializeThemeManagement();
  initializeUserProfile();
  initializeEditor();
  makeElementDraggable('participants-panel');
  initializeConsolePanel();
  initializeParticipantsList();
  
   // Ensure this is called after DOM is fully loaded
   document.getElementById('get-started').addEventListener('click', () => {
    window.location.href = '/welcome';
});
document.getElementById('login').addEventListener('click', () => {
    window.location.href = '/welcome';
});
document.getElementById('signup').addEventListener('click', () => {
    window.location.href = '/welcome';
});

    // Only run auth check if we're not in an error state
    if (!window.location.search.includes('error=auth_required')) {
        checkAuthStatus();
    } else {
        // Clear redirect count if we're in an error state
        localStorage.removeItem('redirectCount');
    }

    
});



// Check if we're in a redirect loop
let redirectCount = parseInt(localStorage.getItem('redirectCount') || '0');
if (redirectCount > 2) {
    // Clear any potentially corrupted auth state
    document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    localStorage.removeItem('redirectCount');
} else {
    localStorage.setItem('redirectCount', (redirectCount + 1).toString());
}

// Handle login form submission
document.getElementById('loginForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');

  try {
      const response = await fetch('/api/login', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email, password }),
          credentials: 'include'
      });

      const data = await response.json();

      if (!response.ok) {
          throw new Error(data.error || 'Login failed');
      }

      // Clear redirect count and any error parameters
      localStorage.removeItem('redirectCount');
      
      // Show success message before redirecting
      const successDiv = document.createElement('div');
      successDiv.className = 'success';
      successDiv.textContent = 'Login successful! Redirecting...';
      errorDiv.parentNode.insertBefore(successDiv, errorDiv);

      // Redirect after a short delay
      setTimeout(() => {
          window.location.href = '/editor.html';
      }, 1500);

  } catch (error) {
      errorDiv.textContent = error.message;
      // Clear redirect count on error
      localStorage.removeItem('redirectCount');
  }
});

// Handle registration form submission
document.getElementById('registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const errorDiv = document.getElementById('register-error');

    // Clear any previous error messages
    errorDiv.textContent = '';

    console.log('Attempting registration with:', { username, email, password: '****' });

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ username, email, password }),
            credentials: 'include' // This is important for cookies
        });

        console.log('Registration response status:', response.status);
        
        const data = await response.json();
        console.log('Registration response data:', data);

        if (!response.ok) {
            throw new Error(data.error || 'Registration failed');
        }

        // Clear redirect count on successful registration
        localStorage.removeItem('redirectCount');

        // Show success message before redirecting
        const successDiv = document.createElement('div');
        successDiv.className = 'success';
        successDiv.textContent = 'Registration successful! Redirecting to editor...';
        errorDiv.parentNode.insertBefore(successDiv, errorDiv);

        // Since the server is setting a cookie, we can redirect to editor
        setTimeout(() => {
            window.location.href = '/editor.html';
        }, 1500);

    } catch (error) {
        console.error('Registration error:', error);
        errorDiv.textContent = error.message || 'Registration failed. Please try again.';
    }
});

// Toggle between login and registration forms
function toggleForms() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const registerError = document.getElementById('register-error');
    const loginError = document.getElementById('login-error');

    // Clear error messages when switching forms
    registerError.textContent = '';
    loginError.textContent = '';

    if (loginForm.style.display === 'none') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
    }
}

// Check authentication status
async function checkAuthStatus() {
  // Avoid redirection logic on the login page (welcome.html)
  if (window.location.pathname === '/welcome.html') {
      return; // Skip any redirection on the login page
  }

  try {
      const response = await fetch('/api/auth-status');
      const data = await response.json();
      
      if (data.authenticated) {
          // Redirect to editor only if authenticated and not already there
          if (window.location.pathname !== '/editor.html') {
              window.location.href = '/editor.html';
          }
      } else {
          // Redirect to welcome.html (login) only if not authenticated and not already there
          if (window.location.pathname !== '/welcome.html') {
              window.location.href = '/welcome.html';
          }
      }
  } catch (error) {
      console.error('Auth status check failed:', error);
      // Optional: handle errors here, e.g., show an error message
      localStorage.removeItem('redirectCount');
  }
}
// Check auth status only if we're not in a potential redirect loop
if (redirectCount <= 2) {
    checkAuthStatus();
}
// Function to initialize code execution
function initializeCodeExecution() {
    const runCodeButton = document.getElementById("run-code");
    const outputPanel = document.getElementById("output-panel");
    const statusLabel = document.getElementById("execution-status");
    const lastExecutedBy = document.getElementById("last-executed-by");

    if (!runCodeButton) {
        console.error("Run Code button not found!");
        return;
    }

    // Add event listener to the "Run Code" button
    runCodeButton.addEventListener("click", async () => {
        const code = editor.getValue(); // Get the code from the editor
        const language = document.getElementById("language-select").value; // Get selected language
        let username = document.querySelector('.welcome-message')?.textContent.split(', ')[1] || "Anonymous";

        // Ensure we don't send the trailing "!" if present
        username = username.replace(/!$/, "");

        if (!code) {
            alert("Please write some code before running!");
            return;
        }

        // Update UI before sending the request
        statusLabel.textContent = "Running...";
        outputPanel.textContent = "";

        try {
            // Send the code and language to the server for execution
            const response = await fetch("/api/run-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, language, username })
            });

            const result = await response.json();

            if (response.ok) {
                // Update the UI with the result
                statusLabel.textContent = "Execution Successful";
                outputPanel.textContent = result.output || "No output returned.";
                lastExecutedBy.textContent = `Last Execution by: ${result.username || "Unknown"}`;
            } else {
                throw new Error(result.error || "Failed to execute code.");
            }
        } catch (error) {
            // Handle errors during execution
            console.error("Execution error:", error);
            statusLabel.textContent = "Execution Failed";
            outputPanel.textContent = error.message || "An error occurred while running the code.";
            lastExecutedBy.textContent = `Last Execution by: ${username}`;
        }
    });
}


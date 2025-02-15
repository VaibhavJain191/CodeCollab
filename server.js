const express = require('express');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));


const mongoose = require('mongoose');
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI, {
    retryWrites: true,
    w: 'majority'
})
.then(() => console.log('Connected to MongoDB Atlas'))
.catch((error) => console.error('MongoDB connection error:', error));

// User Model
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  savedDocuments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Document Model
const documentSchema = new mongoose.Schema({
  documentId: { type: String, required: true, unique: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, default: '' },
  language: { type: String, default: 'javascript' },
  permissions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now }
});

const Document = mongoose.model('Document', documentSchema);

// Authentication Middleware
const auth = async (req, res, next) => {
  try {
    const token = req.cookies.token; // Assuming token is stored in cookies
    if (!token) {
      throw new Error('Authentication required');
    }
    const decoded = jwt.verify(token, 'your-jwt-secret');
    const user = await User.findById(decoded.userId);
    if (!user) {
      throw new Error('User not found');
    }
    req.user = user; // Attach user object to req
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};




// Route to handle code execution
const axios = require('axios');

app.post('/api/run-code', auth, async (req, res) => {
    const { code, language } = req.body;

    if (!code || !language) {
        return res.status(400).json({ error: 'Code and language are required.' });
    }

    try {
        const jdoodleLanguages = {
            javascript: 'nodejs',
            python: 'python3',
            java: 'java',
            cpp: 'cpp17',
            csharp: 'csharp',
            ruby: 'ruby',
            php: 'php',
            go: 'go',
            rust: 'rust'  
        };

        const jdoodleLanguage = jdoodleLanguages[language.toLowerCase()];
        if (!jdoodleLanguage) {
            return res.status(400).json({ error: 'Unsupported language.' });
        }

        // API credentials (replace these with your own from Jdoodle)
        const clientId = process.env.CLIENT_ID;
        const clientSecret = process.env.CLIENT_SECRET;
        

        const response = await axios.post('https://api.jdoodle.com/v1/execute', {
            script: code,
            language: jdoodleLanguage,
            versionIndex: '0', // Use 0 for default version
            clientId: clientId,
            clientSecret: clientSecret
        });

        const output = response.data.output || 'No output';
        res.json({ output, executedBy: req.user?.username || 'Anonymous' });
    } catch (error) {
        console.error('Code execution error:', error.message || error);
        res.status(500).json({
            error: 'Code execution failed',
            details: error.response?.data || error.message,
        });
    }
});




// Routes
app.get('/', (req, res) => {
  console.log('Root route accessed');
  const token = req.cookies.token;
  if (token) {
      try {
          jwt.verify(token, 'your-jwt-secret');
          console.log('Valid token found, redirecting to editor');
          return res.redirect('/editor.html');
      } catch (error) {
          console.log('Invalid token, redirecting to welcome');
      }
  }
  console.log('No token found, serving welcome page');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/welcome.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'welcome.html'));
});


app.get('/editor.html', auth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editor.html'));
});

app.get('/api/auth-status', (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.json({ authenticated: false });
  }
  try {
    jwt.verify(token, 'your-jwt-secret');
    res.json({ authenticated: true });
  } catch (error) {
    res.json({ authenticated: false });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email or username already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();
    const token = jwt.sign({ userId: user._id }, 'your-jwt-secret', { expiresIn: '24h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    res.status(201).json({
      message: 'User registered successfully',
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user._id }, 'your-jwt-secret', { expiresIn: '24h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    res.json({
      message: 'Logged in successfully',
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/logout', auth, (req, res) => {
  res.cookie('token', '', {
    httpOnly: true,
    expires: new Date(0)
  });
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/me', auth, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email
    }
  });
});
// Initialize document and set ownership
app.post('/api/init-document', auth, async (req, res) => {
  try {
    const documentId = 'doc-' + Math.random().toString(36).substring(2, 15);
    const doc = new Document({
      documentId,
      ownerId: req.user._id,
      content: '',
      language: 'javascript'
    });
    await doc.save();
    res.json({ documentId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save Document Route
app.post('/api/save-document', auth, async (req, res) => {
  try {
    const { documentId, content, language } = req.body;
    if (!documentId || !content || !language) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    let doc = await Document.findOne({ documentId });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found. Owner must initialize the document first.' });
    }

    if (doc.ownerId.toString() !== req.user._id.toString() && !doc.permissions.includes(req.user._id)) {
      return res.status(403).json({ error: 'You do not have permission to save this document' });
    }

    doc.content = content;
    doc.language = language;

    if (!req.user.savedDocuments.includes(doc._id)) {
      req.user.savedDocuments.push(doc._id);
      await req.user.save();
    }

    await doc.save();
    res.json({ message: 'Document saved successfully', document: doc });
  } catch (error) {
    console.error('Error saving document:', error);
    res.status(500).json({ error: error.message });
  }
});

// Load Documents Route
app.get('/api/load-documents', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('savedDocuments');
    console.log('Loaded user:', user);
    console.log('Saved documents:', user.savedDocuments);
    res.json({ documents: user.savedDocuments });
  } catch (error) {
    console.error('Error loading documents:', error);
    res.status(500).json({ error: error.message });
  }
});

// Load Specific Document Route
app.get('/api/load-document/:documentId', auth, async (req, res) => {
  try {
    const { documentId } = req.params;
    const doc = await Document.findOne({ documentId });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    if (doc.ownerId.toString() !== req.user._id.toString() && !doc.permissions.includes(req.user._id)) {
      return res.status(403).json({ error: 'You do not have permission to load this document' });
    }
    res.json({ document: doc });
  } catch (error) {
    console.error('Error loading document:', error);
    res.status(500).json({ error: error.message });
  }
});

// Request Permission Route
app.post('/api/request-permission', auth, async (req, res) => {
  try {
    const { documentId } = req.body;
    if (!documentId) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    const doc = await Document.findOne({ documentId });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const ownerId = doc.ownerId;
    const requesterId = req.user._id;

    io.to(ownerId.toString()).emit('permission-request', {
      documentId,
      requesterId: requesterId.toString(),
      requesterName: req.user.username
    });

    res.json({ message: 'Permission request sent successfully' });
  } catch (error) {
    console.error('Error requesting permission:', error);
    res.status(500).json({ error: error.message });
  }
});

// Grant Permission Route
app.post('/api/grant-permission', auth, async (req, res) => {
  try {
    const { documentId, userId } = req.body;
    if (!documentId || !userId) {
      return res.status(400).json({ error: 'Document ID and User ID are required' });
    }

    const doc = await Document.findOne({ documentId });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (doc.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the owner can grant permission' });
    }

    if (!doc.permissions.includes(userId)) {
      doc.permissions.push(userId);
      await doc.save();
    }

    io.to(userId).emit('permission-granted', { documentId });

    res.json({ message: 'Permission granted successfully' });
  } catch (error) {
    console.error('Error granting permission:', error);
    res.status(500).json({ error: error.message });
  }
});






// Socket.io Handling
const documents = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-user-room', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined their room`);
  });

  // Modified join-document handler
  socket.on('join-document', async (documentId, username) => {
    console.log(`Socket ${socket.id} joining document:`, documentId);
    if (socket.currentDocument) {
        socket.leave(socket.currentDocument);
    }
    socket.currentDocument = documentId;
    socket.join(documentId);

    if (!documents.has(documentId)) {
        documents.set(documentId, { content: '', language: 'javascript', participants: new Map() });
    }

    // Add the user to the participants list with their actual username
    const userData = { id: socket.id, username: username || 'Anonymous' };
    documents.get(documentId).participants.set(socket.id, userData);

    // Broadcast updated participants to the document room
    const participants = Array.from(documents.get(documentId).participants.values());
    io.to(documentId).emit('participants-update', participants);

    const { content, language } = documents.get(documentId);
    socket.emit('document-content', { documentId, content, language });

    const room = io.sockets.adapter.rooms.get(documentId);
    const userCount = room ? room.size : 0;
    io.to(documentId).emit('users-count', userCount);
});


  socket.on('text-change', ({ documentId, content }) => {
    if (!documentId || !documents.has(documentId)) return;
    documents.get(documentId).content = content;
    socket.to(documentId).emit('text-update', { documentId, content, userId: socket.id });
  });

  socket.on('language-change', ({ documentId, language }) => {
    if (!documentId || !documents.has(documentId)) return;
    documents.get(documentId).language = language;
    socket.to(documentId).emit('language-change', { documentId, language });
  });

// Add this to your existing socket.io connection handler in server.js
socket.on('disconnect', () => {
  console.log('User disconnected:', socket.id);
  if (socket.currentDocument) {
      const doc = documents.get(socket.currentDocument);
      if (doc) {
          doc.participants.delete(socket.id);
          const participants = Array.from(doc.participants.values());
          io.to(socket.currentDocument).emit('participants-update', participants);
      }

      const room = io.sockets.adapter.rooms.get(socket.currentDocument);
      const userCount = room ? room.size : 0;
      io.to(socket.currentDocument).emit('users-count', userCount);
  }
});


socket.on('code-execution-result', ({ documentId, output, executedBy }) => {
  // Broadcast the execution result to all users in the document
  io.to(documentId).emit('code-execution-update', {
    output,
    executedBy
  });
});

socket.on("cursor-position", ({ documentId, userId, username, position }) => {
  username = username.replace(/!$/, ""); // ✅ Remove trailing "!" if present

  console.log(`📡 Broadcasting cursor move from ${username} in document ${documentId}: Line ${position.line}, Ch ${position.ch}`);

  socket.to(documentId).emit("cursor-position", {
      userId,
      username,
      position
  });
});

socket.on("chat-message", ({ documentId, username, message }) => {
  username = username.replace(/!$/, ""); // ✅ Remove trailing "!" if present

  console.log(`📡 Broadcasting chat message from ${username}: ${message}`);

  // ✅ Send message to everyone, including the sender
  io.to(documentId).emit("chat-message", { username, message });
});


});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
app.use((req, res, next) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "https://livestream-lhip.onrender.com",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "https://livestream-lhip.onrender.com",
  credentials: true
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/livestream', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Stream state - Modified to handle multiple admins
let streamState = {
  isLive: false,
  activeStreams: new Map(), // Map of adminSocketId -> stream info
  viewerCount: 0,
  startTime: null,
  currentAdminSocketId: null // Currently active admin
};

// Connected users
let connectedUsers = new Map();

// JWT middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, adminKey } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Check if admin key is provided for admin registration
    const isAdmin = adminKey === (process.env.ADMIN_KEY || 'admin123');
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new User({
      username,
      password: hashedPassword,
      isAdmin
    });
    
    await user.save();
    
    const token = jwt.sign(
      { userId: user._id, username: user.username, isAdmin: user.isAdmin },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({ 
      token, 
      user: { 
        username: user.username, 
        isAdmin: user.isAdmin,
        id: user._id 
      } 
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user._id, username: user.username, isAdmin: user.isAdmin },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({ 
      token, 
      user: { 
        username: user.username, 
        isAdmin: user.isAdmin,
        id: user._id 
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stream-status', (req, res) => {
  res.json({
    isLive: streamState.isLive,
    viewerCount: streamState.viewerCount,
    startTime: streamState.startTime,
    activeStreams: streamState.activeStreams.size
  });
});

app.get('/api/protected', authenticateToken, (req, res) => {
  res.json({ message: 'Protected route accessed', user: req.user });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Store user info
  socket.on('user-info', (data) => {
    connectedUsers.set(socket.id, {
      username: data.username,
      isAdmin: data.isAdmin,
      joinTime: new Date()
    });
    
    console.log(`User ${data.username} (${data.isAdmin ? 'Admin' : 'Viewer'}) connected with socket ID: ${socket.id}`);
    
    // Send current stream status immediately
    socket.emit('stream-status', {
      isLive: streamState.isLive,
      viewerCount: streamState.viewerCount,
      startTime: streamState.startTime,
      currentAdminSocketId: streamState.currentAdminSocketId
    });
  });

  // Admin starts stream
  socket.on('start-stream', (data) => {
    const user = connectedUsers.get(socket.id);
    if (user && user.isAdmin) {
      console.log(`Admin ${user.username} starting stream...`);
      
      // Check if this admin is already streaming
      if (streamState.activeStreams.has(socket.id)) {
        socket.emit('stream-error', { message: 'You are already streaming' });
        return;
      }

      // Set up stream state
      streamState.isLive = true;
      streamState.currentAdminSocketId = socket.id;
      streamState.startTime = new Date();
      
      // Add this admin to active streams
      streamState.activeStreams.set(socket.id, {
        adminUsername: user.username,
        startTime: new Date(),
        isPrimary: true
      });
      
      // Notify all users that stream started
      io.emit('stream-started', {
        message: 'Live stream started',
        startTime: streamState.startTime,
        adminUsername: user.username,
        adminSocketId: socket.id
      });
      
      // Send updated stream status to all
      io.emit('stream-status', {
        isLive: streamState.isLive,
        viewerCount: streamState.viewerCount,
        startTime: streamState.startTime,
        currentAdminSocketId: streamState.currentAdminSocketId
      });
      
      console.log(`✅ Stream started by admin: ${user.username} (${socket.id})`);
    } else {
      socket.emit('stream-error', { message: 'Only admins can start streams' });
    }
  });

  // Admin stops stream
  socket.on('stop-stream', () => {
    const user = connectedUsers.get(socket.id);
    if (user && user.isAdmin && streamState.activeStreams.has(socket.id)) {
      
      // Remove this admin from active streams
      streamState.activeStreams.delete(socket.id);
      
      // If this was the primary stream
      if (streamState.currentAdminSocketId === socket.id) {
        if (streamState.activeStreams.size > 0) {
          // Switch to another admin's stream
          const nextAdmin = streamState.activeStreams.keys().next().value;
          streamState.currentAdminSocketId = nextAdmin;
          
          // Notify about stream transition
          io.emit('stream-transition', {
            message: 'Stream switched to another admin',
            newAdminSocketId: nextAdmin
          });
        } else {
          // No more active streams
          streamState.isLive = false;
          streamState.currentAdminSocketId = null;
          streamState.viewerCount = 0;
          streamState.startTime = null;
          
          // Notify all users that stream ended
          io.emit('stream-ended', {
            message: 'Live stream ended'
          });
          
          // Send updated stream status
          io.emit('stream-status', {
            isLive: false,
            viewerCount: 0,
            startTime: null,
            currentAdminSocketId: null
          });
        }
      }
      
      console.log(`Stream stopped by admin: ${user.username} (${socket.id})`);
    }
  });

  // Viewer joins stream
  socket.on('join-stream', () => {
    const user = connectedUsers.get(socket.id);
    console.log(`join-stream event from ${user?.username} (${socket.id}), isAdmin: ${user?.isAdmin}, streamLive: ${streamState.isLive}`);
    
    if (user && !user.isAdmin && streamState.isLive) {
      streamState.viewerCount++;
      
      console.log(`✅ Viewer ${user.username} joined stream, total viewers: ${streamState.viewerCount}`);
      
      // Notify current admin about new viewer
      if (streamState.currentAdminSocketId) {
        io.to(streamState.currentAdminSocketId).emit('viewer-joined', {
          viewerCount: streamState.viewerCount,
          viewerSocketId: socket.id,
          viewerUsername: user.username
        });
        
        console.log(`Notified admin ${streamState.currentAdminSocketId} about viewer ${user.username}`);
      }
      
      // Update viewer count for all
      io.emit('viewer-count-update', { viewerCount: streamState.viewerCount });
      
      // Send confirmation to the viewer
      socket.emit('viewer-joined-confirmed', {
        message: 'Successfully joined stream',
        viewerCount: streamState.viewerCount
      });
    } else {
      console.log(`❌ Viewer join failed - isAdmin: ${user?.isAdmin}, streamLive: ${streamState.isLive}`);
      socket.emit('stream-error', { 
        message: streamState.isLive ? 'Failed to join stream' : 'No live stream available' 
      });
    }
  });

  // Handle viewer ready signal
  socket.on('viewer-ready', (data) => {
    const user = connectedUsers.get(socket.id);
    console.log(`viewer-ready event from ${user?.username} (${socket.id})`);
    
    if (user && !user.isAdmin && streamState.isLive && streamState.currentAdminSocketId) {
      // Notify admin that viewer is ready for WebRTC connection
      io.to(streamState.currentAdminSocketId).emit('viewer-ready', {
        viewerSocketId: socket.id,
        viewerUsername: user.username
      });
      
      console.log(`Notified admin about viewer ready: ${user.username}`);
    }
  });

  // Viewer leaves stream
  socket.on('leave-stream', () => {
    const user = connectedUsers.get(socket.id);
    if (user && !user.isAdmin && streamState.isLive) {
      streamState.viewerCount = Math.max(0, streamState.viewerCount - 1);
      
      console.log(`Viewer ${user.username} left stream, remaining viewers: ${streamState.viewerCount}`);
      
      // Notify admin about viewer leaving
      if (streamState.currentAdminSocketId) {
        io.to(streamState.currentAdminSocketId).emit('viewer-left', {
          viewerCount: streamState.viewerCount,
          viewerSocketId: socket.id,
          viewerUsername: user.username
        });
      }
      
      // Update viewer count for all
      io.emit('viewer-count-update', { viewerCount: streamState.viewerCount });
    }
  });

  // Get stream status
  socket.on('get-stream-status', () => {
    const status = {
      isLive: streamState.isLive,
      viewerCount: streamState.viewerCount,
      startTime: streamState.startTime,
      currentAdminSocketId: streamState.currentAdminSocketId
    };
    
    console.log(`Stream status requested by ${socket.id}:`, status);
    socket.emit('stream-status', status);
  });

  // WebRTC signaling
  socket.on('webrtc-signal', (data) => {
    console.log(`🔄 WebRTC signal: ${data.type} from ${socket.id} to ${data.to}`);
    
    // Forward signaling data between admin and viewers
    if (data.to) {
      io.to(data.to).emit('webrtc-signal', {
        signal: data.signal,
        from: socket.id,
        type: data.type
      });
      
      console.log(`✅ Forwarded ${data.type} signal from ${socket.id} to ${data.to}`);
    } else {
      console.log(`❌ No recipient specified for WebRTC signal`);
    }
  });

  // Chat message
  socket.on('chat-message', (data) => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      const message = {
        id: Date.now(),
        username: user.username,
        message: data.message,
        timestamp: new Date(),
        isAdmin: user.isAdmin,
        socketId: socket.id
      };
      
      // Broadcast to all connected users
      io.emit('chat-message', message);
      console.log(`💬 Chat message from ${user.username}: ${data.message}`);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    const user = connectedUsers.get(socket.id);
    if (user) {
      console.log(`User ${user.username} (${user.isAdmin ? 'Admin' : 'Viewer'}) disconnected`);
      
      // If admin disconnects and was streaming
      if (user.isAdmin && streamState.activeStreams.has(socket.id)) {
        streamState.activeStreams.delete(socket.id);
        
        // If this was the primary stream
        if (streamState.currentAdminSocketId === socket.id) {
          if (streamState.activeStreams.size > 0) {
            // Switch to another admin's stream
            const nextAdmin = streamState.activeStreams.keys().next().value;
            streamState.currentAdminSocketId = nextAdmin;
            
            io.emit('stream-transition', {
              message: 'Stream switched due to admin disconnect',
              newAdminSocketId: nextAdmin
            });
          } else {
            // No more active streams
            streamState.isLive = false;
            streamState.currentAdminSocketId = null;
            streamState.viewerCount = 0;
            streamState.startTime = null;
            
            io.emit('stream-ended', {
              message: 'Stream ended - Admin disconnected'
            });
            
            io.emit('stream-status', {
              isLive: false,
              viewerCount: 0,
              startTime: null,
              currentAdminSocketId: null
            });
          }
        }
      } else if (!user.isAdmin && streamState.isLive) {
        // If viewer disconnects, update count
        streamState.viewerCount = Math.max(0, streamState.viewerCount - 1);
        
        // Notify admin about viewer leaving
        if (streamState.currentAdminSocketId) {
          io.to(streamState.currentAdminSocketId).emit('viewer-left', {
            viewerCount: streamState.viewerCount,
            viewerSocketId: socket.id,
            viewerUsername: user.username
          });
        }
        
        io.emit('viewer-count-update', { viewerCount: streamState.viewerCount });
      }
    }
    
    connectedUsers.delete(socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔑 Admin key: ${process.env.ADMIN_KEY || 'admin123'}`);
});
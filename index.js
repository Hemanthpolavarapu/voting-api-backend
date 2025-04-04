const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
});

// In-memory storage for polls (in a real app, use a database)
const polls = {};

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json());

// Routes

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running', timestamp: new Date().toISOString() });
});

// Get all polls
app.get('/api/polls', (req, res) => {
  res.json(Object.values(polls));
});

// Get a specific poll
app.get('/api/polls/:id', (req, res) => {
  const poll = polls[req.params.id];
  if (!poll) {
    return res.status(404).json({ error: 'Poll not found' });
  }
  res.json(poll);
});

// Create a new poll
app.post('/api/polls', (req, res) => {
  const { question, options, createdBy } = req.body;
  
  // Validate request
  if (!question || !options || options.length < 2) {
    return res.status(400).json({ error: 'Invalid poll data' });
  }
  
  // Generate unique poll ID
  const pollId = 'poll-' + Math.random().toString(36).substr(2, 9);
  
  // Create poll object
  const poll = {
    id: pollId,
    question,
    options: options.map((text, index) => ({
      id: `option-${index + 1}`,
      text
    })),
    results: options.map((text, index) => ({
      id: `option-${index + 1}`,
      text,
      votes: 0
    })),
    createdBy,
    createdAt: new Date().toISOString()
  };
  
  // Save poll
  polls[pollId] = poll;
  
  // Notify all clients about new poll
  io.emit('pollCreated', poll);
  
  res.status(201).json(poll);
});

// Submit a vote
app.post('/api/polls/:id/vote', (req, res) => {
  const { optionId, username } = req.body;
  const pollId = req.params.id;
  
  // Validate request
  if (!optionId || !username) {
    return res.status(400).json({ error: 'Invalid vote data' });
  }
  
  const poll = polls[pollId];
  if (!poll) {
    return res.status(404).json({ error: 'Poll not found' });
  }
  
  // Update vote count
  const updatedResults = poll.results.map(option => {
    if (option.id === optionId) {
      return {
        ...option,
        votes: option.votes + 1
      };
    }
    return option;
  });
  
  // Update poll
  polls[pollId] = {
    ...poll,
    results: updatedResults
  };
  
  // Notify all clients about updated results
  io.to(pollId).emit('resultsUpdated', {
    pollId,
    results: updatedResults
  });
  
  res.json({ 
    success: true, 
    pollId,
    optionId,
    results: updatedResults
  });
});

// Get poll results
app.get('/api/polls/:id/results', (req, res) => {
  const pollId = req.params.id;
  const poll = polls[pollId];
  
  if (!poll) {
    return res.status(404).json({ error: 'Poll not found' });
  }
  
  res.json(poll.results);
});

// Socket.IO handling
io.on('connection', (socket) => {
  console.log('New client connected');
  
  // Join a poll room for real-time updates
  socket.on('joinPoll', (pollId) => {
    socket.join(pollId);
    console.log(`Client joined poll: ${pollId}`);
  });
  
  // Leave a poll
  socket.on('leavePoll', (pollId) => {
    socket.leave(pollId);
    console.log(`Client left poll: ${pollId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
});

module.exports = { app, server }; 
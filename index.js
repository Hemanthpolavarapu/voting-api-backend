const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Set up SQLite database
const db = new sqlite3.Database('./polls.db');

// Create tables if they don't exist
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Polls table
  db.run(`
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  
  // Options table
  db.run(`
    CREATE TABLE IF NOT EXISTS options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      text TEXT NOT NULL,
      FOREIGN KEY (poll_id) REFERENCES polls(id)
    )
  `);
  
  // Votes table
  db.run(`
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      username TEXT NOT NULL,
      voted_at TEXT NOT NULL,
      FOREIGN KEY (poll_id) REFERENCES polls(id),
      FOREIGN KEY (option_id) REFERENCES options(id)
    )
  `);
});

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json());

// Modified authentication middleware to provide backward compatibility
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    // For backward compatibility, allow non-authenticated requests
    // but set user to null to indicate no authentication
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      // For backward compatibility, don't return error for invalid tokens
      // just set user to null
      req.user = null;
      return next();
    }
    req.user = user;
    next();
  });
};

// Routes

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running', timestamp: new Date().toISOString() });
});

// Register a new user
app.post('/api/users/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  // Validate request
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  try {
    // Check if user already exists
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (user) {
        return res.status(400).json({ error: 'Username already exists' });
      }
      
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const createdAt = new Date().toISOString();
      
      // Insert new user
      db.run(
        'INSERT INTO users (username, email, password, created_at) VALUES (?, ?, ?, ?)',
        [username, email || null, hashedPassword, createdAt],
        function(err) {
          if (err) {
            console.error("Error creating user:", err);
            return res.status(500).json({ error: 'Failed to create user' });
          }
          
          // Generate JWT token
          const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET, { expiresIn: '7d' });
          
          res.status(201).json({
            message: 'User registered successfully',
            token,
            username
          });
        }
      );
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
app.post('/api/users/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Validate request
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  try {
    // Find user
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Compare passwords
      const isMatch = await bcrypt.compare(password, user.password);
      
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Generate JWT token
      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      
      res.json({
        message: 'Login successful',
        token,
        username: user.username
      });
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get user profile
app.get('/api/users/profile', authenticateToken, (req, res) => {
  const { id } = req.user;
  
  db.get('SELECT id, username, email, created_at FROM users WHERE id = ?', [id], (err, user) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  });
});

// Get all polls
app.get('/api/polls', (req, res) => {
  db.all(`SELECT * FROM polls`, [], (err, polls) => {
    if (err) {
      console.error("Error fetching polls:", err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Format polls to match the API format
    const promises = polls.map(poll => {
      return new Promise((resolve, reject) => {
        // Get options for this poll
        db.all(`SELECT * FROM options WHERE poll_id = ?`, [poll.id], (err, options) => {
          if (err) {
            reject(err);
            return;
          }
          
          // Get vote counts for each option
          const optionPromises = options.map(option => {
            return new Promise((resolve, reject) => {
              db.get(`SELECT COUNT(*) as votes FROM votes WHERE option_id = ?`, [option.id], (err, result) => {
                if (err) {
                  reject(err);
                  return;
                }
                
                resolve({
                  id: option.id,
                  text: option.text,
                  votes: result.votes
                });
              });
            });
          });
          
          Promise.all(optionPromises)
            .then(results => {
              resolve({
                id: poll.id,
                question: poll.question,
                options: options.map(opt => ({ id: opt.id, text: opt.text })),
                results: results,
                createdBy: poll.created_by,
                createdAt: poll.created_at
              });
            })
            .catch(reject);
        });
      });
    });
    
    Promise.all(promises)
      .then(formattedPolls => {
        res.json(formattedPolls);
      })
      .catch(err => {
        console.error("Error processing polls:", err);
        res.status(500).json({ error: 'Database error' });
      });
  });
});

// Get a specific poll
app.get('/api/polls/:id', (req, res) => {
  const pollId = req.params.id;
  
  db.get(`SELECT * FROM polls WHERE id = ?`, [pollId], (err, poll) => {
    if (err) {
      console.error("Error fetching poll:", err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!poll) {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    // Get options for this poll
    db.all(`SELECT * FROM options WHERE poll_id = ?`, [pollId], (err, options) => {
      if (err) {
        console.error("Error fetching options:", err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Get vote counts for each option
      const promises = options.map(option => {
        return new Promise((resolve, reject) => {
          db.get(`SELECT COUNT(*) as votes FROM votes WHERE option_id = ?`, [option.id], (err, result) => {
            if (err) {
              reject(err);
              return;
            }
            
            resolve({
              id: option.id,
              text: option.text,
              votes: result.votes
            });
          });
        });
      });
      
      Promise.all(promises)
        .then(results => {
          res.json({
            id: poll.id,
            question: poll.question,
            options: options.map(opt => ({ id: opt.id, text: opt.text })),
            results: results,
            createdBy: poll.created_by,
            createdAt: poll.created_at
          });
        })
        .catch(err => {
          console.error("Error processing poll:", err);
          res.status(500).json({ error: 'Database error' });
        });
    });
  });
});

// Create a new poll
app.post('/api/polls', authenticateToken, (req, res) => {
  const { question, options } = req.body;
  let createdBy;
  
  if (req.user) {
    // If authenticated, use the username from the token
    createdBy = req.user.username;
  } else {
    // For backward compatibility, get from request body
    createdBy = req.body.createdBy;
    if (!createdBy) {
      return res.status(400).json({ error: 'createdBy is required when not authenticated' });
    }
  }
  
  // Validate request
  if (!question || !options || options.length < 2) {
    return res.status(400).json({ error: 'Invalid poll data' });
  }
  
  // Generate unique poll ID
  const pollId = 'poll-' + Math.random().toString(36).substr(2, 9);
  const createdAt = new Date().toISOString();
  
  // Start a database transaction
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // Insert poll
    db.run(
      `INSERT INTO polls (id, question, created_by, created_at) VALUES (?, ?, ?, ?)`,
      [pollId, question, createdBy, createdAt],
      function(err) {
        if (err) {
          console.error("Error creating poll:", err);
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Database error' });
        }
        
        // Insert options
        const optionPromises = options.map((text, index) => {
          return new Promise((resolve, reject) => {
            const optionId = `option-${pollId}-${index + 1}`;
            db.run(
              `INSERT INTO options (id, poll_id, text) VALUES (?, ?, ?)`,
              [optionId, pollId, text],
              function(err) {
                if (err) {
                  reject(err);
                  return;
                }
                resolve({
                  id: optionId,
                  text: text
                });
              }
            );
          });
        });
        
        Promise.all(optionPromises)
          .then(insertedOptions => {
            // Commit transaction
            db.run('COMMIT');
            
            // Create poll object to return
            const poll = {
              id: pollId,
              question,
              options: insertedOptions,
              results: insertedOptions.map(opt => ({
                id: opt.id,
                text: opt.text,
                votes: 0
              })),
              createdBy,
              createdAt
            };
            
            // Notify all clients about new poll
            io.emit('pollCreated', poll);
            
            res.status(201).json(poll);
          })
          .catch(err => {
            console.error("Error inserting options:", err);
            db.run('ROLLBACK');
            res.status(500).json({ error: 'Database error' });
          });
      }
    );
  });
});

// Submit a vote
app.post('/api/polls/:id/vote', authenticateToken, (req, res) => {
  let username;
  const { optionId } = req.body;
  const pollId = req.params.id;
  
  if (req.user) {
    // If authenticated, use the username from the token
    username = req.user.username;
  } else {
    // For backward compatibility, get from request body
    username = req.body.username;
    if (!username) {
      return res.status(400).json({ error: 'username is required when not authenticated' });
    }
  }
  
  // Validate request
  if (!optionId) {
    return res.status(400).json({ error: 'Option ID is required' });
  }
  
  // Check if poll exists
  db.get(`SELECT * FROM polls WHERE id = ?`, [pollId], (err, poll) => {
    if (err) {
      console.error("Error checking poll:", err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!poll) {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    // Check if user has already voted on this poll
    db.get(`SELECT * FROM votes WHERE poll_id = ? AND username = ?`, [pollId, username], (err, existingVote) => {
      if (err) {
        console.error("Error checking existing vote:", err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (existingVote) {
        return res.status(400).json({ error: 'You have already voted on this poll' });
      }
      
      // Check if option exists
      db.get(`SELECT * FROM options WHERE id = ? AND poll_id = ?`, [optionId, pollId], (err, option) => {
        if (err) {
          console.error("Error checking option:", err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (!option) {
          return res.status(404).json({ error: 'Option not found' });
        }
        
        // Record vote
        const votedAt = new Date().toISOString();
        db.run(
          `INSERT INTO votes (poll_id, option_id, username, voted_at) VALUES (?, ?, ?, ?)`,
          [pollId, optionId, username, votedAt],
          function(err) {
            if (err) {
              console.error("Error recording vote:", err);
              return res.status(500).json({ error: 'Database error' });
            }
            
            // Get updated results
            db.all(
              `SELECT o.id, o.text, COUNT(v.id) as votes 
               FROM options o 
               LEFT JOIN votes v ON o.id = v.option_id 
               WHERE o.poll_id = ? 
               GROUP BY o.id`,
              [pollId],
              (err, results) => {
                if (err) {
                  console.error("Error getting results:", err);
                  return res.status(500).json({ error: 'Database error' });
                }
                
                // Notify all clients about updated results
                io.to(pollId).emit('resultsUpdated', {
                  pollId,
                  results
                });
                
                res.json({ 
                  success: true, 
                  pollId,
                  optionId,
                  results
                });
              }
            );
          }
        );
      });
    });
  });
});

// Get poll results
app.get('/api/polls/:id/results', (req, res) => {
  const pollId = req.params.id;
  
  db.get(`SELECT * FROM polls WHERE id = ?`, [pollId], (err, poll) => {
    if (err) {
      console.error("Error checking poll:", err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!poll) {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    // Get results
    db.all(
      `SELECT o.id, o.text, COUNT(v.id) as votes 
       FROM options o 
       LEFT JOIN votes v ON o.id = v.option_id 
       WHERE o.poll_id = ? 
       GROUP BY o.id`,
      [pollId],
      (err, results) => {
        if (err) {
          console.error("Error getting results:", err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        res.json(results);
      }
    );
  });
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

// Handle process termination
process.on('exit', () => {
  db.close();
});

module.exports = { app, server }; 
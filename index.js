const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();

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

// Set up SQLite database
const db = new sqlite3.Database('./polls.db');

// Create tables if they don't exist
db.serialize(() => {
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

// Routes

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running', timestamp: new Date().toISOString() });
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
app.post('/api/polls', (req, res) => {
  const { question, options, createdBy } = req.body;
  
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
            const optionId = `option-${index + 1}`;
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
app.post('/api/polls/:id/vote', (req, res) => {
  const { optionId, username } = req.body;
  const pollId = req.params.id;
  
  // Validate request
  if (!optionId || !username) {
    return res.status(400).json({ error: 'Invalid vote data' });
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
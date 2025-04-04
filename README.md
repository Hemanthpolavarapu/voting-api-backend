# Voting API Backend

A real-time voting application backend built with Node.js, Express, Socket.IO, and SQLite.

## Features

- Create and manage polls
- Real-time vote updates using Socket.IO
- RESTful API for poll management
- Data persistence using SQLite database
- CORS support for cross-origin requests

## Installation

1. Clone the repository
```bash
git clone https://github.com/Hemanthpolavarapu/voting-api-backend.git
cd voting-api-backend
```

2. Install dependencies
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```
PORT=5001
CORS_ORIGIN=*
```

4. Start the server
```bash
npm start
```

The server will be running at http://localhost:5001/api

## Database

The application uses SQLite for data persistence. The database file (`polls.db`) will be automatically created in the root directory when the server starts. It contains the following tables:

- `polls`: Stores poll information
- `options`: Stores poll options
- `votes`: Stores votes cast by users

## API Endpoints

- `GET /api/health` - Health check endpoint
- `GET /api/polls` - Get all polls
- `GET /api/polls/:id` - Get a specific poll
- `POST /api/polls` - Create a new poll
- `POST /api/polls/:id/vote` - Submit a vote for a poll
- `GET /api/polls/:id/results` - Get poll results

## Socket.IO Events

- `connection` - New client connected
- `joinPoll` - Join a poll room for real-time updates
- `leavePoll` - Leave a poll room
- `disconnect` - Client disconnected
- `resultsUpdated` - Poll results updated
- `pollCreated` - New poll created

## Technologies Used

- Node.js
- Express.js
- Socket.IO
- SQLite (for data persistence)
- dotenv

## License

MIT 
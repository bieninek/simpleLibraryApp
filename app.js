// File: app.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Create MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'library_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test database connection
app.get('/api/health', async (req, res) => {
  try {
    const [result] = await pool.query('SELECT 1');
    res.status(200).json({ message: 'Database connection successful', result });
  } catch (error) {
    res.status(500).json({ message: 'Database connection failed', error: error.message });
  }
});

// Routes
const booksRouter = require('./routes/books')(pool);
const authorsRouter = require('./routes/authors')(pool);
const membersRouter = require('./routes/members')(pool);
const borrowingsRouter = require('./routes/borrowings')(pool);
const categoriesRouter = require('./routes/categories')(pool);
const publishersRouter = require('./routes/publishers')(pool);

app.use('/api/books', booksRouter);
app.use('/api/authors', authorsRouter);
app.use('/api/members', membersRouter);
app.use('/api/borrowings', borrowingsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/publishers', publishersRouter);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
// File: routes/publishers.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  // Get all publishers with pagination and search
  router.get('/', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      
      const searchTerm = req.query.search || '';
      
      let query = `
        SELECT p.publisher_id, p.name, p.address, p.email, p.phone,  
               COUNT(b.book_id) AS book_count
        FROM publishers p
        LEFT JOIN books b ON p.publisher_id = b.publisher_id
      `;
      
      const parameters = [];
      
      // Add grouping and pagination
      query += ` GROUP BY p.publisher_id ORDER BY p.name LIMIT ? OFFSET ?`;
      parameters.push(limit, offset);
      
      // Get total count for pagination
      let countQuery = `SELECT COUNT(*) AS total FROM publishers`;
      
      const [publishers] = await pool.query(query, parameters);
      const [countResult] = await pool.query(
        countQuery, 
        searchTerm ? [`%${searchTerm}%`] : []
      );
      const totalCount = countResult[0].total;
      
      res.status(200).json({
        publishers,
        pagination: {
          total: totalCount,
          page,
          limit,
          pages: Math.ceil(totalCount / limit)
        }
      });
    } catch (error) {
      console.error('Błąd przy wybieraniu wydawców', error);
      res.status(500).json({ message: 'Błąd przy wybieraniu wydawców', error: error.message });
    }
  });

  // Create a new publisher
  router.post('/', async (req, res) => {
    try {
      const { name, address, phone, email } = req.body;
      
      const [result] = await pool.query(`
        INSERT INTO publishers (name, address, phone, email)
        VALUES (?, ?, ?, ?)
      `, [name, address, phone, email]);
      
      res.status(201).json({ 
        message: 'Wydawca pomyślnie utworzony',
        publisher_id: result.insertId
      });
    } catch (error) {
      console.error('Błąd przy tworzeniu wydawcy:', error);
      res.status(500).json({ message: 'Błąd przy tworzeniu wydawcy', error: error.message });
    }
  });

  return router;
};
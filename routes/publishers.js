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
  
  // Delete a publisher
  router.delete('/:id', async (req, res) => {
    try {
      const publisherId = req.params.id;
      
      // Check if the publisher has books
      const [booksCheck] = await pool.query(`
        SELECT COUNT(*) AS count FROM books WHERE publisher_id = ?
      `, [publisherId]);
      
      if (booksCheck[0].count > 0) {
        return res.status(400).json({ 
          message: 'Cannot delete publisher with associated books'
        });
      }
      
      // Delete the publisher
      const [result] = await pool.query(`
        DELETE FROM publishers WHERE publisher_id = ?
      `, [publisherId]);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Publisher not found' });
      }
      
      res.status(200).json({ message: 'Publisher deleted successfully' });
    } catch (error) {
      console.error('Error deleting publisher:', error);
      res.status(500).json({ message: 'Error deleting publisher', error: error.message });
    }
  });

  // Update a publisher
  router.put('/:id', async (req, res) => {
    try {
      const publisherId = req.params.id;
      const { 
        name, address, phone, email
      } = req.body;
      
      // Check if publisher exists
      const [publisherCheck] = await pool.query(`
        SELECT publisher_id FROM publishers WHERE publisher_id = ?
      `, [publisherId]);
      
      if (publisherCheck.length === 0) {
        return res.status(404).json({ message: 'Publisher not found' });
      }
      
      // Check if email already exists for another publisher
      if (email) {
        const [emailCheck] = await pool.query(`
          SELECT publisher_id FROM publishers WHERE email = ? AND publisher_id != ?
        `, [email, publisher_id]);
        
        if (emailCheck.length > 0) {
          return res.status(400).json({ message: 'Email already in use by another publisher' });
        }
      }
      
      await pool.query(`
        UPDATE publishers SET
          name = ?,
          address = ?,
          phone = ?,
          email = ?
        WHERE publisher_id = ?
      `, [
        name, 
        address, 
        phone, 
        email,
        publisherId
      ]);
      
      res.status(200).json({ message: 'Publisher updated successfully' });
    } catch (error) {
      console.error('Error updating publisher:', error);
      res.status(500).json({ message: 'Error updating publisher', error: error.message });
    }
  });

// Get publisher by ID
  router.get('/:id', async (req, res) => {
    try {
      const publisherId = req.params.id;
      
      // Get publisher info
      const [publishers] = await pool.query(`
        SELECT * FROM publishers WHERE publisher_id = ?
      `, [publisherId]);
      
      if (publishers.length === 0) {
        return res.status(404).json({ message: 'Publisher not found' });
      }
      
      const publisher = publishers[0];
      
      res.status(200).json(publisher);
    } catch (error) {
      console.error('Error getting publisher:', error);
      res.status(500).json({ message: 'Error retrieving publisher', error: error.message });
    }
  });

  return router;
};
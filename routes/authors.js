// File: routes/authors.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  // Get all authors with pagination and search
  router.get('/', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      
      const searchTerm = req.query.search || '';
      
      let query = `
        SELECT a.author_id, a.first_name, a.last_name, a.birth_date, 
               COUNT(ba.book_id) AS book_count
        FROM authors a
        LEFT JOIN book_authors ba ON a.author_id = ba.author_id
      `;
      
      const parameters = [];
      
      // Add search condition if needed
      if (searchTerm) {
        query += ` WHERE CONCAT(a.first_name, ' ', a.last_name) LIKE ?`;
        parameters.push(`%${searchTerm}%`);
      }
      
      // Add grouping and pagination
      query += ` GROUP BY a.author_id ORDER BY a.last_name, a.first_name LIMIT ? OFFSET ?`;
      parameters.push(limit, offset);
      
      // Get total count for pagination
      let countQuery = `SELECT COUNT(*) AS total FROM authors`;
      
      if (searchTerm) {
        countQuery += ` WHERE CONCAT(first_name, ' ', last_name) LIKE ?`;
      }
      
      const [authors] = await pool.query(query, parameters);
      const [countResult] = await pool.query(
        countQuery, 
        searchTerm ? [`%${searchTerm}%`] : []
      );
      const totalCount = countResult[0].total;
      
      res.status(200).json({
        authors,
        pagination: {
          total: totalCount,
          page,
          limit,
          pages: Math.ceil(totalCount / limit)
        }
      });
    } catch (error) {
      console.error('Error getting authors:', error);
      res.status(500).json({ message: 'Error retrieving authors', error: error.message });
    }
  });

  // Get author by ID with their books
  router.get('/:id', async (req, res) => {
    try {
      const authorId = req.params.id;
      
      // Get author info
      const [authors] = await pool.query(`
        SELECT * FROM authors WHERE author_id = ?
      `, [authorId]);
      
      if (authors.length === 0) {
        return res.status(404).json({ message: 'Author not found' });
      }
      
      const author = authors[0];
      
      // Get author's books
      const [books] = await pool.query(`
        SELECT b.book_id, b.title, b.isbn, b.publication_year, 
               b.available_copies, b.total_copies
        FROM books b
        JOIN book_authors ba ON b.book_id = ba.book_id
        WHERE ba.author_id = ?
        ORDER BY b.publication_year DESC
      `, [authorId]);
      
      // Get co-authors
      const [coauthors] = await pool.query(`
        SELECT DISTINCT a.author_id, a.first_name, a.last_name, COUNT(b.book_id) AS shared_books
        FROM authors a
        JOIN book_authors ba1 ON a.author_id = ba1.author_id
        JOIN book_authors ba2 ON ba1.book_id = ba2.book_id
        JOIN books b ON ba1.book_id = b.book_id
        WHERE ba2.author_id = ? AND a.author_id != ?
        GROUP BY a.author_id
        ORDER BY shared_books DESC
      `, [authorId, authorId]);
      
      author.books = books;
      author.coauthors = coauthors;
      
      res.status(200).json(author);
    } catch (error) {
      console.error('Error getting author:', error);
      res.status(500).json({ message: 'Error retrieving author', error: error.message });
    }
  });

  // Create a new author
  router.post('/', async (req, res) => {
    try {
      const { first_name, last_name, birth_date, biography } = req.body;
      
      const [result] = await pool.query(`
        INSERT INTO authors (first_name, last_name, birth_date, biography)
        VALUES (?, ?, ?, ?)
      `, [first_name, last_name, birth_date, biography]);
      
      res.status(201).json({ 
        message: 'Author created successfully',
        author_id: result.insertId
      });
    } catch (error) {
      console.error('Error creating author:', error);
      res.status(500).json({ message: 'Error creating author', error: error.message });
    }
  });

  // Update an author
  router.put('/:id', async (req, res) => {
    try {
      const authorId = req.params.id;
      const { first_name, last_name, birth_date, biography } = req.body;
      
	  /*
      // Check if author exists
      const [authorCheck] = await pool.query(`
        SELECT author_id FROM authors WHERE author_id = ?
      `, [authorId]);
      
      if (authorCheck.length === 0) {
        return res.status(404).json({ message: 'Author not found' });
      }
	  */
	  
	  const [authorCheck] = await pool.query(`
	  SELECT author_id,
         COUNT(*) OVER () AS total_authors
	  FROM authors
	  WHERE author_id = ?
	  `, [authorId]);

	  if (authorCheck.length === 0) {
		return res.status(404).json({ message: 'Author not found' });
	  }

      
      await pool.query(`
        UPDATE authors SET
          first_name = ?,
          last_name = ?,
          birth_date = ?,
          biography = ?
        WHERE author_id = ?
      `, [first_name, last_name, birth_date, biography, authorId]);
      
      res.status(200).json({ message: 'Author updated successfully' });
    } catch (error) {
      console.error('Error updating author:', error);
      res.status(500).json({ message: 'Error updating author', error: error.message });
    }
  });

  // Delete an author
  router.delete('/:id', async (req, res) => {
    try {
      const authorId = req.params.id;
      
      // Check if the author has books
      const [booksCheck] = await pool.query(`
	  SELECT DISTINCT author_id,
		COUNT(*) OVER (PARTITION BY author_id) AS book_count
	  FROM book_authors
	  WHERE author_id = ?
	  `, [authorId]);
      
      if (booksCheck.length > 0 && booksCheck[0].book_count > 0) {
        return res.status(400).json({ 
          message: 'Cannot delete author with associated books'
        });
      }
      
      // Delete the author
      const [result] = await pool.query(`
        DELETE FROM authors WHERE author_id = ?
      `, [authorId]);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Author not found' });
      }
      
      res.status(200).json({ message: 'Author deleted successfully' });
    } catch (error) {
      console.error('Error deleting author:', error);
      res.status(500).json({ message: 'Error deleting author', error: error.message });
    }
  });

  // Get books by author
  router.get('/:id/books', async (req, res) => {
    try {
      const authorId = req.params.id;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      
	  /*
      // Check if author exists
      const [authorCheck] = await pool.query(`
        SELECT author_id FROM authors WHERE author_id = ?
      `, [authorId]);
      
      if (authorCheck.length === 0) {
        return res.status(404).json({ message: 'Author not found' });
      }
	  */
	  
	  const [rows] = await pool.query(`
	  SELECT AuthorExists(?) AS existsFlag
	  `, [authorId]);

	  if (!rows[0].existsFlag) {
		return res.status(404).json({ message: 'Author not found' });
	  }

      
      // Get books by the author with pagination
      const [books] = await pool.query(`
        SELECT b.book_id, b.title, b.isbn, b.publication_year, 
               b.language, b.available_copies, b.total_copies
        FROM books b
        JOIN book_authors ba ON b.book_id = ba.book_id
        WHERE ba.author_id = ?
        ORDER BY b.publication_year DESC
        LIMIT ? OFFSET ?
      `, [authorId, limit, offset]);
      
      // Get total count for pagination
      const [countResult] = await pool.query(`
        SELECT COUNT(*) AS total 
        FROM book_authors 
        WHERE author_id = ?
      `, [authorId]);
      const totalCount = countResult[0].total;
      
      res.status(200).json({
        books,
        pagination: {
          total: totalCount,
          page,
          limit,
          pages: Math.ceil(totalCount / limit)
        }
      });
    } catch (error) {
      console.error('Error getting author books:', error);
      res.status(500).json({ message: 'Error retrieving author books', error: error.message });
    }
  });

  return router;
};
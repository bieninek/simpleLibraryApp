// File: routes/books.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  // Get all books with pagination and filtering
  router.get('/', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      
      const searchTerm = req.query.search || '';
      const category = req.query.category || '';
      const author = req.query.author || '';
      const availability = req.query.availability;
      
      let query = `
        SELECT b.book_id, b.title, b.isbn, b.publication_year, 
               b.language, b.available_copies, b.total_copies,
               p.name AS publisher_name
        FROM books b
        LEFT JOIN publishers p ON b.publisher_id = p.publisher_id
      `;
      
      const conditions = [];
      const parameters = [];
      
      // Add search condition if needed
      if (searchTerm) {
        conditions.push(`(MATCH(b.title, b.description) AGAINST(? IN BOOLEAN MODE))`);
        parameters.push(`*${searchTerm}*`);
      }
      
      // Add category filter
      if (category) {
        query += `
          JOIN book_categories bc ON b.book_id = bc.book_id
          JOIN categories c ON bc.category_id = c.category_id
        `;
        conditions.push(`c.name = ?`);
        parameters.push(category);
      }
      
      // Add author filter
      if (author) {
        query += `
          JOIN book_authors ba ON b.book_id = ba.book_id
          JOIN authors a ON ba.author_id = a.author_id
        `;
        conditions.push(`CONCAT(a.first_name, ' ', a.last_name) LIKE ?`);
        parameters.push(`%${author}%`);
      }
      
      // Add availability filter
      if (availability === 'available') {
        conditions.push(`b.available_copies > 0`);
      } else if (availability === 'unavailable') {
        conditions.push(`b.available_copies = 0`);
      }
      
      // Add WHERE clause if any conditions exist
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }
      
      // Add pagination
      query += ` GROUP BY b.book_id LIMIT ? OFFSET ?`;
      parameters.push(limit, offset);
      
      // Get total count for pagination
      let countQuery = `
        SELECT COUNT(DISTINCT b.book_id) AS total 
        FROM books b
      `;
      
      if (category) {
        countQuery += `
          JOIN book_categories bc ON b.book_id = bc.book_id
          JOIN categories c ON bc.category_id = c.category_id
        `;
      }
      
      if (author) {
        countQuery += `
          JOIN book_authors ba ON b.book_id = ba.book_id
          JOIN authors a ON ba.author_id = a.author_id
        `;
      }
      
      if (conditions.length > 0) {
        countQuery += ` WHERE ${conditions.join(' AND ')}`;
      }
      
      const [books] = await pool.query(query, parameters);
      const [countResult] = await pool.query(countQuery, parameters.slice(0, -2));
      const totalCount = countResult[0].total;
      
      // For each book, get its authors
      for (const book of books) {
        const [authors] = await pool.query(`
          SELECT a.author_id, a.first_name, a.last_name
          FROM authors a
          JOIN book_authors ba ON a.author_id = ba.author_id
          WHERE ba.book_id = ?
        `, [book.book_id]);
        
        const [categories] = await pool.query(`
          SELECT c.category_id, c.name
          FROM categories c
          JOIN book_categories bc ON c.category_id = bc.category_id
          WHERE bc.book_id = ?
        `, [book.book_id]);
        
        book.authors = authors;
        book.categories = categories;
      }
      
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
      console.error('Error getting books:', error);
      res.status(500).json({ message: 'Error retrieving books', error: error.message });
    }
  });

  // Get book by ID
  router.get('/:id', async (req, res) => {
    try {
      const bookId = req.params.id;
      
      // Get book basic info
      const [books] = await pool.query(`
        SELECT b.*, p.name AS publisher_name
        FROM books b
        LEFT JOIN publishers p ON b.publisher_id = p.publisher_id
        WHERE b.book_id = ?
      `, [bookId]);
      
      if (books.length === 0) {
        return res.status(404).json({ message: 'Book not found' });
      }
      
      const book = books[0];
      
      // Get book authors
      const [authors] = await pool.query(`
        SELECT a.author_id, a.first_name, a.last_name
        FROM authors a
        JOIN book_authors ba ON a.author_id = ba.author_id
        WHERE ba.book_id = ?
      `, [bookId]);
      
      // Get book categories
      const [categories] = await pool.query(`
        SELECT c.category_id, c.name
        FROM categories c
        JOIN book_categories bc ON c.category_id = bc.category_id
        WHERE bc.book_id = ?
      `, [bookId]);
      
      // Get current borrowings of this book
      const [borrowings] = await pool.query(`
        SELECT b.borrowing_id, b.borrow_date, b.due_date, b.status,
               m.member_id, CONCAT(m.first_name, ' ', m.last_name) AS member_name
        FROM borrowings b
        JOIN members m ON b.member_id = m.member_id
        WHERE b.book_id = ? AND b.status IN ('borrowed', 'overdue')
        ORDER BY b.due_date
      `, [bookId]);
      
      book.authors = authors;
      book.categories = categories;
      book.current_borrowings = borrowings;
      
      res.status(200).json(book);
    } catch (error) {
      console.error('Error getting book:', error);
      res.status(500).json({ message: 'Error retrieving book', error: error.message });
    }
  });

  // Create a new book
  router.post('/', async (req, res) => {
    try {
      const { 
        title, isbn, publisher_id, publication_year, language,
        page_count, description, total_copies, author_ids, category_ids 
      } = req.body;
      
      // Start a transaction
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      
      try {
        // Insert the book
        const [result] = await connection.query(`
          INSERT INTO books (
            title, isbn, publisher_id, publication_year, language,
            page_count, description, total_copies, available_copies
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          title, isbn, publisher_id, publication_year, language,
          page_count, description, total_copies, total_copies
        ]);
        
        const bookId = result.insertId;
        
        // Add author relationships
        if (author_ids && author_ids.length > 0) {
          const authorValues = author_ids.map(authorId => [bookId, authorId]);
          await connection.query(`
            INSERT INTO book_authors (book_id, author_id) VALUES ?
          `, [authorValues]);
        }
        
        // Add category relationships
        if (category_ids && category_ids.length > 0) {
          const categoryValues = category_ids.map(categoryId => [bookId, categoryId]);
          await connection.query(`
            INSERT INTO book_categories (book_id, category_id) VALUES ?
          `, [categoryValues]);
        }
        
        // Commit the transaction
        await connection.commit();
        
        res.status(201).json({ 
          message: 'Book created successfully',
          book_id: bookId
        });
      } catch (error) {
        // Rollback in case of error
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error creating book:', error);
      res.status(500).json({ message: 'Error creating book', error: error.message });
    }
  });

  // Update a book
  router.put('/:id', async (req, res) => {
    try {
      const bookId = req.params.id;
      const { 
        title, isbn, publisher_id, publication_year, language,
        page_count, description, total_copies, available_copies,
        author_ids, category_ids 
      } = req.body;
      
      // Start a transaction
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      
      try {
        // Update the book
        await connection.query(`
          UPDATE books SET
            title = ?,
            isbn = ?,
            publisher_id = ?,
            publication_year = ?,
            language = ?,
            page_count = ?,
            description = ?,
            total_copies = ?,
            available_copies = ?
          WHERE book_id = ?
        `, [
          title, isbn, publisher_id, publication_year, language,
          page_count, description, total_copies, available_copies,
          bookId
        ]);
        
        // Update author relationships if provided
        if (author_ids) {
          // Remove existing relationships
          await connection.query(`DELETE FROM book_authors WHERE book_id = ?`, [bookId]);
          
          // Add new relationships
          if (author_ids.length > 0) {
            const authorValues = author_ids.map(authorId => [bookId, authorId]);
            await connection.query(`
              INSERT INTO book_authors (book_id, author_id) VALUES ?
            `, [authorValues]);
          }
        }
        
        // Update category relationships if provided
        if (category_ids) {
          // Remove existing relationships
          await connection.query(`DELETE FROM book_categories WHERE book_id = ?`, [bookId]);
          
          // Add new relationships
          if (category_ids.length > 0) {
            const categoryValues = category_ids.map(categoryId => [bookId, categoryId]);
            await connection.query(`
              INSERT INTO book_categories (book_id, category_id) VALUES ?
            `, [categoryValues]);
          }
        }
        
        // Commit the transaction
        await connection.commit();
        
        res.status(200).json({ message: 'Book updated successfully' });
      } catch (error) {
        // Rollback in case of error
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error updating book:', error);
      res.status(500).json({ message: 'Error updating book', error: error.message });
    }
  });

  // Delete a book
  router.delete('/:id', async (req, res) => {
    try {
      const bookId = req.params.id;
      /*
      // Check if the book has active borrowings
      const [activeBorrowings] = await pool.query(`
        SELECT COUNT(*) AS count
        FROM borrowings
        WHERE book_id = ? AND status IN ('borrowed', 'overdue')
      `, [bookId]);
      
      if (activeBorrowings[0].count > 0) {
        return res.status(400).json({ 
          message: 'Cannot delete book with active borrowings'
        });
      }
	  */
	  // Check if the book has active borrowings using MySQL function
	   const [rows] = await pool.query(`
	  SELECT GetActiveBorrowingsCount(?) AS count
	  `, [bookId]);

	  if (rows[0].count > 0) {
		return res.status(400).json({
		message: 'Cannot delete book with active borrowings'
		});
	  }
      
      // Start a transaction
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      
      try {
        // Delete relationships
        await connection.query(`DELETE FROM book_authors WHERE book_id = ?`, [bookId]);
        await connection.query(`DELETE FROM book_categories WHERE book_id = ?`, [bookId]);
        
        // Delete the book
        await connection.query(`DELETE FROM books WHERE book_id = ?`, [bookId]);
        
        // Commit the transaction
        await connection.commit();
        
        res.status(200).json({ message: 'Book deleted successfully' });
      } catch (error) {
        // Rollback in case of error
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error deleting book:', error);
      res.status(500).json({ message: 'Error deleting book', error: error.message });
    }
  });

  return router;
};
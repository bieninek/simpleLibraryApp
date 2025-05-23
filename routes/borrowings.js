// File: routes/borrowings.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  // Get all borrowings with filtering options
  router.get('/', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      
      const status = req.query.status;
      const memberId = req.query.member_id;
      const bookId = req.query.book_id;
      const fromDate = req.query.from_date;
      const toDate = req.query.to_date;
      
      let query = `
        SELECT b.borrowing_id, b.borrow_date, b.due_date, b.return_date, 
               b.fine_amount, b.status,
               bk.book_id, bk.title, bk.isbn,
               m.member_id, CONCAT(m.first_name, ' ', m.last_name) AS member_name
        FROM borrowings b
        JOIN books bk ON b.book_id = bk.book_id
        JOIN members m ON b.member_id = m.member_id
      `;
      
      const conditions = [];
      const parameters = [];
      
      // Add filters if needed
      if (status) {
        conditions.push(`b.status = ?`);
        parameters.push(status);
      }
      
      if (memberId) {
        conditions.push(`b.member_id = ?`);
        parameters.push(memberId);
      }
      
      if (bookId) {
        conditions.push(`b.book_id = ?`);
        parameters.push(bookId);
      }
      
      if (fromDate) {
        conditions.push(`b.borrow_date >= ?`);
        parameters.push(fromDate);
      }
      
      if (toDate) {
        conditions.push(`b.borrow_date <= ?`);
        parameters.push(toDate);
      }
      
      // Add WHERE clause if any conditions exist
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }
      
      // Add sorting and pagination
      query += ` ORDER BY b.borrow_date DESC LIMIT ? OFFSET ?`;
      parameters.push(limit, offset);
      
      // Get total count for pagination
      let countQuery = `
        SELECT COUNT(*) AS total 
        FROM borrowings b
      `;
      
      if (conditions.length > 0) {
        countQuery += ` WHERE ${conditions.join(' AND ')}`;
      }
      
      const [borrowings] = await pool.query(query, parameters);
      const [countResult] = await pool.query(countQuery, parameters.slice(0, -2));
      const totalCount = countResult[0].total;
      
      res.status(200).json({
        borrowings,
        pagination: {
          total: totalCount,
          page,
          limit,
          pages: Math.ceil(totalCount / limit)
        }
      });
    } catch (error) {
      console.error('Error getting borrowings:', error);
      res.status(500).json({ message: 'Error retrieving borrowings', error: error.message });
    }
  });

  // Get a specific borrowing by ID
  router.get('/:id', async (req, res) => {
    try {
      const borrowingId = req.params.id;
      
      const [borrowings] = await pool.query(`
        SELECT b.*, 
               bk.title AS book_title, bk.isbn,
               CONCAT(m.first_name, ' ', m.last_name) AS member_name,
               m.email AS member_email
        FROM borrowings b
        JOIN books bk ON b.book_id = bk.book_id
        JOIN members m ON b.member_id = m.member_id
        WHERE b.borrowing_id = ?
      `, [borrowingId]);
      
      if (borrowings.length === 0) {
        return res.status(404).json({ message: 'Borrowing record not found' });
      }
      
      res.status(200).json(borrowings[0]);
          } catch (error) {
      console.error('Error getting borrowing:', error);
      res.status(500).json({ message: 'Error retrieving borrowing', error: error.message });
    }
  });

  // Create a new borrowing
  router.post('/', async (req, res) => {
    try {
      const { book_id, member_id, borrow_date, due_date } = req.body;
      
      // Start a transaction
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      
      try {
        // Check if the book is available
        const [bookResult] = await connection.query(`
          SELECT available_copies FROM books WHERE book_id = ?
        `, [book_id]);
        
        if (bookResult.length === 0) {
          await connection.rollback();
          return res.status(404).json({ message: 'Book not found' });
        }
        
        if (bookResult[0].available_copies <= 0) {
          await connection.rollback();
          return res.status(400).json({ message: 'No available copies of this book' });
        }
        
        // Check if the member exists and is active
        const [memberResult] = await connection.query(`
          SELECT membership_status FROM members WHERE member_id = ?
        `, [member_id]);
        
        if (memberResult.length === 0) {
          await connection.rollback();
          return res.status(404).json({ message: 'Member not found' });
        }
        
        if (memberResult[0].membership_status !== 'active') {
          await connection.rollback();
          return res.status(400).json({ message: 'Member is not active' });
        }
        
        // Check if the member has any overdue books
        const [overdueResult] = await connection.query(`
          SELECT COUNT(*) AS count FROM borrowings 
          WHERE member_id = ? AND status = 'overdue'
        `, [member_id]);
        
        if (overdueResult[0].count > 0) {
          await connection.rollback();
          return res.status(400).json({ 
            message: 'Member has overdue books and cannot borrow more'
          });
        }
        
        // Calculate due date if not provided
        let finalDueDate = due_date;
        if (!finalDueDate) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 14); // Default 14 days loan period
          finalDueDate = dueDate.toISOString().split('T')[0];
        }
        
        // Insert the borrowing record
        const [result] = await connection.query(`
          INSERT INTO borrowings (
            book_id, member_id, borrow_date, due_date, status
          ) VALUES (?, ?, ?, ?, 'borrowed')
        `, [
          book_id,
          member_id,
          borrow_date || new Date().toISOString().split('T')[0], // Use current date if not provided
          finalDueDate
        ]);
        
        // Update book available copies (trigger handles this)
        
        // Commit the transaction
        await connection.commit();
        
        res.status(201).json({ 
          message: 'Book borrowed successfully',
          borrowing_id: result.insertId
        });
      } catch (error) {
        // Rollback in case of error
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error creating borrowing:', error);
      res.status(500).json({ message: 'Error creating borrowing', error: error.message });
    }
  });

  // Return a book
  router.put('/:id/return', async (req, res) => {
    try {
      const borrowingId = req.params.id;
      const { return_date, fine_amount } = req.body;
      
      // Start a transaction
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      
      try {
        // Check if the borrowing exists and is not already returned
        const [borrowingResult] = await connection.query(`
          SELECT book_id, status FROM borrowings WHERE borrowing_id = ?
        `, [borrowingId]);
        
        if (borrowingResult.length === 0) {
          await connection.rollback();
          return res.status(404).json({ message: 'Borrowing record not found' });
        }
        
        if (borrowingResult[0].status === 'returned') {
          await connection.rollback();
          return res.status(400).json({ message: 'Book is already returned' });
        }
        
        // Update the borrowing record
        await connection.query(`
          UPDATE borrowings SET
            status = 'returned',
            return_date = ?,
            fine_amount = ?
          WHERE borrowing_id = ?
        `, [
          return_date || new Date().toISOString().split('T')[0], // Use current date if not provided
          fine_amount || 0,
          borrowingId
        ]);
        
        // Update book available copies (trigger handles this)
        
        // Commit the transaction
        await connection.commit();
        
        res.status(200).json({ message: 'Book returned successfully' });
      } catch (error) {
        // Rollback in case of error
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error returning book:', error);
      res.status(500).json({ message: 'Error returning book', error: error.message });
    }
  });

  // Update a borrowing's due date
  router.put('/:id/extend', async (req, res) => {
    try {
      const borrowingId = req.params.id;
      const { new_due_date } = req.body;
      
      if (!new_due_date) {
        return res.status(400).json({ message: 'New due date is required' });
      }
      
      // Check if the borrowing exists and is not already returned
      const [borrowingResult] = await pool.query(`
        SELECT status, due_date FROM borrowings WHERE borrowing_id = ?
      `, [borrowingId]);
      
      if (borrowingResult.length === 0) {
        return res.status(404).json({ message: 'Borrowing record not found' });
      }
      
      if (borrowingResult[0].status === 'returned') {
        return res.status(400).json({ message: 'Cannot extend returned book' });
      }
      
      // Validate that new due date is after current due date
      const currentDueDate = new Date(borrowingResult[0].due_date);
      const newDueDate = new Date(new_due_date);
      
      if (newDueDate <= currentDueDate) {
        return res.status(400).json({ 
          message: 'New due date must be after current due date' 
        });
      }
      
      // Update the due date
      await pool.query(`
        UPDATE borrowings SET
          due_date = ?,
          status = CASE 
            WHEN status = 'overdue' THEN 'borrowed'
            ELSE status
          END
        WHERE borrowing_id = ?
      `, [new_due_date, borrowingId]);
      
      res.status(200).json({ message: 'Due date extended successfully' });
    } catch (error) {
      console.error('Error extending due date:', error);
      res.status(500).json({ message: 'Error extending due date', error: error.message });
    }
  });

  // Update overdue borrowings
  router.post('/update-overdue', async (req, res) => {
    try {
      // Update status of overdue books
      const [result] = await pool.query(`
        UPDATE borrowings
        SET status = 'overdue'
        WHERE due_date < CURDATE()
        AND status = 'borrowed'
      `);
      
      res.status(200).json({ 
        message: 'Overdue status updated', 
        updated_count: result.affectedRows 
      });
    } catch (error) {
      console.error('Error updating overdue status:', error);
      res.status(500).json({ message: 'Error updating overdue status', error: error.message });
    }
  });

  // Calculate fines for overdue books
  router.post('/calculate-fines', async (req, res) => {
    try {
      const { fine_per_day } = req.body;
      const dailyFine = fine_per_day || 1.00; // Default 1 zł per day
      
      // Calculate and update fines
      const [result] = await pool.query(`
        UPDATE borrowings
        SET fine_amount = DATEDIFF(CURDATE(), due_date) * ?
        WHERE status = 'overdue'
        AND return_date IS NULL
      `, [dailyFine]);
      
      res.status(200).json({ 
        message: 'Fines calculated', 
        updated_count: result.affectedRows 
      });
    } catch (error) {
      console.error('Error calculating fines:', error);
      res.status(500).json({ message: 'Error calculating fines', error: error.message });
    }
  });

  return router;
};
// File: routes/members.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  // Get all members with pagination and filtering
  router.get('/', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      
      const searchTerm = req.query.search || '';
      const status = req.query.status;
      const sortBy = req.query.sort_by || 'last_name';
      const sortOrder = req.query.sort_order || 'ASC';
      
      // Validate sort parameters to prevent SQL injection
      const validSortFields = ['last_name', 'first_name', 'registration_date', 'membership_status'];
      const validSortOrders = ['ASC', 'DESC'];
      
      const actualSortBy = validSortFields.includes(sortBy) ? sortBy : 'last_name';
      const actualSortOrder = validSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder : 'ASC';
      
      let query = `
        SELECT m.*,
               (SELECT COUNT(*) FROM borrowings 
                WHERE member_id = m.member_id AND status IN ('borrowed', 'overdue')) AS active_loans,
               (SELECT COUNT(*) FROM borrowings 
                WHERE member_id = m.member_id AND status = 'overdue') AS overdue_books
        FROM members m
      `;
      
      const parameters = [];
      
      // Add search condition if needed
      const conditions = [];
      
      if (searchTerm) {
        conditions.push(`(CONCAT(m.first_name, ' ', m.last_name) LIKE ? OR m.email LIKE ?)`);
        parameters.push(`%${searchTerm}%`, `%${searchTerm}%`);
      }
      
      if (status) {
        conditions.push(`m.membership_status = ?`);
        parameters.push(status);
      }
      
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }
      
      // Add sorting and pagination
      query += ` ORDER BY m.${actualSortBy} ${actualSortOrder} LIMIT ? OFFSET ?`;
      parameters.push(limit, offset);
      
      // Get total count for pagination
      let countQuery = `SELECT COUNT(*) AS total FROM members m`;
      
      if (conditions.length > 0) {
        countQuery += ` WHERE ${conditions.join(' AND ')}`;
      }
      
      const [members] = await pool.query(query, parameters);
      const [countResult] = await pool.query(countQuery, parameters.slice(0, -2));
      const totalCount = countResult[0].total;
      
      res.status(200).json({
        members,
        pagination: {
          total: totalCount,
          page,
          limit,
          pages: Math.ceil(totalCount / limit)
        }
      });
    } catch (error) {
      console.error('Error getting members:', error);
      res.status(500).json({ message: 'Error retrieving members', error: error.message });
    }
  });

  // Get member by ID with their borrowing history
  router.get('/:id', async (req, res) => {
    try {
      const memberId = req.params.id;
      
      // Get member info
      const [members] = await pool.query(`
        SELECT * FROM members WHERE member_id = ?
      `, [memberId]);
      
      if (members.length === 0) {
        return res.status(404).json({ message: 'Member not found' });
      }
      
      const member = members[0];
      
      // Get current borrowings
      const [currentBorrowings] = await pool.query(`
        SELECT b.borrowing_id, b.borrow_date, b.due_date, b.status,
               bk.book_id, bk.title, bk.isbn,
               DATEDIFF(b.due_date, CURDATE()) AS days_remaining
        FROM borrowings b
        JOIN books bk ON b.book_id = bk.book_id
        WHERE b.member_id = ? AND b.status IN ('borrowed', 'overdue')
        ORDER BY b.due_date ASC
      `, [memberId]);
      
      // Get borrowing history
      const [borrowingHistory] = await pool.query(`
        SELECT b.borrowing_id, b.borrow_date, b.return_date, b.status,
               bk.book_id, bk.title, bk.isbn
        FROM borrowings b
        JOIN books bk ON b.book_id = bk.book_id
        WHERE b.member_id = ? AND b.status = 'returned'
        ORDER BY b.return_date DESC
        LIMIT 10
      `, [memberId]);
      
      // Get total fines
      const [fines] = await pool.query(`
        SELECT SUM(fine_amount) AS total_fines
        FROM borrowings
        WHERE member_id = ?
      `, [memberId]);
      
      member.current_borrowings = currentBorrowings;
      member.borrowing_history = borrowingHistory;
      member.total_fines = fines[0].total_fines || 0;
      
      res.status(200).json(member);
    } catch (error) {
      console.error('Error getting member:', error);
      res.status(500).json({ message: 'Error retrieving member', error: error.message });
    }
  });

  // Create a new member
  router.post('/', async (req, res) => {
    try {
      const { 
        first_name, last_name, email, phone, 
        address, registration_date, membership_status 
      } = req.body;
      
      // Check if email already exists
      const [emailCheck] = await pool.query(`
        SELECT member_id FROM members WHERE email = ?
      `, [email]);
      
      if (emailCheck.length > 0) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      
      const [result] = await pool.query(`
        INSERT INTO members (
          first_name, last_name, email, phone, 
          address, registration_date, membership_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        first_name, 
        last_name, 
        email, 
        phone, 
        address, 
        registration_date || new Date().toISOString().split('T')[0], // Default to current date
        membership_status || 'active'
      ]);
      
      res.status(201).json({ 
        message: 'Member created successfully',
        member_id: result.insertId
      });
    } catch (error) {
      console.error('Error creating member:', error);
      res.status(500).json({ message: 'Error creating member', error: error.message });
    }
  });

  // Update a member
  router.put('/:id', async (req, res) => {
    try {
      const memberId = req.params.id;
      const { 
        first_name, last_name, email, phone, 
        address, membership_status 
      } = req.body;
      
      // Check if member exists
      const [memberCheck] = await pool.query(`
        SELECT member_id FROM members WHERE member_id = ?
      `, [memberId]);
      
      if (memberCheck.length === 0) {
        return res.status(404).json({ message: 'Member not found' });
      }
      
      // Check if email already exists for another member
      if (email) {
        const [emailCheck] = await pool.query(`
          SELECT member_id FROM members WHERE email = ? AND member_id != ?
        `, [email, memberId]);
        
        if (emailCheck.length > 0) {
          return res.status(400).json({ message: 'Email already in use by another member' });
        }
      }
      
      await pool.query(`
        UPDATE members SET
          first_name = ?,
          last_name = ?,
          email = ?,
          phone = ?,
          address = ?,
          membership_status = ?
        WHERE member_id = ?
      `, [
        first_name, 
        last_name, 
        email, 
        phone, 
        address, 
        membership_status,
        memberId
      ]);
      
      res.status(200).json({ message: 'Member updated successfully' });
    } catch (error) {
      console.error('Error updating member:', error);
      res.status(500).json({ message: 'Error updating member', error: error.message });
    }
  });

  // Delete a member
  router.delete('/:id', async (req, res) => {
    try {
      const memberId = req.params.id;
      
      // Check if the member has active borrowings
      const [borrowingsCheck] = await pool.query(`
        SELECT COUNT(*) AS count
        FROM borrowings
        WHERE member_id = ? AND status IN ('borrowed', 'overdue')
      `, [memberId]);
      
      if (borrowingsCheck[0].count > 0) {
        return res.status(400).json({ 
          message: 'Cannot delete member with active borrowings'
        });
      }
      
      // Delete the member
      const [result] = await pool.query(`
        DELETE FROM members WHERE member_id = ?
      `, [memberId]);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Member not found' });
      }
      
      res.status(200).json({ message: 'Member deleted successfully' });
    } catch (error) {
      console.error('Error deleting member:', error);
      res.status(500).json({ message: 'Error deleting member', error: error.message });
    }
  });

  // Get member's borrowing history
  router.get('/:id/borrowings', async (req, res) => {
    try {
      const memberId = req.params.id;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const status = req.query.status;
      
      // Check if member exists
      const [memberCheck] = await pool.query(`
        SELECT member_id FROM members WHERE member_id = ?
      `, [memberId]);
      
      if (memberCheck.length === 0) {
        return res.status(404).json({ message: 'Member not found' });
      }
      
      let query = `
        SELECT b.borrowing_id, b.borrow_date, b.due_date, b.return_date, 
               b.fine_amount, b.status,
               bk.book_id, bk.title, bk.isbn
        FROM borrowings b
        JOIN books bk ON b.book_id = bk.book_id
        WHERE b.member_id = ?
      `;
      
      const parameters = [memberId];
      
      if (status) {
        query += ` AND b.status = ?`;
        parameters.push(status);
      }
      
      query += ` ORDER BY b.borrow_date DESC LIMIT ? OFFSET ?`;
      parameters.push(limit, offset);
      
      // Get total count for pagination
      let countQuery = `
        SELECT COUNT(*) AS total FROM borrowings WHERE member_id = ?
      `;
      
      const countParams = [memberId];
      
      if (status) {
        countQuery += ` AND status = ?`;
        countParams.push(status);
      }
      
      const [borrowings] = await pool.query(query, parameters);
      const [countResult] = await pool.query(countQuery, countParams);
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
      console.error('Error getting member borrowings:', error);
      res.status(500).json({ message: 'Error retrieving member borrowings', error: error.message });
    }
  });

  // Update member status
  router.put('/:id/status', async (req, res) => {
    try {
      const memberId = req.params.id;
      const { membership_status } = req.body;
      
      if (!membership_status) {
        return res.status(400).json({ message: 'Membership status is required' });
      }
      
      // Validate membership status
      const validStatuses = ['active', 'expired', 'suspended'];
      if (!validStatuses.includes(membership_status)) {
        return res.status(400).json({ 
          message: 'Invalid status. Must be one of: active, expired, suspended'
        });
      }
      
      // Update member status
      const [result] = await pool.query(`
        UPDATE members SET membership_status = ? WHERE member_id = ?
      `, [membership_status, memberId]);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Member not found' });
      }
      
      res.status(200).json({ message: 'Member status updated successfully' });
    } catch (error) {
      console.error('Error updating member status:', error);
      res.status(500).json({ message: 'Error updating member status', error: error.message });
    }
  });

  return router;
};
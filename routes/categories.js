// File: routes/categories.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  // Get all categories with pagination and search
  router.get('/', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      
      const searchTerm = req.query.search || '';
      
      let query = `
        SELECT cat.category_id, cat.name, cat.description, 
               COUNT(bc.book_id) AS book_count
        FROM categories cat
        LEFT JOIN book_categories bc ON cat.category_id = bc.category_id
      `;
      
      const parameters = [];
      
      // Add grouping and pagination
      query += ` GROUP BY cat.category_id ORDER BY cat.name LIMIT ? OFFSET ?`;
      parameters.push(limit, offset);
      
      // Get total count for pagination
      let countQuery = `SELECT COUNT(*) AS total FROM categories`;
      
      const [categories] = await pool.query(query, parameters);
      const [countResult] = await pool.query(
        countQuery, 
        searchTerm ? [`%${searchTerm}%`] : []
      );
      const totalCount = countResult[0].total;
      
      res.status(200).json({
        categories,
        pagination: {
          total: totalCount,
          page,
          limit,
          pages: Math.ceil(totalCount / limit)
        }
      });
    } catch (error) {
      console.error('Błąd przy wybieraniu kategorii', error);
      res.status(500).json({ message: 'Błąd przy wybieraniu kategorii', error: error.message });
    }
  });

  // Create a new category
  router.post('/', async (req, res) => {
    try {
      const { name, description } = req.body;
      
      const [result] = await pool.query(`
        INSERT INTO categories (name, description)
        VALUES (?, ?)
      `, [name, description]);
      
      res.status(201).json({ 
        message: 'Kategoria pomyślnie utworzona',
        publisher_id: result.insertId
      });
    } catch (error) {
      console.error('Błąd przy tworzeniu kategorii:', error);
      res.status(500).json({ message: 'Błąd przy tworzeniu kategorii', error: error.message });
    }
  });
  
  // Delete a category
  router.delete('/:id', async (req, res) => {
    try {
      const categoryId = req.params.id;
      
      // Check if the category has books
      const [booksCheck] = await pool.query(`
        SELECT COUNT(*) AS count FROM book_categories WHERE category_id = ?
      `, [categoryId]);
      
      if (booksCheck[0].count > 0) {
        return res.status(400).json({ 
          message: 'Cannot delete category with associated books'
        });
      }
      
      // Delete the category
      const [result] = await pool.query(`
        DELETE FROM categories WHERE category_id = ?
      `, [categoryId]);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Category not found' });
      }
      
      res.status(200).json({ message: 'Category deleted successfully' });
    } catch (error) {
      console.error('Error deleting category:', error);
      res.status(500).json({ message: 'Error deleting category', error: error.message });
    }
  });
  
  // Update a category
  router.put('/:id', async (req, res) => {
    try {
      const categoryId = req.params.id;
      const { 
        name, description
      } = req.body;
      
      // Check if category name exists
      const [categoryCheck] = await pool.query(`
        SELECT category_id FROM categories WHERE category_id = ?
      `, [categoryId]);
      
      if (categoryCheck.length === 0) {
        return res.status(404).json({ message: 'Category not found' });
      }
      
      await pool.query(`
        UPDATE categories SET
          name = ?,
          description = ?
        WHERE category_id = ?
      `, [
        name, 
        description,
        categoryId
      ]);
      
      res.status(200).json({ message: 'Category updated successfully' });
    } catch (error) {
      console.error('Error updating category:', error);
      res.status(500).json({ message: 'Error updating category', error: error.message });
    }
  });
  
  
  // Get category by ID
  router.get('/:id', async (req, res) => {
    try {
      const categoryId = req.params.id;
      
      // Get category info
      const [categories] = await pool.query(`
        SELECT * FROM categories WHERE category_id = ?
      `, [categoryId]);
      
      if (categories.length === 0) {
        return res.status(404).json({ message: 'Category not found' });
      }
      
      const category = categories[0];
      
      res.status(200).json(category);
    } catch (error) {
      console.error('Error getting category:', error);
      res.status(500).json({ message: 'Error retrieving category', error: error.message });
    }
  });

  return router;
};
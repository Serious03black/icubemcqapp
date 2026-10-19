const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { isGuest } = require('../middleware/auth');

// GET Login Page
router.get('/login', isGuest, (req, res) => {
  res.render('login', { title: 'Login - TechMinds MCQ' });
});

// POST Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      req.flash('error', 'Please provide email and password');
      return res.redirect('/login');
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      req.flash('error', 'Invalid email or password');
      return res.redirect('/login');
    }

    if (!user.isActive) {
      req.flash('error', 'Your account has been deactivated. Contact admin.');
      return res.redirect('/login');
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      req.flash('error', 'Invalid email or password');
      return res.redirect('/login');
    }

    // Store user in session
    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      course: user.course
    };

    req.flash('success', `Welcome back, ${user.name}!`);

    if (user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    }
    res.redirect('/student/dashboard');

  } catch (err) {
    console.error('Login Error:', err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/login');
  }
});

// GET Logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout Error:', err);
    res.redirect('/login');
  });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { isGuest } = require('../middleware/auth');

// GET Login Page (Student)
router.get('/login', isGuest, (req, res) => {
  res.render('login', { title: 'Login - TechMinds MCQ', isAdmin: false });
});

// GET Admin Login Page (access via /admin/login)
router.get('/admin/login', isGuest, (req, res) => {
  res.render('login', { title: 'Admin Login - TechMinds MCQ', isAdmin: true });
});

// POST Login (handles both student and admin via hidden flag)
router.post('/login', async (req, res) => {
  try {
    const { email, password, loginAs } = req.body;

    if (!email || !password) {
      req.flash('error', 'Please provide email and password');
      return res.redirect(loginAs === 'admin' ? '/admin/login' : '/login');
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      req.flash('error', 'Invalid email or password');
      return res.redirect(loginAs === 'admin' ? '/admin/login' : '/login');
    }

    if (!user.isActive) {
      req.flash('error', 'Your account has been deactivated. Contact admin.');
      return res.redirect(loginAs === 'admin' ? '/admin/login' : '/login');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      req.flash('error', 'Invalid email or password');
      return res.redirect(loginAs === 'admin' ? '/admin/login' : '/login');
    }

    // If login is attempted via admin page, enforce admin role
    if (loginAs === 'admin' && user.role !== 'admin') {
      req.flash('error', 'Admin credentials required');
      return res.redirect('/admin/login');
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

    // Redirect based on role or login flag
    if (user.role === 'admin' || loginAs === 'admin') {
      return res.redirect('/admin/dashboard');
    }
    res.redirect('/student/dashboard');

  } catch (err) {
    console.error('Login Error:', err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect(loginAs === 'admin' ? '/admin/login' : '/login');
  }
});

// GET Signup Page
router.get('/signup', isGuest, (req, res) => {
  res.render('signup', { title: 'Sign Up - TechMinds MCQ', isAdmin: false });
});

// POST Signup (create new student account)
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, course } = req.body;
    if (!name || !email || !password) {
      req.flash('error', 'All fields are required');
      return res.redirect('/signup');
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      req.flash('error', 'Email already registered');
      return res.redirect('/signup');
    }
    const user = new User({ name, email, password, role: 'student', course });
    await user.save();
    req.flash('success', 'Account created successfully. Please log in.');
    res.redirect('/login');
  } catch (err) {
    console.error('Signup Error:', err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/signup');
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

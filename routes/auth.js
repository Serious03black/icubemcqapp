const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { isGuest } = require('../middleware/auth');

// GET Login Page (Student)
router.get('/login', isGuest, (req, res) => {
  res.render('login', { title: 'Login - ICUBE Info Solution', isAdmin: false });
});

// GET Admin Login Page (access via /admin/login)
router.get('/admin/login', isGuest, (req, res) => {
  res.render('login', { title: 'Admin Login - ICUBE Info Solution', isAdmin: true });
});

// POST Login (handles both student and admin via hidden flag)
router.post('/login', async (req, res) => {
  const fromExam = req.headers.referer && req.headers.referer.includes('/exam');
  const getLoginRedirect = (isAdminFlag) => {
    if (isAdminFlag) return '/admin/login';
    return fromExam ? '/exam#auth' : '/login';
  };

  try {
    const { email, password, loginAs } = req.body;

    if (!email || !password) {
      req.flash('error', 'Please provide email and password');
      return res.redirect(getLoginRedirect(loginAs === 'admin'));
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      req.flash('error', 'Invalid email or password');
      return res.redirect(getLoginRedirect(loginAs === 'admin'));
    }

    if (!user.isActive) {
      req.flash('error', 'Your account has been deactivated. Contact admin.');
      return res.redirect(getLoginRedirect(loginAs === 'admin'));
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      req.flash('error', 'Invalid email or password');
      return res.redirect(getLoginRedirect(loginAs === 'admin'));
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
    res.redirect(getLoginRedirect(loginAs === 'admin'));
  }
});

// GET Signup Page
router.get('/signup', isGuest, (req, res) => {
  res.render('signup', { title: 'Sign Up - ICUBE Info Solution', isAdmin: false });
});

// POST Signup (create new student account)
router.post('/signup', async (req, res) => {
  const fromExam = req.headers.referer && req.headers.referer.includes('/exam');
  const failureRedirect = fromExam ? '/exam?signup=1#auth' : '/signup';
  const successRedirect = fromExam ? '/exam#auth' : '/login';

  try {
    const { name, email, password, course } = req.body;
    if (!name || !email || !password) {
      req.flash('error', 'All fields are required');
      return res.redirect(failureRedirect);
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      req.flash('error', 'Email already registered');
      return res.redirect(failureRedirect);
    }
    const user = new User({ name, email, password, role: 'student', course });
    await user.save();
    req.flash('success', 'Account created successfully. Please log in.');
    res.redirect(successRedirect);
  } catch (err) {
    console.error('Signup Error:', err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect(failureRedirect);
  }
});

// GET Logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout Error:', err);
    res.redirect('/exam');
  });
});

module.exports = router;

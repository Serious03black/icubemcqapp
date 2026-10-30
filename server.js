require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');

// Global Process Crash Prevention
process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception caught:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();

// Path to compiled React website
const localDistPath = path.join(__dirname, 'client-dist');
const monorepoDistPath = path.join(__dirname, '..', 'icube-solutions-website-main', 'icube-solutions-website-main', 'dist');
const websiteDistPath = fs.existsSync(localDistPath) ? localDistPath : monorepoDistPath;

// Database Connection with resilient timeouts and auto-reconnect
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000
  })
    .then(() => console.log('✅ MongoDB Connected Successfully'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err.message));

  mongoose.connection.on('error', err => {
    console.error('⚠️ MongoDB connection runtime error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB disconnected. Mongoose will attempt to reconnect...');
  });
} else {
  console.error('❌ MONGODB_URI is not defined in environment variables.');
}

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware & Static Files
app.use(express.static(path.join(__dirname, 'public')));
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));
if (fs.existsSync(websiteDistPath)) {
  app.use(express.static(websiteDistPath));
}
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// Session Store with anti-crash error handler and lazy touch (prevents DB overload on refreshes)
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  touchAfter: 24 * 3600, // Update session once in 24 hours unless data changes (prevents MongoDB write overload on refresh)
  ttl: 24 * 60 * 60,     // 24 hours
  mongoOptions: {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000
  }
});

sessionStore.on('error', (err) => {
  console.error('⚠️ MongoStore Session Store Error (caught):', err.message);
});

// Session Middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'techminds_mcq_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    httpOnly: true,
    sameSite: 'lax'
  }
}));

app.use(flash());

// Global variables for flash messages and user with safe guards
app.use((req, res, next) => {
  try {
    res.locals.success_msg = req.flash ? req.flash('success') : [];
    res.locals.error_msg = req.flash ? req.flash('error') : [];
    res.locals.currentUser = (req.session && req.session.user) ? req.session.user : null;
  } catch (err) {
    res.locals.success_msg = [];
    res.locals.error_msg = [];
    res.locals.currentUser = null;
  }
  next();
});

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const studentRoutes = require('./routes/student');

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/student', studentRoutes);

// Test App Assessment Route (/exam)
app.get('/exam', (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    }
    return res.redirect('/student/dashboard');
  }
  // Render test app landing page for unauthenticated visitors
  res.render('landing', { title: 'Candidate Skill Assessment - ICUBE Info Solution', landingData: {} });
});

// React Landing Website handler
const serveReactWebsite = (req, res) => {
  const indexPath = path.join(websiteDistPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath, (err) => {
      if (err && !res.headersSent) {
        if (err.code !== 'ECONNABORTED' && err.syscall !== 'write') {
          console.error('Error sending React website:', err.message);
        }
      }
    });
  }
  // Fallback if website is not built yet
  if (req.session && req.session.user) {
    if (req.session.user.role === 'admin') return res.redirect('/admin/dashboard');
    return res.redirect('/student/dashboard');
  }
  res.render('landing', { title: 'Welcome - ICUBE Info Solution', landingData: {} });
};

// React website routes
app.get(['/', '/about', '/services', '/contact'], serveReactWebsite);

// 404 handler
app.use((req, res) => {
  // If exam or backend route, render 404 EJS page
  if (req.path.startsWith('/admin') || req.path.startsWith('/student') || req.path === '/exam' || req.path === '/login' || req.path === '/signup' || req.path === '/terms' || req.path === '/terms-and-conditions') {
    return res.status(404).render('404', { title: '404 - Page Not Found' });
  }

  // If GET request for any other path, fallback to React app
  const indexPath = path.join(websiteDistPath, 'index.html');
  if (req.method === 'GET' && fs.existsSync(indexPath)) {
    return res.sendFile(indexPath, (err) => {
      if (err && !res.headersSent) {
        if (err.code !== 'ECONNABORTED' && err.syscall !== 'write') {
          console.error('Error serving index.html on fallback:', err.message);
        }
      }
    });
  }

  res.status(404).render('404', { title: '404 - Page Not Found' });
});

// Global Express Error Handling Middleware (Catches any unexpected route/render errors)
app.use((err, req, res, next) => {
  console.error('🚨 Express Application Error Caught:', err);

  if (res.headersSent) {
    return next(err);
  }

  // Render 404/500 template for user-friendly error
  try {
    return res.status(500).render('404', { title: 'Error - ICUBE Info Solution' });
  } catch (renderErr) {
    return res.status(500).send('An unexpected error occurred. Please refresh the page or return to Home.');
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 ICUBE Info Solution App running on http://localhost:${PORT}`);
});

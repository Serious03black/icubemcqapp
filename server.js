require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');

const fs = require('fs');

const app = express();

// Path to compiled React website
const localDistPath = path.join(__dirname, 'client-dist');
const monorepoDistPath = path.join(__dirname, '..', 'icube-solutions-website-main', 'icube-solutions-website-main', 'dist');
const websiteDistPath = fs.existsSync(localDistPath) ? localDistPath : monorepoDistPath;

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware & Static Files
app.use(express.static(path.join(__dirname, 'public')));
if (fs.existsSync(websiteDistPath)) {
  app.use(express.static(websiteDistPath));
}
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI
  }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 hours
}));

app.use(flash());

// Global variables for flash messages and user
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success');
  res.locals.error_msg = req.flash('error');
  res.locals.currentUser = req.session.user || null;
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
  if (req.session.user) {
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
    return res.sendFile(indexPath);
  }
  // Fallback if website is not built yet
  if (req.session.user) {
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
  if (req.path.startsWith('/admin') || req.path.startsWith('/student') || req.path === '/exam' || req.path === '/login' || req.path === '/signup') {
    return res.status(404).render('404', { title: '404 - Page Not Found' });
  }

  // If GET request for any other path, fallback to React app
  const indexPath = path.join(websiteDistPath, 'index.html');
  if (req.method === 'GET' && fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  res.status(404).render('404', { title: '404 - Page Not Found' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 ICUBE Info Solution App running on http://localhost:${PORT}`);
});

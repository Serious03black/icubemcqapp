// Authentication middleware
module.exports = {
  isAuthenticated: (req, res, next) => {
    if (req.session && req.session.user) {
      return next();
    }
    req.flash('error', 'Please login to continue');
    res.redirect('/login');
  },

  isAdmin: (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
      return next();
    }
    req.flash('error', 'Access denied. Admin privileges required.');
    res.redirect('/login');
  },

  isStudent: (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'student') {
      return next();
    }
    req.flash('error', 'Access denied. Student access only.');
    res.redirect('/login');
  },

  isGuest: (req, res, next) => {
    if (req.session && req.session.user) {
      if (req.session.user.role === 'admin') {
        return res.redirect('/admin/dashboard');
      }
      return res.redirect('/student/dashboard');
    }
    next();
  }
};

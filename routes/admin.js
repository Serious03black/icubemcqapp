const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const User = require('../models/User');
const Test = require('../models/Test');
const Result = require('../models/Result');
const Payment = require('../models/Payment');
const { isAdmin } = require('../middleware/auth');

const fs = require('fs');

// Multer config for Excel uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    cb(null, `questions_${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls, .csv) are allowed'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Multer config for Question Image uploads
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `q_img_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  }
});

const uploadImage = multer({
  storage: imageStorage,
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext) || (file.mimetype && file.mimetype.startsWith('image/'))) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, GIF, WebP, SVG) are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Apply admin middleware to all routes
router.use(isAdmin);

// ==================== CERTIFICATION TEST CREATION ====================
// GET form to create a JavaScript certification exam with predefined settings
router.get('/certification/create', (req, res) => {
  // Render a form with defaults; price is omitted intentionally
  res.render('admin/create-certification', {
    title: 'Create JavaScript Certification Exam',
    default: {
      title: 'JavaScript Fundamentals Certification',
      description: 'A comprehensive certification covering JavaScript fundamentals, ES6+ features, modern programming concepts, DOM manipulation, and asynchronous programming patterns.',
      course: 'JavaScript',
      duration: 45,
      passingPercentage: 80,
      questionCount: 30
    }
  });
});

// POST handler to create the test with predefined fields (price omitted)
router.post('/certification/create', async (req, res) => {
  try {
    const { title, description, course, duration, passingPercentage, questionCount } = req.body;
    // Calculate passingMarks later when total marks known; store percentage for reference
    const test = new Test({
      title: title || 'JavaScript Fundamentals Certification',
      description: description || '',
      course: course || 'JavaScript',
      duration: parseInt(duration) || 45,
      // Store passing criteria as percentage, will be used when evaluating results
      passingPercentage: parseInt(passingPercentage) || 80,
      // Optional fields for predefining expected number of questions
      expectedQuestionCount: parseInt(questionCount) || 30,
      createdBy: req.session.user.id,
      isActive: false // Admin can activate after adding questions
    });
    await test.save();
    req.flash('success', `Certification test "${test.title}" created! Add questions and then activate.`);
    res.redirect('/admin/tests');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create certification test');
    res.redirect('/admin/certification/create');
  }
});

// ==================== DASHBOARD ====================
router.get('/dashboard', async (req, res) => {
  try {
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalTests = await Test.countDocuments();
    const totalResults = await Result.countDocuments();
    const activeTests = await Test.countDocuments({ isActive: true });
    const totalPayments = await Payment.countDocuments();
    const paymentAgg = await Payment.aggregate([{ $group: { _id: null, sum: { $sum: "$amount" } } }]);
    const totalCollected = paymentAgg[0] ? paymentAgg[0].sum : 0;

    const recentTests = await Test.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('createdBy', 'name');

    const recentStudents = await User.find({ role: 'student' })
      .sort({ createdAt: -1 })
      .limit(5);

    const recentResults = await Result.find()
      .sort({ submittedAt: -1 })
      .limit(5)
      .populate('student', 'name email')
      .populate('test', 'title');

    const recentPayments = await Payment.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('student', 'name email')
      .populate('test', 'title');

    res.render('admin/dashboard', {
      title: 'Admin Dashboard - TechMinds',
      totalStudents,
      totalTests,
      totalResults,
      activeTests,
      totalPayments,
      totalCollected,
      recentTests,
      recentStudents,
      recentResults,
      recentPayments
    });
  } catch (err) {
    console.error('Dashboard Error:', err);
    req.flash('error', 'Failed to load dashboard');
    res.redirect('/login');
  }
});

// ==================== STUDENT MANAGEMENT ====================
router.get('/students', async (req, res) => {
  try {
    const students = await User.find({ role: 'student' })
      .sort({ createdAt: -1 })
      .populate('assignedTests', 'title course');
    res.render('admin/students', {
      title: 'Manage Students - TechMinds',
      students
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load students');
    res.redirect('/admin/dashboard');
  }
});

router.get('/students/create', (req, res) => {
  res.render('admin/create-student', {
    title: 'Create Student - TechMinds'
  });
});

router.post('/students/create', async (req, res) => {
  try {
    const { name, email, password, course, phone } = req.body;

    // Duplicate check (email is unique – prevents double-save on POST replay)
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      // If created in last 5 seconds, it's a duplicate submit — redirect silently
      const fiveSecsAgo = new Date(Date.now() - 5000);
      if (existingUser.createdAt >= fiveSecsAgo) {
        req.flash('success', `Student "${existingUser.name}" created successfully!`);
        return res.redirect('/admin/students');
      }
      req.flash('error', 'A user with this email already exists');
      return res.redirect('/admin/students/create');
    }

    const student = new User({
      name,
      email,
      password,
      role: 'student',
      course,
      phone,
      createdBy: req.session.user.id
    });

    await student.save();
    req.flash('success', `Student "${name}" created successfully!`);
    res.redirect('/admin/students');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create student');
    res.redirect('/admin/students/create');
  }
});

router.get('/students/:id/edit', async (req, res) => {
  try {
    const student = await User.findById(req.params.id);
    if (!student || student.role !== 'student') {
      req.flash('error', 'Student not found');
      return res.redirect('/admin/students');
    }
    res.render('admin/edit-student', {
      title: 'Edit Student - TechMinds',
      student
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load student');
    res.redirect('/admin/students');
  }
});

router.post('/students/:id/edit', async (req, res) => {
  try {
    const { name, email, course, phone, isActive } = req.body;
    const updateData = { name, email, course, phone, isActive: isActive === 'on' };

    if (req.body.password && req.body.password.trim() !== '') {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(12);
      updateData.password = await bcrypt.hash(req.body.password, salt);
    }

    await User.findByIdAndUpdate(req.params.id, updateData);
    req.flash('success', 'Student updated successfully!');
    res.redirect('/admin/students');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update student');
    res.redirect('/admin/students');
  }
});

router.post('/students/:id/delete', async (req, res) => {
  try {
    await Result.deleteMany({ student: req.params.id });
    await Test.updateMany({}, { $pull: { assignedTo: req.params.id } });
    await User.findByIdAndDelete(req.params.id);
    req.flash('success', 'Student deleted successfully!');
    res.redirect('/admin/students');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete student');
    res.redirect('/admin/students');
  }
});

// ==================== TEST MANAGEMENT ====================
router.get('/tests', async (req, res) => {
  try {
    const tests = await Test.find()
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name')
      .populate('assignedTo', 'name email');
    res.render('admin/tests', {
      title: 'Manage Tests - TechMinds',
      tests
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load tests');
    res.redirect('/admin/dashboard');
  }
});

router.get('/tests/create', (req, res) => {
  res.render('admin/create-test', {
    title: 'Create Test - TechMinds'
  });
});

router.post('/tests/create', async (req, res) => {
  try {
    const { title, description, course, duration, passingMarks, originalPrice, price, subTests: rawSubTests } = req.body;

    // ── Idempotency: prevent double-save if form replays ──
    // Check if a test with same title was already created by this admin in the last 10 seconds
    const tenSecsAgo = new Date(Date.now() - 10000);
    const duplicate = await Test.findOne({
      title: title.trim(),
      createdBy: req.session.user.id,
      createdAt: { $gte: tenSecsAgo }
    });
    if (duplicate) {
      req.flash('success', `Test "${title}" already created! Redirecting to questions.`);
      return res.redirect(`/admin/tests/${duplicate._id}/questions`);
    }

    // Convert the object map { '0': {...}, '1': {...} } into an ordered array
    let subTests = [];
    if (rawSubTests && typeof rawSubTests === 'object') {
      subTests = Object.keys(rawSubTests)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(key => {
          const st = rawSubTests[key];
          return {
            name: st.name || '',
            description: st.description || '',
            questionCount: parseInt(st.questionCount) || undefined,
            type: st.type || 'mcq',
            questions: []
          };
        })
        .filter(st => st.name.trim() !== '');
    }

    const test = new Test({
      title,
      description,
      course,
      duration: parseInt(duration) || 30,
      passingMarks: parseInt(passingMarks) || 0,
      originalPrice: parseFloat(originalPrice) || 0,
      price: parseFloat(price) || 0,
      createdBy: req.session.user.id,
      questions: [],
      subTests
    });

    await test.save();
    req.flash('success', `Test "${title}" created! Now upload questions for each sub-test.`);
    res.redirect(`/admin/tests/${test._id}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create test');
    res.redirect('/admin/tests/create');
  }
});

router.get('/tests/:id/edit', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }
    res.render('admin/edit-test', {
      title: 'Edit Test - TechMinds',
      test
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load test');
    res.redirect('/admin/tests');
  }
});

router.post('/tests/:id/edit', async (req, res) => {
  try {
    const { title, description, course, duration, passingMarks, originalPrice, price, isActive, subTests: rawSubTests } = req.body;

    const test = await Test.findById(req.params.id);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }

    // Update basic fields
    test.title        = title;
    test.description  = description;
    test.course       = course;
    test.duration     = parseInt(duration) || 30;
    test.passingMarks = parseInt(passingMarks) || 0;
    test.originalPrice = parseFloat(originalPrice) || 0;
    test.price         = parseFloat(price) || 0;
    test.isActive      = isActive === 'on';

    // Merge sub-tests: keep existing questions for sub-tests with matching _id
    if (rawSubTests && typeof rawSubTests === 'object') {
      const incoming = Object.keys(rawSubTests)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(key => rawSubTests[key])
        .filter(st => st.name && st.name.trim() !== '');

      const updatedSubTests = incoming.map(st => {
        if (st._id) {
          const existing = test.subTests.id(st._id);
          if (existing) {
            // Update metadata, keep questions intact
            existing.name          = st.name;
            existing.description   = st.description || '';
            existing.questionCount = parseInt(st.questionCount) || undefined;
            existing.type          = st.type || 'mcq';
            return existing.toObject();
          }
        }
        // Brand new sub-test
        return {
          name: st.name,
          description: st.description || '',
          questionCount: parseInt(st.questionCount) || undefined,
          type: st.type || 'mcq',
          questions: []
        };
      });

      test.subTests = updatedSubTests;
    } else {
      test.subTests = [];
    }

    await test.save();
    req.flash('success', 'Test updated successfully!');
    res.redirect(`/admin/tests/${test._id}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update test');
    res.redirect('/admin/tests');
  }
});

// Update test pricing directly (used when adding questions)
router.post('/tests/:id/pricing', async (req, res) => {
  try {
    const { originalPrice, price } = req.body;
    const test = await Test.findById(req.params.id);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }
    test.originalPrice = parseFloat(originalPrice) || 0;
    test.price = parseFloat(price) || 0;
    await test.save();
    req.flash('success', 'Pricing updated successfully!');
    res.redirect(`/admin/tests/${test._id}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update pricing');
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  }
});

router.post('/tests/:id/delete', async (req, res) => {
  try {
    await Result.deleteMany({ test: req.params.id });
    await User.updateMany({}, { $pull: { assignedTests: req.params.id } });
    await Test.findByIdAndDelete(req.params.id);
    req.flash('success', 'Test deleted successfully!');
    res.redirect('/admin/tests');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete test');
    res.redirect('/admin/tests');
  }
});

router.post('/tests/:id/toggle', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    test.isActive = !test.isActive;
    await test.save();
    req.flash('success', `Test ${test.isActive ? 'activated' : 'deactivated'} successfully!`);
    res.redirect('/admin/tests');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to toggle test status');
    res.redirect('/admin/tests');
  }
});

// ==================== QUESTION MANAGEMENT ====================
router.get('/tests/:id/questions', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }
    res.render('admin/questions', {
      title: `Questions - ${test.title}`,
      test
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load questions');
    res.redirect('/admin/tests');
  }
});

// Add single question
router.post('/tests/:id/questions/add', uploadImage.single('questionImage'), async (req, res) => {
  try {
    const { questionText, type, optionA, optionB, optionC, optionD, correctOption, marks } = req.body;
    let imageUrl = req.body.imageUrl ? req.body.imageUrl.trim() : '';
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const qType = (type === 'coding' || type === 'code') ? 'coding' : 'mcq';

    // Must have either question text or image
    if (!questionText && !imageUrl) {
      req.flash('error', 'Please provide either question text or a question image.');
      return res.redirect(`/admin/tests/${req.params.id}/questions`);
    }

    const test = await Test.findById(req.params.id);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }

    test.questions.push({
      type: qType,
      questionText: (questionText || '').trim(),
      imageUrl,
      marks: parseInt(marks) || 1,
      optionA: qType === 'coding' ? '' : (optionA || '').trim(),
      optionB: qType === 'coding' ? '' : (optionB || '').trim(),
      optionC: qType === 'coding' ? '' : (optionC || '').trim(),
      optionD: qType === 'coding' ? '' : (optionD || '').trim(),
      correctOption: qType === 'coding' ? '' : (correctOption || '').trim().toUpperCase()
    });

    await test.save();
    req.flash('success', `${qType === 'coding' ? 'Coding' : 'MCQ'} question added successfully!`);
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to add question: ' + err.message);
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  }
});

// Edit question (flat test)
router.get('/tests/:testId/questions/:qId/edit', async (req, res) => {
  try {
    const test = await Test.findById(req.params.testId);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }
    const question = test.questions.id(req.params.qId);
    if (!question) {
      req.flash('error', 'Question not found');
      return res.redirect(`/admin/tests/${req.params.testId}/questions`);
    }
    res.render('admin/edit-question', {
      title: 'Edit Question - TechMinds',
      test,
      subTest: null,
      question
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load question');
    res.redirect('/admin/tests');
  }
});

router.post('/tests/:testId/questions/:qId/edit', uploadImage.single('questionImage'), async (req, res) => {
  try {
    const { questionText, type, optionA, optionB, optionC, optionD, correctOption, marks } = req.body;
    const test = await Test.findById(req.params.testId);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }
    const question = test.questions.id(req.params.qId);
    if (!question) {
      req.flash('error', 'Question not found');
      return res.redirect(`/admin/tests/${req.params.testId}/questions`);
    }

    const qType = (type === 'coding' || type === 'code') ? 'coding' : 'mcq';
    let imageUrl = question.imageUrl || '';
    if (req.body.imageUrl !== undefined) {
      imageUrl = req.body.imageUrl.trim();
    }
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    question.type = qType;
    question.questionText = (questionText || '').trim();
    question.imageUrl = imageUrl;
    question.marks = parseInt(marks) || 1;
    question.optionA = qType === 'coding' ? '' : (optionA || '').trim();
    question.optionB = qType === 'coding' ? '' : (optionB || '').trim();
    question.optionC = qType === 'coding' ? '' : (optionC || '').trim();
    question.optionD = qType === 'coding' ? '' : (optionD || '').trim();
    question.correctOption = qType === 'coding' ? '' : (correctOption || '').trim().toUpperCase();

    await test.save();
    req.flash('success', 'Question updated successfully!');
    res.redirect(`/admin/tests/${req.params.testId}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update question: ' + err.message);
    res.redirect(`/admin/tests/${req.params.testId}/questions`);
  }
});

// Delete question (flat test)
router.post('/tests/:testId/questions/:qId/delete', async (req, res) => {
  try {
    const test = await Test.findById(req.params.testId);
    test.questions.pull(req.params.qId);
    await test.save();
    req.flash('success', 'Question removed successfully!');
    res.redirect(`/admin/tests/${req.params.testId}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete question');
    res.redirect(`/admin/tests/${req.params.testId}/questions`);
  }
});

// Upload questions via Excel
router.post('/tests/:id/questions/upload', upload.single('excelFile'), async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error', 'Please upload an Excel file');
      return res.redirect(`/admin/tests/${req.params.id}/questions`);
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      req.flash('error', 'Excel file is empty');
      return res.redirect(`/admin/tests/${req.params.id}/questions`);
    }

    const test = await Test.findById(req.params.id);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }

    let addedCount = 0;
    let errorCount = 0;

    for (const row of data) {
      const question = row['Question'] || row['question'] || row['QuestionText'] || row['questionText'] || '';
      const img = (row['Image'] || row['image'] || row['ImageUrl'] || row['imageUrl'] || row['Image URL'] || '').toString().trim();
      const qTypeRaw = (row['Type'] || row['type'] || '').toString().toLowerCase().trim();
      const isCode = qTypeRaw === 'code' || qTypeRaw === 'coding';
      const marks = parseInt(row['Marks'] || row['marks'] || 1);

      if (isCode && (question || img)) {
        test.questions.push({
          type: 'coding',
          questionText: question.toString().trim(),
          imageUrl: img,
          optionA: '',
          optionB: '',
          optionC: '',
          optionD: '',
          correctOption: '',
          marks: marks || 1
        });
        addedCount++;
      } else {
        const optA = row['Option A'] || row['optionA'] || row['OptionA'] || row['A'];
        const optB = row['Option B'] || row['optionB'] || row['OptionB'] || row['B'];
        const optC = row['Option C'] || row['optionC'] || row['OptionC'] || row['C'];
        const optD = row['Option D'] || row['optionD'] || row['OptionD'] || row['D'];
        const correct = (row['Correct Option'] || row['correctOption'] || row['CorrectOption'] || row['Answer'] || row['answer'] || '').toString().toUpperCase().trim();

        if ((question || img) && optA && optB && optC && optD && ['A', 'B', 'C', 'D'].includes(correct)) {
          test.questions.push({
            type: 'mcq',
            questionText: question ? question.toString().trim() : '',
            imageUrl: img,
            optionA: optA.toString().trim(),
            optionB: optB.toString().trim(),
            optionC: optC.toString().trim(),
            optionD: optD.toString().trim(),
            correctOption: correct,
            marks: marks || 1
          });
          addedCount++;
        } else {
          errorCount++;
        }
      }
    }

    await test.save();

    // Clean up uploaded file
    const fs = require('fs');
    fs.unlink(req.file.path, () => {});

    let message = `${addedCount} questions uploaded successfully!`;
    if (errorCount > 0) {
      message += ` ${errorCount} rows skipped due to invalid data.`;
    }

    req.flash('success', message);
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to process Excel file. Check format.');
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  }
});

// ── Upload questions via Excel into a specific sub-test ──
router.post('/tests/:id/subtests/:stId/upload', upload.single('excelFile'), async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error', 'Please upload an Excel file');
      return res.redirect(`/admin/tests/${req.params.id}/questions`);
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      req.flash('error', 'Excel file is empty');
      return res.redirect(`/admin/tests/${req.params.id}/questions`);
    }

    const test = await Test.findById(req.params.id);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }

    const subTest = test.subTests.id(req.params.stId);
    if (!subTest) {
      req.flash('error', 'Sub-test not found');
      return res.redirect(`/admin/tests/${req.params.id}/questions`);
    }

    let addedCount = 0, errorCount = 0;
    for (const row of data) {
      const question = row['Question'] || row['question'] || row['QuestionText'] || row['questionText'] || '';
      const img = (row['Image'] || row['image'] || row['ImageUrl'] || row['imageUrl'] || row['Image URL'] || '').toString().trim();
      const qTypeRaw = (row['Type'] || row['type'] || '').toString().toLowerCase().trim();
      const isCode = qTypeRaw === 'code' || qTypeRaw === 'coding' || subTest.type === 'code' || subTest.type === 'coding';
      const marks = parseInt(row['Marks'] || row['marks'] || 1);

      if (isCode && (question || img)) {
        subTest.questions.push({
          type: 'coding',
          questionText: question.toString().trim(),
          imageUrl: img,
          optionA: '',
          optionB: '',
          optionC: '',
          optionD: '',
          correctOption: '',
          marks: marks || 1
        });
        addedCount++;
      } else {
        const optA = row['Option A'] || row['optionA'] || row['OptionA'] || row['A'];
        const optB = row['Option B'] || row['optionB'] || row['OptionB'] || row['B'];
        const optC = row['Option C'] || row['optionC'] || row['OptionC'] || row['C'];
        const optD = row['Option D'] || row['optionD'] || row['OptionD'] || row['D'];
        const correct = (row['Correct Option'] || row['correctOption'] || row['CorrectOption'] || row['Answer'] || row['answer'] || '').toString().toUpperCase().trim();

        if ((question || img) && optA && optB && optC && optD && ['A','B','C','D'].includes(correct)) {
          subTest.questions.push({
            type: 'mcq',
            questionText: question ? question.toString().trim() : '',
            imageUrl: img,
            optionA: optA.toString().trim(),
            optionB: optB.toString().trim(),
            optionC: optC.toString().trim(),
            optionD: optD.toString().trim(),
            correctOption: correct,
            marks: marks || 1
          });
          addedCount++;
        } else {
          errorCount++;
        }
      }
    }

    await test.save();

    const fs = require('fs');
    fs.unlink(req.file.path, () => {});

    let message = `${addedCount} questions added to "${subTest.name}"!`;
    if (errorCount > 0) message += ` ${errorCount} rows skipped.`;
    req.flash('success', message);
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to process Excel file.');
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  }
});

// ── Add single question directly into a specific sub-test ──
router.post('/tests/:id/subtests/:stId/questions/add', uploadImage.single('questionImage'), async (req, res) => {
  try {
    const { questionText, type, optionA, optionB, optionC, optionD, correctOption, marks } = req.body;
    let imageUrl = req.body.imageUrl ? req.body.imageUrl.trim() : '';
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const test = await Test.findById(req.params.id);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }

    const subTest = test.subTests.id(req.params.stId);
    if (!subTest) {
      req.flash('error', 'Sub-test not found');
      return res.redirect(`/admin/tests/${req.params.id}/questions`);
    }

    const qType = (type === 'coding' || type === 'code' || subTest.type === 'code' || subTest.type === 'coding') ? 'coding' : 'mcq';

    if (!questionText && !imageUrl) {
      req.flash('error', 'Please provide question text or an image.');
      return res.redirect(`/admin/tests/${req.params.id}/questions`);
    }

    subTest.questions.push({
      type: qType,
      questionText: (questionText || '').trim(),
      imageUrl,
      marks: parseInt(marks) || 1,
      optionA: qType === 'coding' ? '' : (optionA || '').trim(),
      optionB: qType === 'coding' ? '' : (optionB || '').trim(),
      optionC: qType === 'coding' ? '' : (optionC || '').trim(),
      optionD: qType === 'coding' ? '' : (optionD || '').trim(),
      correctOption: qType === 'coding' ? '' : (correctOption || '').trim().toUpperCase()
    });

    await test.save();
    req.flash('success', `${qType === 'coding' ? 'Coding' : 'MCQ'} question added to "${subTest.name}"!`);
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to add question: ' + err.message);
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  }
});

// ── Edit a question from a specific sub-test ──
router.get('/tests/:testId/subtests/:stId/questions/:qId/edit', async (req, res) => {
  try {
    const test = await Test.findById(req.params.testId);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }
    const subTest = test.subTests.id(req.params.stId);
    if (!subTest) {
      req.flash('error', 'Sub-test not found');
      return res.redirect(`/admin/tests/${req.params.testId}/questions`);
    }
    const question = subTest.questions.id(req.params.qId);
    if (!question) {
      req.flash('error', 'Question not found');
      return res.redirect(`/admin/tests/${req.params.testId}/questions`);
    }

    res.render('admin/edit-question', {
      title: 'Edit Question - TechMinds',
      test,
      subTest,
      question
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load question');
    res.redirect('/admin/tests');
  }
});

router.post('/tests/:testId/subtests/:stId/questions/:qId/edit', uploadImage.single('questionImage'), async (req, res) => {
  try {
    const { questionText, type, optionA, optionB, optionC, optionD, correctOption, marks } = req.body;
    const test = await Test.findById(req.params.testId);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }
    const subTest = test.subTests.id(req.params.stId);
    if (!subTest) {
      req.flash('error', 'Sub-test not found');
      return res.redirect(`/admin/tests/${req.params.testId}/questions`);
    }
    const question = subTest.questions.id(req.params.qId);
    if (!question) {
      req.flash('error', 'Question not found');
      return res.redirect(`/admin/tests/${req.params.testId}/questions`);
    }

    const qType = (type === 'coding' || type === 'code') ? 'coding' : 'mcq';
    let imageUrl = question.imageUrl || '';
    if (req.body.imageUrl !== undefined) {
      imageUrl = req.body.imageUrl.trim();
    }
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    question.type = qType;
    question.questionText = (questionText || '').trim();
    question.imageUrl = imageUrl;
    question.marks = parseInt(marks) || 1;
    question.optionA = qType === 'coding' ? '' : (optionA || '').trim();
    question.optionB = qType === 'coding' ? '' : (optionB || '').trim();
    question.optionC = qType === 'coding' ? '' : (optionC || '').trim();
    question.optionD = qType === 'coding' ? '' : (optionD || '').trim();
    question.correctOption = qType === 'coding' ? '' : (correctOption || '').trim().toUpperCase();

    await test.save();
    req.flash('success', 'Sub-test question updated successfully!');
    res.redirect(`/admin/tests/${req.params.testId}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update question: ' + err.message);
    res.redirect(`/admin/tests/${req.params.testId}/questions`);
  }
});

// ── Delete a question from a specific sub-test ──
router.post('/tests/:id/subtests/:stId/questions/:qId/delete', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    const subTest = test.subTests.id(req.params.stId);
    if (subTest) {
      subTest.questions.pull(req.params.qId);
      await test.save();
      req.flash('success', 'Question removed.');
    }
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete question.');
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  }
});

// ==================== ASSIGN TESTS ====================
router.get('/tests/:id/assign', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id).populate('assignedTo', 'name email course');
    const students = await User.find({ role: 'student', isActive: true }).sort({ name: 1 });

    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }

    res.render('admin/assign-test', {
      title: `Assign Test - ${test.title}`,
      test,
      students
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load assignment page');
    res.redirect('/admin/tests');
  }
});

router.post('/tests/:id/assign', async (req, res) => {
  try {
    let { studentIds } = req.body;

    if (!studentIds) {
      req.flash('error', 'Please select at least one student');
      return res.redirect(`/admin/tests/${req.params.id}/assign`);
    }

    // Ensure it's an array
    if (!Array.isArray(studentIds)) {
      studentIds = [studentIds];
    }

    const test = await Test.findById(req.params.id);
    test.assignedTo = studentIds;
    await test.save();

    // Update each student's assignedTests
    // First remove this test from all students
    await User.updateMany(
      { role: 'student' },
      { $pull: { assignedTests: test._id } }
    );

    // Then add to selected students
    await User.updateMany(
      { _id: { $in: studentIds } },
      { $addToSet: { assignedTests: test._id } }
    );

    req.flash('success', `Test assigned to ${studentIds.length} student(s) successfully!`);
    res.redirect('/admin/tests');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to assign test');
    res.redirect(`/admin/tests/${req.params.id}/assign`);
  }
});

// ==================== RESULTS ====================
router.get('/results', async (req, res) => {
  try {
    const results = await Result.find()
      .sort({ submittedAt: -1 })
      .populate('student', 'name email course')
      .populate('test', 'title course totalMarks passingMarks');

    res.render('admin/results', {
      title: 'Test Results - TechMinds',
      results
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load results');
    res.redirect('/admin/dashboard');
  }
});

router.get('/results/:id', async (req, res) => {
  try {
    const result = await Result.findById(req.params.id)
      .populate('student', 'name email course')
      .populate('test');

    if (!result) {
      req.flash('error', 'Result not found');
      return res.redirect('/admin/results');
    }

    res.render('admin/result-detail', {
      title: 'Result Details - TechMinds',
      result
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load result details');
    res.redirect('/admin/results');
  }
});

// ==================== RE-ASSIGN TEST (allow student to retake) ====================
router.post('/results/:id/reassign', async (req, res) => {
  try {
    const result = await Result.findById(req.params.id)
      .populate('student', 'name')
      .populate('test', 'title');

    if (!result) {
      req.flash('error', 'Result not found');
      return res.redirect('/admin/results');
    }

    const studentName = result.student ? result.student.name : 'Unknown';
    const testTitle = result.test ? result.test.title : 'Unknown';

    // Delete the result so the student can retake the test
    await Result.findByIdAndDelete(req.params.id);

    req.flash('success', `✅ Result deleted! "${studentName}" can now retake "${testTitle}".`);
    res.redirect('/admin/results');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to re-assign test');
    res.redirect('/admin/results');
  }
});

module.exports = router;


const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const User = require('../models/User');
const Test = require('../models/Test');
const Result = require('../models/Result');
const { isAdmin } = require('../middleware/auth');

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

// Apply admin middleware to all routes
router.use(isAdmin);

// ==================== DASHBOARD ====================
router.get('/dashboard', async (req, res) => {
  try {
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalTests = await Test.countDocuments();
    const totalResults = await Result.countDocuments();
    const activeTests = await Test.countDocuments({ isActive: true });

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

    res.render('admin/dashboard', {
      title: 'Admin Dashboard - TechMinds',
      totalStudents,
      totalTests,
      totalResults,
      activeTests,
      recentTests,
      recentStudents,
      recentResults
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

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
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
    const { title, description, course, duration, passingMarks } = req.body;

    const test = new Test({
      title,
      description,
      course,
      duration: parseInt(duration) || 30,
      passingMarks: parseInt(passingMarks) || 0,
      createdBy: req.session.user.id,
      questions: []
    });

    await test.save();
    req.flash('success', `Test "${title}" created! Now add questions.`);
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
    const { title, description, course, duration, passingMarks, isActive } = req.body;
    await Test.findByIdAndUpdate(req.params.id, {
      title,
      description,
      course,
      duration: parseInt(duration) || 30,
      passingMarks: parseInt(passingMarks) || 0,
      isActive: isActive === 'on'
    });
    req.flash('success', 'Test updated successfully!');
    res.redirect('/admin/tests');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update test');
    res.redirect('/admin/tests');
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
router.post('/tests/:id/questions/add', async (req, res) => {
  try {
    const { questionText, optionA, optionB, optionC, optionD, correctOption, marks } = req.body;
    const test = await Test.findById(req.params.id);

    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/admin/tests');
    }

    test.questions.push({
      questionText,
      optionA,
      optionB,
      optionC,
      optionD,
      correctOption,
      marks: parseInt(marks) || 1
    });

    await test.save();
    req.flash('success', 'Question added successfully!');
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to add question');
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  }
});

// Edit question
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
      question
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load question');
    res.redirect('/admin/tests');
  }
});

router.post('/tests/:testId/questions/:qId/edit', async (req, res) => {
  try {
    const { questionText, optionA, optionB, optionC, optionD, correctOption, marks } = req.body;
    const test = await Test.findById(req.params.testId);
    const question = test.questions.id(req.params.qId);

    question.questionText = questionText;
    question.optionA = optionA;
    question.optionB = optionB;
    question.optionC = optionC;
    question.optionD = optionD;
    question.correctOption = correctOption;
    question.marks = parseInt(marks) || 1;

    await test.save();
    req.flash('success', 'Question updated successfully!');
    res.redirect(`/admin/tests/${req.params.testId}/questions`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update question');
    res.redirect(`/admin/tests/${req.params.testId}/questions`);
  }
});

// Delete question
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
      const question = row['Question'] || row['question'] || row['QuestionText'] || row['questionText'];
      const optA = row['Option A'] || row['optionA'] || row['OptionA'] || row['A'];
      const optB = row['Option B'] || row['optionB'] || row['OptionB'] || row['B'];
      const optC = row['Option C'] || row['optionC'] || row['OptionC'] || row['C'];
      const optD = row['Option D'] || row['optionD'] || row['OptionD'] || row['D'];
      const correct = (row['Correct Option'] || row['correctOption'] || row['CorrectOption'] || row['Answer'] || row['answer'] || '').toString().toUpperCase().trim();
      const marks = parseInt(row['Marks'] || row['marks'] || 1);

      if (question && optA && optB && optC && optD && ['A', 'B', 'C', 'D'].includes(correct)) {
        test.questions.push({
          questionText: question.toString().trim(),
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

module.exports = router;

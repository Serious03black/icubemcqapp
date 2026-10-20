const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Test = require('../models/Test');
const Razorpay = require('razorpay');
const Result = require('../models/Result');
const { isStudent } = require('../middleware/auth');

// Apply student middleware
router.use(isStudent);

// ==================== DASHBOARD ====================
router.get('/dashboard', async (req, res) => {
  try {
    const student = await User.findById(req.session.user.id)
      .populate({
        path: 'assignedTests',
        match: { isActive: true }
      });

    const completedResults = await Result.find({ student: req.session.user.id })
      .populate('test', 'title course totalMarks passingMarks');

    const completedTestIds = completedResults.map(r => r.test?._id?.toString());
    const assignedTests = student.assignedTests || [];
    const pendingTests = assignedTests.filter(t => !completedTestIds.includes(t._id.toString()));

    res.render('student/dashboard', {
      title: 'Student Dashboard - TechMinds',
      student,
      pendingTests,
      completedResults,
      totalAssigned: assignedTests.length,
      totalCompleted: completedResults.length,
      totalPending: pendingTests.length
    });
  } catch (err) {
    console.error('Student Dashboard Error:', err);
    req.flash('error', 'Failed to load dashboard');
    res.redirect('/login');
  }
});

// ==================== TAKE TEST ====================
router.get('/test/:id', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);

    if (!test || !test.isActive) {
      req.flash('error', 'Test not available');
      return res.redirect('/student/dashboard');
    }

    // Ensure payment has been made before allowing test access
    const paidTests = req.session.paidTests || [];
    if (!paidTests.includes(test._id.toString())) {
      // Redirect to payment page
      return res.redirect(`/student/pay/${test._id}`);
    }

    // Check if already submitted
    const existingResult = await Result.findOne({
      student: req.session.user.id,
      test: test._id
    });

    if (existingResult) {
      req.flash('error', 'You have already submitted this test');
      return res.redirect('/student/dashboard');
    }

    // Check if test is assigned to student
    const student = await User.findById(req.session.user.id);
    if (!student.assignedTests.includes(test._id.toString())) {
      req.flash('error', 'This test is not assigned to you');
      return res.redirect('/student/dashboard');
    }

    // Fisher-Yates shuffle
    function shuffle(array) {
      let current = array.length, random;
      while (current !== 0) {
        random = Math.floor(Math.random() * current);
        current--;
        [array[current], array[random]] = [array[random], array[current]];
      }
      return array;
    }

    // Build sections from subTests (or fall back to flat questions)
    let sections = [];
    let allQuestionIds = [];

    if (test.subTests && test.subTests.length > 0) {
      sections = test.subTests.map(st => {
        const pool = [...(st.questions || [])];
        const count = (st.questionCount && st.questionCount > 0 && st.questionCount < pool.length)
          ? st.questionCount : pool.length;
        const selected = shuffle(pool).slice(0, count);

        selected.forEach(q => allQuestionIds.push(q._id.toString()));

        return {
          _id: st._id,
          name: st.name,
          type: st.type || 'mcq',
          description: st.description || '',
          questions: selected
        };
      });
    } else {
      // Legacy flat questions
      const pool = [...test.questions];
      const requestedCount = parseInt(req.query.count) || test.questionCount || 30;
      const count = (requestedCount > 0 && requestedCount < pool.length) ? requestedCount : pool.length;
      const selected = shuffle(pool).slice(0, count);

      selected.forEach(q => allQuestionIds.push(q._id.toString()));

      sections = [{
        _id: 'flat',
        name: test.title,
        type: 'mcq',
        description: '',
        questions: selected
      }];
    }

    // Store in session for submission verification
    req.session.currentTest = {
      testId: test._id.toString(),
      questionIds: allQuestionIds
    };

    // Count total questions across sections
    const totalQuestions = sections.reduce((sum, s) => sum + s.questions.length, 0);
    const totalMarks = sections.reduce((sum, s) =>
      sum + s.questions.reduce((qs, q) => qs + (q.marks || 1), 0), 0);

    res.render('student/take-test', {
      title: `${test.title} - TechMinds`,
      test: test.toObject(),
      sections,
      totalQuestions,
      totalMarks
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load test');
    res.redirect('/student/dashboard');
  }
});

// Submit test
router.post('/test/:id/submit', async (req, res) => {
  try {
    // Validate that the student is submitting the same test they were given
    if (!req.session.currentTest || req.session.currentTest.testId !== req.params.id) {
      req.flash('error', 'Session mismatch. Please restart the test.');
      return res.redirect('/student/dashboard');
    }

    const test = await Test.findById(req.params.id);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/student/dashboard');
    }

    // Check if already submitted
    const existingResult = await Result.findOne({
      student: req.session.user.id,
      test: test._id
    });
    if (existingResult) {
      req.flash('error', 'You have already submitted this test');
      return res.redirect('/student/dashboard');
    }

    const { timeTaken } = req.body;
    const answers = [];
    let obtainedMarks = 0;
    let totalMarks = 0;

    // Collect all questions from both flat and sub-test pools
    const selectedIds = req.session.currentTest.questionIds;

    // Build a map of question ID → { question, sectionType }
    const questionMap = new Map();

    // Flat questions (legacy)
    for (const q of test.questions) {
      if (selectedIds.includes(q._id.toString())) {
        questionMap.set(q._id.toString(), { question: q, sectionType: 'mcq' });
      }
    }

    // Sub-test questions
    for (const st of (test.subTests || [])) {
      for (const q of (st.questions || [])) {
        if (selectedIds.includes(q._id.toString())) {
          questionMap.set(q._id.toString(), { question: q, sectionType: st.type || 'mcq' });
        }
      }
    }

    for (const [qId, { question, sectionType }] of questionMap) {
      const submittedAnswer = req.body[`q_${question._id}`] || '';
      const qMarks = question.marks || 1;
      totalMarks += qMarks;

      if (sectionType === 'code' || question.type === 'code') {
        // Code/programming answer — stored as text, admin grades manually
        answers.push({
          questionId: question._id,
          selectedOption: submittedAnswer,  // textarea text
          isCorrect: false,                 // admin grades later
          marks: 0
        });
      } else {
        // MCQ — auto-grade
        const isCorrect = submittedAnswer === question.correctOption;
        const marks = isCorrect ? qMarks : 0;
        if (isCorrect) obtainedMarks += marks;

        answers.push({
          questionId: question._id,
          selectedOption: submittedAnswer,
          isCorrect,
          marks
        });
      }
    }

    const percentage = totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 100) : 0;

    const result = new Result({
      student: req.session.user.id,
      test: test._id,
      answers,
      totalMarks,
      obtainedMarks,
      percentage,
      isPassed: obtainedMarks >= test.passingMarks,
      timeTaken: parseInt(timeTaken) || 0
    });

    await result.save();
    delete req.session.currentTest;
    req.flash('success', 'Test submitted successfully!');
    res.redirect('/student/dashboard');
  } catch (err) {
    console.error(err);
    if (err.code === 11000) {
      req.flash('error', 'You have already submitted this test');
    } else {
      req.flash('error', 'Failed to submit test');
    }
    res.redirect('/student/dashboard');
  }
});

// ==================== RESULTS (Blocked for students — admin only) ====================
// Payment page – render Razorpay checkout
router.get('/pay/:id', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/student/dashboard');
    }
    // Razorpay key from env (public key)
    const razorpayKey = process.env.RAZORPAY_KEY_ID || '';
    res.render('student/payment', { title: 'Pay for Test', test, razorpayKey });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Unable to load payment page');
    res.redirect('/student/dashboard');
  }
});

// Handle payment verification (placeholder – assume success)
router.post('/pay/:id', async (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
  // In real implementation verify signature with Razorpay secret
  // Mark test as paid in session
  const paidTests = req.session.paidTests || [];
  if (!paidTests.includes(req.params.id)) {
    paidTests.push(req.params.id);
    req.session.paidTests = paidTests;
  }
  // Record payment in DB
  const Payment = require('../models/Payment');
  const test = await Test.findById(req.params.id);
  if (test) {
    await Payment.create({
      student: req.session.user.id,
      test: test._id,
      amount: test.price,
      paymentId: razorpay_payment_id
    });
  }
  req.flash('success', 'Payment successful! You can now start the test.');
  res.redirect(`/student/test/${req.params.id}`);
});
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
  // In real implementation verify signature with Razorpay secret
  // For now, mark test as paid in session
  const paidTests = req.session.paidTests || [];
  if (!paidTests.includes(req.params.id)) {
    paidTests.push(req.params.id);
    req.session.paidTests = paidTests;
  }
  req.flash('success', 'Payment successful! You can now start the test.');
  res.redirect(`/student/test/${req.params.id}`);
});

router.get('/results', (req, res) => {
  req.flash('info', 'Results are only visible to the admin.');
  res.redirect('/student/dashboard');
});

router.get('/results/:id', (req, res) => {
  req.flash('info', 'Results are only visible to the admin.');
  res.redirect('/student/dashboard');
});

// ==================== EXAM HISTORY ====================
// Student can view their exam attempts and results
router.get('/history', async (req, res) => {
  try {
    const results = await Result.find({ student: req.session.user.id })
      .sort({ submittedAt: -1 })
      .populate('test', 'title course');
    res.render('student/history', { title: 'My Exam History', results });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load exam history');
    res.redirect('/student/dashboard');
  }
});

module.exports = router;


const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Test = require('../models/Test');
const Razorpay = require('razorpay');
const Result = require('../models/Result');
const Payment = require('../models/Payment');
const { isStudent } = require('../middleware/auth');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_live_TqZBXaoUiElbST',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'pPcdEDdMnukUnZlaa8AtI5hT'
});


// Apply student middleware
router.use(isStudent);

// ==================== DASHBOARD ====================
router.get('/dashboard', async (req, res) => {
  try {
    const student = await User.findById(req.session.user.id);

    // All active tests are available for all candidates to view and attempt
    const allTests = await Test.find({ isActive: true }).sort({ createdAt: -1 });

    const completedResults = await Result.find({ student: req.session.user.id })
      .populate('test', 'title course totalMarks passingMarks');

    const completedTestIds = completedResults
      .map(r => r.test?._id?.toString())
      .filter(Boolean);

    // Available assessments not yet completed by this candidate
    const pendingTests = allTests.filter(t => !completedTestIds.includes(t._id.toString()));

    res.render('student/dashboard', {
      title: 'Candidate Dashboard - ICUBE Info Solution',
      student,
      pendingTests,
      completedResults,
      totalAssigned: allTests.length,
      totalCompleted: completedResults.length,
      totalPending: pendingTests.length
    });
  } catch (err) {
    console.error('Student Dashboard Error:', err);
    req.flash('error', 'Failed to load dashboard');
    res.redirect('/login');
  }
});

// ==================== BROWSE TESTS ====================
router.get('/tests', async (req, res) => {
  try {
    const allTests = await Test.find({ isActive: true }).sort({ createdAt: -1 });
    const completedResults = await Result.find({ student: req.session.user.id })
      .select('test');
    const completedTestIds = completedResults.map(r => r.test?.toString()).filter(Boolean);

    res.render('student/tests', {
      title: 'Browse Assessments - ICUBE Info Solution',
      tests: allTests,
      completedTestIds
    });
  } catch (err) {
    console.error('Browse Tests Error:', err);
    req.flash('error', 'Failed to load tests');
    res.redirect('/student/dashboard');
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

    // Ensure payment has been made before allowing test access if price > 0
    if (test.price && test.price > 0) {
      const paidTests = req.session.paidTests || [];
      if (!paidTests.includes(test._id.toString())) {
        return res.redirect(`/student/pay/${test._id}`);
      }
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
      title: `${test.title} - ICUBE Info Solution`,
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

      if (sectionType === 'code' || sectionType === 'coding' || question.type === 'code' || question.type === 'coding') {
        // Code/programming answer — stored as text, admin grades manually
        answers.push({
          questionId: question._id,
          selectedOption: submittedAnswer,  // textarea text
          codeAnswer: submittedAnswer,
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

// ==================== PAYMENT ====================
// Step 1: Render payment page
router.get('/pay/:id', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    if (!test) {
      req.flash('error', 'Test not found');
      return res.redirect('/student/dashboard');
    }
    if (!test.price || test.price <= 0) {
      // Free test — no payment needed
      return res.redirect(`/student/test/${test._id}`);
    }
    const razorpayKey = process.env.RAZORPAY_KEY_ID || '';
    res.render('student/payment', { title: 'Pay for Test', test, razorpayKey });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Unable to load payment page');
    res.redirect('/student/dashboard');
  }
});

// Step 2: Create Razorpay Order (called via fetch from frontend)
router.post('/pay/:id/order', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    if (!test) return res.status(404).json({ error: 'Test not found' });

    const order = await razorpay.orders.create({
      amount: Math.round(test.price * 100), // paise
      currency: 'INR',
      receipt: `receipt_${req.session.user.id}_${test._id}`.substring(0, 40),
      notes: {
        testId: test._id.toString(),
        studentId: req.session.user.id
      }
    });

    res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error('Razorpay order error:', err);
    res.status(500).json({ error: err.error?.description || err.message || 'Failed to create order' });
  }
});

// Step 3: Verify payment signature & grant access
router.post('/pay/:id/verify', express.json(), async (req, res) => {
  try {
    const crypto = require('crypto');
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Verify HMAC signature
    const secret = process.env.RAZORPAY_KEY_SECRET || 'pPcdEDdMnukUnZlaa8AtI5hT';
    const generated = crypto
      .createHmac('sha256', secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generated !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed. Signature mismatch.' });
    }

    // Mark test as paid in session
    const paidTests = req.session.paidTests || [];
    if (!paidTests.includes(req.params.id)) {
      paidTests.push(req.params.id);
      req.session.paidTests = paidTests;
    }

    // Record payment in DB
    const test = await Test.findById(req.params.id);
    if (test) {
      await Payment.create({
        student: req.session.user.id,
        test: test._id,
        amount: test.price,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id
      });
    }

    res.json({ success: true, redirect: `/student/test/${req.params.id}` });
  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ error: 'Verification failed. Please contact support.' });
  }
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


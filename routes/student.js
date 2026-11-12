const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Test = require('../models/Test');
const Result = require('../models/Result');
const Payment = require('../models/Payment');
const { isStudent } = require('../middleware/auth');

// Cashfree Configuration
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || '1480186f08f28fafb5daae45cb46810841';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || 'cfsk_ma_prod_58bfc2c44b66b8c722d21af1397bd683_01a8e06c';
const CASHFREE_ENV = process.env.CASHFREE_ENV || 'production';
const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || '2023-08-01';
const CASHFREE_BASE_URL = CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

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

    // Check all tests candidate has paid for
    const userPayments = await Payment.find({ student: req.session.user.id }).select('test');
    const paidTestIds = userPayments.map(p => p.test?.toString()).filter(Boolean);

    // Also include tests assigned free by admin so student never pays
    allTests.forEach(t => {
      const isAssigned = t.assignedTo && t.assignedTo.some(id => 
        (id._id ? id._id.toString() : id.toString()) === req.session.user.id.toString()
      );
      if (isAssigned && !paidTestIds.includes(t._id.toString())) {
        paidTestIds.push(t._id.toString());
      }
    });

    // Available assessments not yet completed by this candidate
    const pendingTests = allTests.filter(t => !completedTestIds.includes(t._id.toString()));

    res.render('student/dashboard', {
      title: 'Candidate Dashboard - ICUBE Info Solution',
      student,
      pendingTests,
      completedResults,
      paidTestIds,
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

    // Check all tests candidate has paid for
    const userPayments = await Payment.find({ student: req.session.user.id }).select('test');
    const paidTestIds = userPayments.map(p => p.test?.toString()).filter(Boolean);

    // Also include tests assigned free by admin so student never pays
    allTests.forEach(t => {
      const isAssigned = t.assignedTo && t.assignedTo.some(id => 
        (id._id ? id._id.toString() : id.toString()) === req.session.user.id.toString()
      );
      if (isAssigned && !paidTestIds.includes(t._id.toString())) {
        paidTestIds.push(t._id.toString());
      }
    });

    res.render('student/tests', {
      title: 'Browse Assessments - ICUBE Info Solution',
      tests: allTests,
      completedTestIds,
      paidTestIds
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

    // Check if test was explicitly assigned to this candidate by admin (grants 100% free access)
    const isAssignedByAdmin = test.assignedTo && test.assignedTo.some(id => 
      (id._id ? id._id.toString() : id.toString()) === req.session.user.id.toString()
    );

    // Ensure payment has been made before allowing test access if price > 0 and not assigned free
    if (test.price && test.price > 0 && !isAssignedByAdmin) {
      // 1. Check permanent database payment record first
      const paidInDb = await Payment.findOne({
        student: req.session.user.id,
        test: test._id
      });

      const paidTests = req.session.paidTests || [];
      const paidInSession = paidTests.includes(test._id.toString());

      if (!paidInDb && !paidInSession) {
        return res.redirect(`/student/pay/${test._id}`);
      }

      // Sync session if paid in DB
      if (paidInDb && !paidInSession) {
        paidTests.push(test._id.toString());
        req.session.paidTests = paidTests;
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

    // Check if student already has an active ongoing attempt for this test (resuming after refresh)
    req.session.activeAttempts = req.session.activeAttempts || {};
    const testIdStr = test._id.toString();
    let existingAttempt = req.session.activeAttempts[testIdStr];

    const testDuration = parseInt(test.duration) || 30;

    // Check if ongoing attempt has expired while away (abandoned/glitch) OR test was reset by admin
    if (existingAttempt && existingAttempt.startedAt) {
      const elapsed = Math.max(0, Math.floor((Date.now() - existingAttempt.startedAt) / 1000));
      const remaining = (testDuration * 60) - elapsed;
      const testReset = test.updatedAt && new Date(test.updatedAt).getTime() > existingAttempt.startedAt;
      if (remaining <= 0 || testReset) {
        delete req.session.activeAttempts[testIdStr];
        existingAttempt = null;
      }
    }
    let sections = [];
    let allQuestionIds = [];
    let initialElapsedSeconds = 0;
    let initialRemainingSeconds = testDuration * 60;
    let isResumed = false;

    if (existingAttempt && existingAttempt.startedAt && Array.isArray(existingAttempt.sections) && existingAttempt.sections.length > 0) {
      // Resume existing ongoing exam attempt
      isResumed = true;
      sections = existingAttempt.sections;
      allQuestionIds = existingAttempt.questionIds || [];
      initialElapsedSeconds = Math.max(0, Math.floor((Date.now() - existingAttempt.startedAt) / 1000));
      initialRemainingSeconds = Math.max(0, (testDuration * 60) - initialElapsedSeconds);
    } else {
      // First-time exam creation
      if (test.subTests && test.subTests.length > 0) {
        sections = test.subTests.map(st => {
          const pool = [...(st.questions || [])];
          const count = (st.questionCount && st.questionCount > 0 && st.questionCount < pool.length)
            ? st.questionCount : pool.length;
          const selected = shuffle(pool).slice(0, count);

          selected.forEach(q => {
            if (q && q._id) allQuestionIds.push(q._id.toString());
          });

          return {
            _id: st._id,
            name: st.name,
            type: st.type || 'mcq',
            description: st.description || '',
            questions: selected
          };
        });
      } else {
        // Deliver all questions added to the test by default (no 30 question artificial cap)
        const pool = [...(test.questions || [])];
        const requestedCount = parseInt(req.query.count) || (test.questionCount && test.questionCount > 0 ? test.questionCount : null);
        const count = (requestedCount && requestedCount > 0 && requestedCount < pool.length) ? requestedCount : pool.length;
        const selected = shuffle(pool).slice(0, count);

        selected.forEach(q => {
          if (q && q._id) allQuestionIds.push(q._id.toString());
        });

        sections = [{
          _id: 'flat',
          name: test.title,
          type: 'mcq',
          description: '',
          questions: selected
        }];
      }

      req.session.activeAttempts[testIdStr] = {
        testId: testIdStr,
        questionIds: allQuestionIds,
        sections: sections,
        startedAt: Date.now()
      };
    }

    // Store in session for submission verification
    req.session.currentTest = {
      testId: testIdStr,
      questionIds: allQuestionIds
    };

    // Count total questions across sections
    const totalQuestions = sections.reduce((sum, s) => sum + ((s.questions && s.questions.length) || 0), 0);
    const totalMarks = sections.reduce((sum, s) =>
      sum + ((s.questions && s.questions.reduce((qs, q) => qs + (q.marks || 1), 0)) || 0), 0);

    res.render('student/take-test', {
      title: `${test.title} - ICUBE World Assessment`,
      test: test.toObject(),
      sections,
      totalQuestions,
      totalMarks,
      isResumed,
      initialRemainingSeconds,
      initialElapsedSeconds
    });
  } catch (err) {
    console.error('Take Test Error:', err);
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

    const { timeTaken, tabSwitchesCount, fullscreenExitsCount, copyPasteAttempts, proctoringLogs } = req.body;
    const answers = [];
    let obtainedMarks = 0;
    let totalMarks = 0;

    // Collect all questions from both flat and sub-test pools
    const selectedIds = req.session.currentTest.questionIds || [];

    // Build a map of question ID → { question, sectionType }
    const questionMap = new Map();

    // Flat questions (legacy)
    for (const q of (test.questions || [])) {
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

    let parsedLogs = [];
    try {
      if (proctoringLogs) parsedLogs = JSON.parse(proctoringLogs);
    } catch (e) {
      parsedLogs = [];
    }

    const result = new Result({
      student: req.session.user.id,
      test: test._id,
      answers,
      totalMarks,
      obtainedMarks,
      percentage,
      isPassed: obtainedMarks >= test.passingMarks,
      timeTaken: parseInt(timeTaken) || 0,
      tabSwitchesCount: parseInt(tabSwitchesCount) || 0,
      fullscreenExitsCount: parseInt(fullscreenExitsCount) || 0,
      copyPasteAttempts: parseInt(copyPasteAttempts) || 0,
      proctoringLogs: Array.isArray(parsedLogs) ? parsedLogs : []
    });

    await result.save();
    delete req.session.currentTest;
    if (req.session.activeAttempts) {
      delete req.session.activeAttempts[test._id.toString()];
    }
    req.flash('success', 'Test submitted successfully!');
    res.redirect('/student/dashboard');
  } catch (err) {
    console.error('Submit Test Error:', err);
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
    const isAssignedByAdmin = test.assignedTo && test.assignedTo.some(id => 
      (id._id ? id._id.toString() : id.toString()) === req.session.user.id.toString()
    );

    if (!test.price || test.price <= 0 || isAssignedByAdmin) {
      // Free test or assigned free by admin — no payment needed
      if (isAssignedByAdmin) {
        req.flash('info', 'Admin has granted you 100% free access to this assessment.');
      }
      return res.redirect(`/student/test/${test._id}`);
    }

    // Check if candidate has already paid for this test
    const existingPayment = await Payment.findOne({
      student: req.session.user.id,
      test: test._id
    });
    if (existingPayment) {
      const paidTests = req.session.paidTests || [];
      if (!paidTests.includes(test._id.toString())) {
        paidTests.push(test._id.toString());
        req.session.paidTests = paidTests;
      }
      req.flash('info', 'Your payment is verified! Starting your assessment.');
      return res.redirect(`/student/test/${test._id}`);
    }
    res.render('student/payment', {
      title: 'Assessment Access Fee - ' + test.title,
      test,
      cashfreeMode: CASHFREE_ENV
    });
  } catch (err) {
    console.error('Payment Page Error:', err);
    req.flash('error', 'Unable to load payment page');
    res.redirect('/student/dashboard');
  }
});

// Step 2: Create Cashfree Order (called via fetch from frontend)
router.post('/pay/:id/order', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    if (!test) return res.status(404).json({ error: 'Test not found' });

    const student = await User.findById(req.session.user.id);
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Prepare 10-digit customer phone
    let phone = (student && student.phone ? student.phone.replace(/[^0-9]/g, '') : '');
    if (phone.length < 10) phone = '9999999999';
    if (phone.length > 10) phone = phone.slice(-10);

    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const returnUrl = `${protocol}://${host}/student/pay/${test._id}/return?order_id={order_id}`;

    const orderPayload = {
      order_id: orderId,
      order_amount: Number(test.price),
      order_currency: 'INR',
      customer_details: {
        customer_id: req.session.user.id.toString(),
        customer_name: (student && student.name) || req.session.user.name || 'Candidate',
        customer_email: (student && student.email) || req.session.user.email || 'candidate@example.com',
        customer_phone: phone
      },
      order_meta: {
        return_url: returnUrl
      },
      order_note: `Assessment Fee - ${test.title}`.substring(0, 50)
    };

    const response = await fetch(`${CASHFREE_BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
        'x-api-version': CASHFREE_API_VERSION
      },
      body: JSON.stringify(orderPayload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Cashfree order creation error:', data);
      return res.status(response.status).json({
        error: data.message || 'Failed to create payment order with Cashfree'
      });
    }

    res.json({
      orderId: data.order_id,
      paymentSessionId: data.payment_session_id,
      cfOrderId: data.cf_order_id,
      amount: data.order_amount,
      currency: data.order_currency
    });
  } catch (err) {
    console.error('Cashfree order error:', err);
    res.status(500).json({ error: err.message || 'Failed to create order' });
  }
});

// Step 3: Verify Cashfree Payment & grant access
router.post('/pay/:id/verify', express.json(), async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    // Query Cashfree for order status
    const response = await fetch(`${CASHFREE_BASE_URL}/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'x-client-id': CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
        'x-api-version': CASHFREE_API_VERSION
      }
    });

    const orderData = await response.json();
    if (!response.ok) {
      console.error('Cashfree order verify error:', orderData);
      return res.status(400).json({ error: orderData.message || 'Failed to verify order status' });
    }

    if (orderData.order_status !== 'PAID') {
      return res.status(400).json({
        error: `Payment not completed. Current status: ${orderData.order_status || 'Unpaid'}`
      });
    }

    // Fetch payment attempt ID if available
    let paymentId = orderData.cf_order_id ? String(orderData.cf_order_id) : orderId;
    try {
      const payRes = await fetch(`${CASHFREE_BASE_URL}/orders/${orderId}/payments`, {
        method: 'GET',
        headers: {
          'x-client-id': CASHFREE_APP_ID,
          'x-client-secret': CASHFREE_SECRET_KEY,
          'x-api-version': CASHFREE_API_VERSION
        }
      });
      if (payRes.ok) {
        const paymentsList = await payRes.json();
        if (Array.isArray(paymentsList) && paymentsList.length > 0) {
          const successful = paymentsList.find(p => p.payment_status === 'SUCCESS') || paymentsList[0];
          if (successful && successful.cf_payment_id) {
            paymentId = String(successful.cf_payment_id);
          }
        }
      }
    } catch (e) {
      // fallback to cf_order_id
    }

    // Mark test as paid in session
    const paidTests = req.session.paidTests || [];
    if (!paidTests.includes(req.params.id)) {
      paidTests.push(req.params.id);
      req.session.paidTests = paidTests;
    }

    // Record payment in DB if not already recorded
    const test = await Test.findById(req.params.id);
    const existingPay = await Payment.findOne({
      student: req.session.user.id,
      test: req.params.id
    });

    if (!existingPay && test) {
      await Payment.create({
        student: req.session.user.id,
        test: test._id,
        amount: orderData.order_amount || test.price,
        paymentId: paymentId,
        orderId: orderId
      });
    }

    res.json({ success: true, redirect: `/student/test/${req.params.id}` });
  } catch (err) {
    console.error('Cashfree payment verify error:', err);
    res.status(500).json({ error: 'Verification failed. Please contact support.' });
  }
});

// Step 4: Cashfree Return URL Handler (for redirect-based payment completion)
router.get('/pay/:id/return', async (req, res) => {
  try {
    const { order_id } = req.query;
    const testId = req.params.id;

    if (!order_id) {
      req.flash('error', 'Missing order reference');
      return res.redirect(`/student/pay/${testId}`);
    }

    // Query Cashfree for order status
    const response = await fetch(`${CASHFREE_BASE_URL}/orders/${order_id}`, {
      method: 'GET',
      headers: {
        'x-client-id': CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
        'x-api-version': CASHFREE_API_VERSION
      }
    });

    const orderData = await response.json();

    if (response.ok && orderData.order_status === 'PAID') {
      let paymentId = orderData.cf_order_id ? String(orderData.cf_order_id) : order_id;
      try {
        const payRes = await fetch(`${CASHFREE_BASE_URL}/orders/${order_id}/payments`, {
          method: 'GET',
          headers: {
            'x-client-id': CASHFREE_APP_ID,
            'x-client-secret': CASHFREE_SECRET_KEY,
            'x-api-version': CASHFREE_API_VERSION
          }
        });
        if (payRes.ok) {
          const paymentsList = await payRes.json();
          if (Array.isArray(paymentsList) && paymentsList.length > 0) {
            const successful = paymentsList.find(p => p.payment_status === 'SUCCESS') || paymentsList[0];
            if (successful && successful.cf_payment_id) {
              paymentId = String(successful.cf_payment_id);
            }
          }
        }
      } catch (e) {
        // fallback
      }

      // Mark paid in session
      const paidTests = req.session.paidTests || [];
      if (!paidTests.includes(testId)) {
        paidTests.push(testId);
        req.session.paidTests = paidTests;
      }

      // Record in DB
      const test = await Test.findById(testId);
      const existingPay = await Payment.findOne({
        student: req.session.user.id,
        test: testId
      });

      if (!existingPay && test) {
        await Payment.create({
          student: req.session.user.id,
          test: test._id,
          amount: orderData.order_amount || test.price,
          paymentId: paymentId,
          orderId: order_id
        });
      }

      req.flash('success', 'Payment verified successfully! Access unlocked.');
      return res.redirect(`/student/test/${testId}`);
    } else {
      req.flash('error', `Payment was not completed (Status: ${orderData.order_status || 'Failed'}). Please try again.`);
      return res.redirect(`/student/pay/${testId}`);
    }
  } catch (err) {
    console.error('Cashfree return error:', err);
    req.flash('error', 'Unable to verify payment. Please contact support.');
    res.redirect(`/student/pay/${req.params.id}`);
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
    res.render('student/history', { title: 'My Exam History - ICUBE World', results });
  } catch (err) {
    console.error('History Error:', err);
    req.flash('error', 'Failed to load exam history');
    res.redirect('/student/dashboard');
  }
});

// ==================== CANDIDATE PROFILE ====================
router.get('/profile', async (req, res) => {
  try {
    const student = await User.findById(req.session.user.id);
    if (!student) {
      req.flash('error', 'Candidate profile not found');
      return res.redirect('/login');
    }
    res.render('student/profile', {
      title: 'Candidate Profile - ICUBE Info Solution',
      student,
      currentUser: req.session.user
    });
  } catch (err) {
    console.error('Profile Error:', err);
    req.flash('error', 'Failed to load profile');
    res.redirect('/student/dashboard');
  }
});

module.exports = router;

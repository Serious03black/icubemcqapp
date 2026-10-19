const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Test = require('../models/Test');
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

    // Check if already submitted
    const existingResult = await Result.findOne({
      student: req.session.user.id,
      test: test._id
    });

    if (existingResult) {
      req.flash('error', 'You have already submitted this test');
      return res.redirect(`/student/results/${existingResult._id}`);
    }

    // Check if test is assigned to student
    const student = await User.findById(req.session.user.id);
    if (!student.assignedTests.includes(test._id.toString())) {
      req.flash('error', 'This test is not assigned to you');
      return res.redirect('/student/dashboard');
    }

    // ---- NEW LOGIC START ----
    // Determine how many questions to present. Client may pass ?count=30; fallback to 30 or test.questionCount if defined.
    const requestedCount = parseInt(req.query.count) || test.questionCount || 30;
    const totalAvailable = test.questions.length;
    const count = (requestedCount > 0 && requestedCount < totalAvailable) ? requestedCount : totalAvailable;

    // Fisher‑Yates shuffle for true randomness
    function shuffle(array) {
      let current = array.length, random;
      while (current !== 0) {
        random = Math.floor(Math.random() * current);
        current--;
        [array[current], array[random]] = [array[random], array[current]];
      }
      return array;
    }

    const shuffled = shuffle([...test.questions]);
    const selectedQuestions = shuffled.slice(0, count);
    // Store selected question IDs in session for later submission verification
    req.session.currentTest = {
      testId: test._id.toString(),
      questionIds: selectedQuestions.map(q => q._id.toString())
    };
    // ---- NEW LOGIC END ----

    res.render('student/take-test', {
      title: `${test.title} - TechMinds`,
      test: { ...test.toObject(), questions: selectedQuestions }
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

    // Check if already submitted (defensive, though route should be blocked)
    const existingResult = await Result.findOne({
      student: req.session.user.id,
      test: test._id
    });
    if (existingResult) {
      req.flash('error', 'You have already submitted this test');
      return res.redirect(`/student/results/${existingResult._id}`);
    }

    const { timeTaken } = req.body;
    const answers = [];
    let obtainedMarks = 0;
    let totalMarks = 0;

    // Use only the question IDs that were stored in the session
    const selectedIds = req.session.currentTest.questionIds;
    const selectedQuestions = test.questions.filter(q => selectedIds.includes(q._id.toString()));

    for (const question of selectedQuestions) {
      const selectedOption = req.body[`q_${question._id}`] || '';
      const isCorrect = selectedOption === question.correctOption;
      const marks = isCorrect ? (question.marks || 1) : 0;
      totalMarks += question.marks || 1;
      if (isCorrect) obtainedMarks += marks;

      answers.push({
        questionId: question._id,
        selectedOption,
        isCorrect,
        marks
      });
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
    // Clean up session data for this test
    delete req.session.currentTest;
    req.flash('success', 'Test submitted successfully!');
    res.redirect(`/student/results/${result._id}`);
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

// ==================== RESULTS ====================
router.get('/results', async (req, res) => {
  try {
    const results = await Result.find({ student: req.session.user.id })
      .sort({ submittedAt: -1 })
      .populate('test', 'title course totalMarks passingMarks');

    res.render('student/results', {
      title: 'My Results - TechMinds',
      results
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load results');
    res.redirect('/student/dashboard');
  }
});

router.get('/results/:id', async (req, res) => {
  try {
    const result = await Result.findById(req.params.id)
      .populate('test');

    if (!result || result.student.toString() !== req.session.user.id) {
      req.flash('error', 'Result not found');
      return res.redirect('/student/results');
    }

    res.render('student/result-detail', {
      title: 'Result Details - TechMinds',
      result
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load result details');
    res.redirect('/student/results');
  }
});

module.exports = router;

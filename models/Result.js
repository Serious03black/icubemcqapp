const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  selectedOption: {
    type: String,
    default: ''
  },
  codeAnswer: {
    type: String,
    default: ''
  },
  isCorrect: {
    type: Boolean,
    default: false
  },
  marks: {
    type: Number,
    default: 0
  }
});

const resultSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  test: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Test',
    required: true
  },
  answers: [answerSchema],
  totalMarks: {
    type: Number,
    default: 0
  },
  obtainedMarks: {
    type: Number,
    default: 0
  },
  percentage: {
    type: Number,
    default: 0
  },
  isPassed: {
    type: Boolean,
    default: false
  },
  timeTaken: {
    type: Number, // in seconds
    default: 0
  },
  // Proctoring and Anti-Cheat metrics
  tabSwitchesCount: {
    type: Number,
    default: 0
  },
  fullscreenExitsCount: {
    type: Number,
    default: 0
  },
  copyPasteAttempts: {
    type: Number,
    default: 0
  },
  proctoringLogs: [{
    action: { type: String }, // 'tab_switch', 'fullscreen_exit', 'copy_paste_attempt', 'window_minimize'
    message: { type: String },
    timestamp: { type: Date, default: Date.now }
  }],
  submittedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Prevent duplicate submissions
resultSchema.index({ student: 1, test: 1 }, { unique: true });

module.exports = mongoose.model('Result', resultSchema);

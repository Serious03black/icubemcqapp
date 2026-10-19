const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  questionText: { type: String, required: true, trim: true },
  optionA:       { type: String, required: true, trim: true },
  optionB:       { type: String, required: true, trim: true },
  optionC:       { type: String, required: true, trim: true },
  optionD:       { type: String, required: true, trim: true },
  correctOption: { type: String, required: true, enum: ['A','B','C','D'] },
  marks:         { type: Number, default: 1 },
  // 'mcq' for multiple‑choice, 'code' for programming / code answer
  type:          { type: String, enum: ['mcq','code'], default: 'mcq' }
});

const testSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  course: {
    type: String,
    required: true,
    trim: true
  },
  duration: {
    type: Number,
    required: true,
    default: 30 // in minutes
  },
  totalMarks: {
    type: Number,
    default: 0
  },
  passingMarks: {
    type: Number,
    default: 0
  },
  questions: [questionSchema],
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, { timestamps: true });

// Auto-calculate total marks
testSchema.pre('save', function(next) {
  this.totalMarks = this.questions.reduce((sum, q) => sum + (q.marks || 1), 0);
  if (this.passingMarks === 0) {
    this.passingMarks = Math.ceil(this.totalMarks * 0.4);
  }
  next();
});

module.exports = mongoose.model('Test', testSchema);

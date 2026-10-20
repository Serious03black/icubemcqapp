const mongoose = require('mongoose');

// Question schema supports MCQ and coding types
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

// Test schema now supports hierarchical sub‑tests (sections)
const testSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price: { type: Number, required: true, default: 0 },
  course: { type: String, required: true, trim: true },
  duration: { type: Number, required: true, default: 30 }, // minutes
  totalMarks: { type: Number, default: 0 },
  passingMarks: { type: Number, default: 0 },
  // New fields for certification exams
  passingPercentage: { type: Number, default: 80 }, // percentage required to pass
  expectedQuestionCount: { type: Number, default: 30 }, // anticipated number of questions

  // Flat list of questions (legacy)
  questions: [questionSchema],
  // New hierarchical sections – each subTest can hold its own question set
  subTests: [{
    name: { type: String, required: true },
    description: { type: String },
    // Number of questions to present when drawing for a student (optional)
    questionCount: { type: Number },
    // Allowed values: mcq, code, mixed
    type: { type: String, enum: ['mcq','code','mixed'], default: 'mcq' },
    questions: [questionSchema]
  }],
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

// Auto‑calculate total marks from both top‑level and sub‑test questions
testSchema.pre('save', function(next) {
  const topMarks = this.questions.reduce((sum, q) => sum + (q.marks || 1), 0);
  const subMarks = (this.subTests || []).reduce((sum, st) => {
    return sum + (st.questions || []).reduce((s, q) => s + (q.marks || 1), 0);
  }, 0);
  this.totalMarks = topMarks + subMarks;
  if (this.passingMarks === 0) {
    this.passingMarks = Math.ceil(this.totalMarks * 0.4);
  }
  next();
});

module.exports = mongoose.model('Test', testSchema);

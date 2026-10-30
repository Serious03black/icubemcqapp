require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check if admin exists
    const existingAdmin = await User.findOne({ email: 'office@icubeworld.in' });
    if (existingAdmin) {
      console.log('Admin already exists. Skipping seed.');
      process.exit(0);
    }

    // Create default admin
    const admin = new User({
      name: 'Admin',
      email: 'office@icubeworld.in',
      password: 'Admin@123',
      role: 'admin',
      course: 'Administration',
      phone: '9999999999'
    });

    await admin.save();
    console.log('✅ Default Admin Created:');
    console.log('   Email: office@icubeworld.in');
    console.log('   Password: Admin@123');
    console.log('');

    // Create sample students
    const students = [
      { name: 'Rahul Sharma', email: 'rahul@ I cube world.in', password: 'Student@123', course: 'MERN Stack', phone: '9876543210' },
      { name: 'Priya Patel', email: 'priya@ I cube world.in', password: 'Student@123', course: 'Data Science', phone: '9876543211' },
      { name: 'Amit Kumar', email: 'amit@ I cube world.in', password: 'Student@123', course: 'MERN Stack', phone: '9876543212' }
    ];

    for (const s of students) {
      const student = new User({ ...s, role: 'student' });
      await student.save();
      console.log(`✅ Student Created: ${s.name} (${s.email})`);
    }

    console.log('\n✅ Seed completed successfully!');
    console.log('   All student passwords: Student@123');
    process.exit(0);
  } catch (err) {
    console.error('Seed Error:', err);
    process.exit(1);
  }
}

seed();

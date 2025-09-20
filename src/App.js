import React, { useState } from 'react';
// import StudentExam from './components/StudentExam';
import './App.css';
import StudentExam from './StudentApp';

function App() {
  const [examData, setExamData] = useState({
    examId: 'EXAM001',
    userId: `STUDENT_${Math.floor(Math.random() * 1000)}`
  });

  const [isJoined, setIsJoined] = useState(false);

  const handleJoinExam = () => {
    setIsJoined(true);
  };

  const handleChangeData = (field, value) => {
    setExamData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-2xl font-bold text-center mb-6 text-gray-800">
            👨‍🎓 Student Login
          </h1>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Exam ID
              </label>
              <input
                type="text"
                value={examData.examId}
                onChange={(e) => handleChangeData('examId', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter Exam ID"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Student ID
              </label>
              <input
                type="text"
                value={examData.userId}
                onChange={(e) => handleChangeData('userId', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter Student ID"
              />
            </div>
          </div>
          
          <button
            onClick={handleJoinExam}
            className="w-full mt-6 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md transition-colors"
          >
            Join Exam
          </button>
        </div>
      </div>
    );
  }

  return (
    <StudentExam
      examId={examData.examId} 
      userId={examData.userId} 
    />
  );
}

export default App;

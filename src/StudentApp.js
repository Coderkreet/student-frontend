// src/StudentApp.js - UPDATED VERSION
import React, { useState, useEffect, useRef } from 'react';
import { Device } from 'mediasoup-client';
import io from 'socket.io-client';


const StudentApp = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [examId, setExamId] = useState('');
  const [logs, setLogs] = useState([]);
  const [currentPeerId, setCurrentPeerId] = useState(''); // ✅ Track current peer ID
  
  const localVideoRef = useRef(null);
  const socketRef = useRef(null);
  const deviceRef = useRef(null);
  const producerRef = useRef(null);
  const transportRef = useRef(null);
  
  // Add log function
  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { message, type, timestamp }]);
    console.log(`${timestamp} - ${message}`);
  };


  // Initialize socket connection
  const connectToServer = async () => {
    try {
      addLog('🔌 Connecting to server...');
      
      socketRef.current = io('http://localhost:5000', {
        forceNew: true
      });


      socketRef.current.on('connect', () => {
        setIsConnected(true);
        addLog(`✅ Connected with socket ID: ${socketRef.current.id}`, 'success');
      });


      // ✅ FIXED: Get peer ID from joinedExam response
      socketRef.current.on('joinedExam', async (data) => {
        addLog(`✅ Joined exam: ${data.examId}`, 'success');
        addLog(`📋 Assigned Peer ID: ${data.peerId}`, 'info');
        
        // ✅ Store the peer ID from backend
        setCurrentPeerId(data.peerId);
        
        await initializeMediaSoup(data.peerId); // Pass peer ID
      });


      socketRef.current.on('disconnect', () => {
        setIsConnected(false);
        addLog('❌ Disconnected from server', 'error');
      });


    } catch (error) {
      addLog(`❌ Connection failed: ${error.message}`, 'error');
    }
  };


  // ✅ FIXED: Use consistent peer ID
  const initializeMediaSoup = async (peerId) => {
    try {
      addLog(`📱 Initializing MediaSoup device with peer ID: ${peerId}...`);
      
      // Get RTP capabilities from server
      const response = await fetch('http://localhost:5000/api/rtp-capabilities');
      const { rtpCapabilities } = await response.json();
      
      // Create and load device
      deviceRef.current = new Device();
      await deviceRef.current.load({ routerRtpCapabilities: rtpCapabilities });
      
      addLog('✅ MediaSoup device loaded', 'success');
      
      // Create transport with correct peer ID
      await createSendTransport(peerId);
      
    } catch (error) {
      addLog(`❌ MediaSoup initialization failed: ${error.message}`, 'error');
    }
  };


  // ✅ FIXED: Use consistent peer ID for transport
  const createSendTransport = async (peerId) => {
    try {
      addLog(`🚛 Creating send transport for peer: ${peerId}...`);
      
      const response = await fetch('http://localhost:5000/api/create-transport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peerId: peerId, // ✅ Use the peer ID from backend
          direction: 'send'
        })
      });


      const { transport: transportData } = await response.json();
      
      // Create send transport
      transportRef.current = deviceRef.current.createSendTransport({
        id: transportData.id,
        iceParameters: transportData.iceParameters,
        iceCandidates: transportData.iceCandidates,
        dtlsParameters: transportData.dtlsParameters
      });


      // Handle transport events with consistent peer ID
      transportRef.current.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          addLog(`🔌 Connecting transport for peer: ${peerId}...`);
          
          await fetch('http://localhost:5000/api/connect-transport', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              peerId: peerId, // ✅ Use consistent peer ID
              dtlsParameters
            })
          });
          callback();
          addLog('✅ Transport connected successfully', 'success');
        } catch (error) {
          addLog(`❌ Transport connection failed: ${error.message}`, 'error');
          errback(error);
        }
      });


      transportRef.current.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
        try {
          addLog(`📺 Creating producer for ${kind} with peer: ${peerId}...`);
          
          const response = await fetch('http://localhost:5000/api/produce', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              peerId: peerId, // ✅ Use consistent peer ID
              kind,
              rtpParameters,
              examId
            })
          });


          const { producerId } = await response.json();
          callback({ id: producerId });
          addLog(`✅ Producer created: ${producerId}`, 'success');
        } catch (error) {
          addLog(`❌ Producer creation failed: ${error.message}`, 'error');
          errback(error);
        }
      });


      addLog('✅ Send transport created successfully', 'success');
      
    } catch (error) {
      addLog(`❌ Transport creation failed: ${error.message}`, 'error');
    }
  };


  // Start webcam streaming
  const startStreaming = async () => {
    try {
      if (!currentPeerId) {
        addLog('❌ No peer ID available. Please join exam first.', 'error');
        return;
      }


      addLog('📹 Starting webcam stream...');
      
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: true
      });


      // Display local video
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }


      // Produce video track
      const videoTrack = stream.getVideoTracks()[0];
      producerRef.current = await transportRef.current.produce({
        track: videoTrack,
        encodings: [
          { maxBitrate: 100000 },
          { maxBitrate: 300000 },
          { maxBitrate: 900000 }
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1000
        }
      });


      setIsStreaming(true);
      addLog('✅ Streaming started successfully!', 'success');
      
    } catch (error) {
      addLog(`❌ Streaming failed: ${error.message}`, 'error');
    }
  };


  // Stop streaming
  const stopStreaming = () => {
    if (producerRef.current) {
      producerRef.current.close();
      producerRef.current = null;
    }
    
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      localVideoRef.current.srcObject = null;
    }
    
    setIsStreaming(false);
    addLog('⏹️ Streaming stopped', 'info');
  };


  // Join exam
  const joinExam = () => {
    if (!studentId || !examId) {
      addLog('❌ Please enter Student ID and Exam ID', 'error');
      return;
    }


    addLog(`📋 Joining exam ${examId} as ${studentId}...`);
    socketRef.current.emit('joinExam', {
      examId,
      role: 'student',
      userId: studentId
    });
  };


  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>📚 Student Exam Interface</h1>
      
      {/* Connection Status */}
      <div style={{ marginBottom: '10px', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '5px' }}>
        <strong>Status:</strong> {isConnected ? '✅ Connected' : '❌ Disconnected'} 
        {currentPeerId && <span> | Peer ID: <code>{currentPeerId}</code></span>}
      </div>
      
      {/* Connection Form */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h3>Connection Setup</h3>
        <div style={{ marginBottom: '10px' }}>
          <label>Student ID: </label>
          <input
            type="text"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            placeholder="Enter your student ID (e.g., Kreet)"
            style={{ marginLeft: '10px', padding: '5px', width: '200px' }}
          />
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label>Exam ID: </label>
          <input
            type="text"
            value={examId}
            onChange={(e) => setExamId(e.target.value)}
            placeholder="Enter exam ID (e.g., 90)"
            style={{ marginLeft: '10px', padding: '5px', width: '200px' }}
          />
        </div>
        
        <button onClick={connectToServer} disabled={isConnected} style={{ marginRight: '10px' }}>
          {isConnected ? '✅ Connected' : '🔌 Connect to Server'}
        </button>
        
        <button onClick={joinExam} disabled={!isConnected || !studentId || !examId}>
          📋 Join Exam
        </button>
      </div>


      {/* Video Streaming */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h3>Video Streaming</h3>
        
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          style={{
            width: '100%',
            maxWidth: '640px',
            height: 'auto',
            border: '2px solid #333',
            borderRadius: '8px',
            marginBottom: '10px'
          }}
        />
        
        <div>
          <button
            onClick={startStreaming}
            disabled={!currentPeerId || isStreaming}
            style={{ 
              marginRight: '10px', 
              backgroundColor: currentPeerId && !isStreaming ? '#4CAF50' : '#cccccc', 
              color: 'white', 
              padding: '8px 16px' 
            }}
          >
            {isStreaming ? '📹 Streaming...' : '📹 Start Stream'}
          </button>
          
          <button
            onClick={stopStreaming}
            disabled={!isStreaming}
            style={{ backgroundColor: '#f44336', color: 'white', padding: '8px 16px' }}
          >
            ⏹️ Stop Stream
          </button>
        </div>
      </div>


      {/* Logs */}
      <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
        <h3>Connection Logs</h3>
        <div style={{ height: '250px', overflowY: 'auto', fontSize: '12px', fontFamily: 'monospace' }}>
          {logs.map((log, index) => (
            <div
              key={index}
              style={{
                color: log.type === 'error' ? 'red' : log.type === 'success' ? 'green' : 'black',
                marginBottom: '2px'
              }}
            >
              [{log.timestamp}] {log.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};


export default StudentApp; 
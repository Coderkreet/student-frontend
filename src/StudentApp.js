import React, { useState, useEffect, useRef } from 'react';
import { Device } from 'mediasoup-client';
import io from 'socket.io-client';

const StudentApp = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isStreamingCamera, setIsStreamingCamera] = useState(false);
  const [isStreamingScreen, setIsStreamingScreen] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [examId, setExamId] = useState('');
  const [logs, setLogs] = useState([]);
  const [currentPeerId, setCurrentPeerId] = useState('');

  const localVideoRef = useRef(null);
  const screenVideoRef = useRef(null);
  const socketRef = useRef(null);
  const deviceRef = useRef(null);
  const cameraProducerRef = useRef(null);
  const screenProducerRef = useRef(null);
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

      socketRef.current.on('joinedExam', async (data) => {
        addLog(`✅ Joined exam: ${data.examId}`, 'success');
        addLog(`📋 Assigned Peer ID: ${data.peerId}`, 'info');
        
        setCurrentPeerId(data.peerId);
        await initializeMediaSoup(data.peerId);
      });

      socketRef.current.on('disconnect', () => {
        setIsConnected(false);
        addLog('❌ Disconnected from server', 'error');
      });
    } catch (error) {
      addLog(`❌ Connection failed: ${error.message}`, 'error');
    }
  };

  // Initialize MediaSoup
  const initializeMediaSoup = async (peerId) => {
    try {
      addLog(`📱 Initializing MediaSoup device with peer ID: ${peerId}...`);
      
      const response = await fetch('http://localhost:5000/api/rtp-capabilities');
      const { rtpCapabilities } = await response.json();
      
      deviceRef.current = new Device();
      await deviceRef.current.load({ routerRtpCapabilities: rtpCapabilities });
      
      addLog('✅ MediaSoup device loaded', 'success');
      await createSendTransport(peerId);
      
    } catch (error) {
      addLog(`❌ MediaSoup initialization failed: ${error.message}`, 'error');
    }
  };

  // Create send transport
  const createSendTransport = async (peerId) => {
    try {
      addLog(`🚛 Creating send transport for peer: ${peerId}...`);
      
      const response = await fetch('http://localhost:5000/api/create-transport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peerId: peerId,
          direction: 'send'
        })
      });

      const { transport: transportData } = await response.json();
      
      transportRef.current = deviceRef.current.createSendTransport({
        id: transportData.id,
        iceParameters: transportData.iceParameters,
        iceCandidates: transportData.iceCandidates,
        dtlsParameters: transportData.dtlsParameters
      });

      transportRef.current.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          addLog(`🔌 Connecting transport for peer: ${peerId}...`);
          
          await fetch('http://localhost:5000/api/connect-transport', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              peerId: peerId,
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

      transportRef.current.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
        try {
          const streamType = appData.streamType || 'camera';
          addLog(`📺 Creating ${streamType} producer for ${kind} with peer: ${peerId}...`);
          
          const response = await fetch('http://localhost:5000/api/produce', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              peerId: peerId,
              kind,
              rtpParameters,
              examId,
              streamType
            })
          });

          const { producerId } = await response.json();
          callback({ id: producerId });
          addLog(`✅ ${streamType} producer created: ${producerId}`, 'success');
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

  // ✅ NEW: Start camera streaming
  const startCameraStreaming = async () => {
    try {
      if (!currentPeerId) {
        addLog('❌ No peer ID available. Please join exam first.', 'error');
        return;
      }

      addLog('📹 Starting camera stream...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: true
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const videoTrack = stream.getVideoTracks()[0];
      cameraProducerRef.current = await transportRef.current.produce({
        track: videoTrack,
        encodings: [
          { maxBitrate: 100000 },
          { maxBitrate: 300000 },
          { maxBitrate: 900000 }
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1000
        },
        appData: { streamType: 'camera' }
      });

      setIsStreamingCamera(true);
      addLog('✅ Camera streaming started successfully!', 'success');
      
    } catch (error) {
      addLog(`❌ Camera streaming failed: ${error.message}`, 'error');
    }
  };

  // ✅ NEW: Start screen sharing
  const startScreenSharing = async () => {
    try {
      if (!currentPeerId) {
        addLog('❌ No peer ID available. Please join exam first.', 'error');
        return;
      }

      addLog('🖥️ Starting screen sharing...');
      
      // ✅ Use getDisplayMedia for screen capture
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { max: 1920 },
          height: { max: 1080 },
          frameRate: { max: 30 }
        },
        audio: true // Include system audio if available
      });

      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
      }

      const videoTrack = stream.getVideoTracks()[0];
      
      // ✅ Handle screen share stop event
      videoTrack.addEventListener('ended', () => {
        addLog('🖥️ Screen sharing stopped by user', 'warning');
        stopScreenSharing();
      });

      screenProducerRef.current = await transportRef.current.produce({
        track: videoTrack,
        encodings: [
          { maxBitrate: 2000000 }, // Higher bitrate for screen
          { maxBitrate: 1000000 },
          { maxBitrate: 500000 }
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1000
        },
        appData: { streamType: 'screen' }
      });

      // ✅ Handle audio track if available
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        await transportRef.current.produce({
          track: audioTracks[0],
          appData: { streamType: 'screenAudio' }
        });
        addLog('🎵 Screen audio included', 'info');
      }

      setIsStreamingScreen(true);
      addLog('✅ Screen sharing started successfully!', 'success');
      
    } catch (error) {
      addLog(`❌ Screen sharing failed: ${error.message}`, 'error');
    }
  };

  // ✅ NEW: Stop camera streaming
  const stopCameraStreaming = () => {
    if (cameraProducerRef.current) {
      cameraProducerRef.current.close();
      cameraProducerRef.current = null;
    }
    
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      localVideoRef.current.srcObject = null;
    }
    
    setIsStreamingCamera(false);
    addLog('⏹️ Camera streaming stopped', 'info');
  };

  // ✅ NEW: Stop screen sharing
  const stopScreenSharing = () => {
    if (screenProducerRef.current) {
      screenProducerRef.current.close();
      screenProducerRef.current = null;
    }
    
    if (screenVideoRef.current && screenVideoRef.current.srcObject) {
      screenVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      screenVideoRef.current.srcObject = null;
    }
    
    setIsStreamingScreen(false);
    addLog('⏹️ Screen sharing stopped', 'info');
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
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>📚 Student Exam Interface - Enhanced with Screen Sharing</h1>
      
      {/* Connection Status */}
      <div style={{ 
        marginBottom: '20px', 
        padding: '15px', 
        backgroundColor: isConnected ? '#d4edda' : '#f8d7da', 
        borderRadius: '8px',
        border: `2px solid ${isConnected ? '#28a745' : '#dc3545'}`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          <div>
            <strong>Status:</strong> {isConnected ? '✅ Connected' : '❌ Disconnected'}
          </div>
          {currentPeerId && (
            <div>
              <strong>Peer ID:</strong> <code>{currentPeerId}</code>
            </div>
          )}
          <div>
            <strong>Camera:</strong> {isStreamingCamera ? '🟢 Live' : '🔴 Off'}
          </div>
          <div>
            <strong>Screen:</strong> {isStreamingScreen ? '🟢 Sharing' : '🔴 Off'}
          </div>
        </div>
      </div>
      
      {/* Connection Form */}
      <div style={{ 
        marginBottom: '25px', 
        padding: '20px', 
        border: '2px solid #dee2e6', 
        borderRadius: '12px',
        backgroundColor: '#f8f9fa'
      }}>
        <h3 style={{ marginBottom: '15px' }}>🔐 Student Login</h3>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: '14px', fontWeight: 'bold' }}>Student ID:</label><br />
            <input
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="Enter your student ID (e.g., Kreet)"
              style={{ 
                padding: '10px', 
                width: '200px',
                border: '2px solid #ced4da',
                borderRadius: '6px'
              }}
            />
          </div>
          
          <div>
            <label style={{ fontSize: '14px', fontWeight: 'bold' }}>Exam ID:</label><br />
            <input
              type="text"
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
              placeholder="Enter exam ID (e.g., 11)"
              style={{ 
                padding: '10px', 
                width: '200px',
                border: '2px solid #ced4da',
                borderRadius: '6px'
              }}
            />
          </div>
          
          <button 
            onClick={connectToServer} 
            disabled={isConnected}
            style={{ 
              padding: '10px 20px',
              backgroundColor: isConnected ? '#6c757d' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: isConnected ? 'not-allowed' : 'pointer'
            }}
          >
            {isConnected ? '✅ Connected' : '🔌 Connect'}
          </button>
          
          <button 
            onClick={joinExam} 
            disabled={!isConnected || !studentId || !examId}
            style={{ 
              padding: '10px 20px',
              backgroundColor: (!isConnected || !studentId || !examId) ? '#6c757d' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: (!isConnected || !studentId || !examId) ? 'not-allowed' : 'pointer'
            }}
          >
            📋 Join Exam
          </button>
        </div>
      </div>

      {/* Video Streaming Controls */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '25px', flexWrap: 'wrap' }}>
        
        {/* Camera Stream */}
        <div style={{ 
          flex: '1', 
          minWidth: '400px',
          padding: '20px', 
          border: '2px solid #dee2e6', 
          borderRadius: '12px',
          backgroundColor: '#ffffff'
        }}>
          <h3 style={{ marginBottom: '15px', color: '#495057' }}>📹 Camera Stream</h3>
          
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: '100%',
              maxWidth: '400px',
              height: 'auto',
              border: `3px solid ${isStreamingCamera ? '#28a745' : '#dee2e6'}`,
              borderRadius: '8px',
              marginBottom: '15px',
              backgroundColor: '#000'
            }}
          />
          
          <div>
            <button
              onClick={startCameraStreaming}
              disabled={!currentPeerId || isStreamingCamera}
              style={{ 
                marginRight: '10px', 
                padding: '10px 20px',
                backgroundColor: currentPeerId && !isStreamingCamera ? '#28a745' : '#6c757d', 
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: currentPeerId && !isStreamingCamera ? 'pointer' : 'not-allowed'
              }}
            >
              {isStreamingCamera ? '📹 Streaming...' : '📹 Start Camera'}
            </button>
            
            <button
              onClick={stopCameraStreaming}
              disabled={!isStreamingCamera}
              style={{ 
                padding: '10px 20px',
                backgroundColor: isStreamingCamera ? '#dc3545' : '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: isStreamingCamera ? 'pointer' : 'not-allowed'
              }}
            >
              ⏹️ Stop Camera
            </button>
          </div>
        </div>

        {/* Screen Share */}
        <div style={{ 
          flex: '1', 
          minWidth: '400px',
          padding: '20px', 
          border: '2px solid #dee2e6', 
          borderRadius: '12px',
          backgroundColor: '#ffffff'
        }}>
          <h3 style={{ marginBottom: '15px', color: '#495057' }}>🖥️ Screen Share</h3>
          
          <video
            ref={screenVideoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: '100%',
              maxWidth: '400px',
              height: 'auto',
              border: `3px solid ${isStreamingScreen ? '#17a2b8' : '#dee2e6'}`,
              borderRadius: '8px',
              marginBottom: '15px',
              backgroundColor: '#000'
            }}
          />
          
          <div>
            <button
              onClick={startScreenSharing}
              disabled={!currentPeerId || isStreamingScreen}
              style={{ 
                marginRight: '10px', 
                padding: '10px 20px',
                backgroundColor: currentPeerId && !isStreamingScreen ? '#17a2b8' : '#6c757d', 
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: currentPeerId && !isStreamingScreen ? 'pointer' : 'not-allowed'
              }}
            >
              {isStreamingScreen ? '🖥️ Sharing...' : '🖥️ Share Screen'}
            </button>
            
            <button
              onClick={stopScreenSharing}
              disabled={!isStreamingScreen}
              style={{ 
                padding: '10px 20px',
                backgroundColor: isStreamingScreen ? '#dc3545' : '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: isStreamingScreen ? 'pointer' : 'not-allowed'
              }}
            >
              ⏹️ Stop Share
            </button>
          </div>
        </div>
      </div>

      {/* System Logs */}
      <div style={{ 
        padding: '20px', 
        border: '2px solid #dee2e6', 
        borderRadius: '12px', 
        backgroundColor: '#f8f9fa'
      }}>
        <h3 style={{ marginBottom: '15px' }}>📋 Connection Logs</h3>
        <div style={{ 
          height: '300px', 
          overflowY: 'auto', 
          fontSize: '13px', 
          fontFamily: 'Monaco, Consolas, "Courier New", monospace',
          backgroundColor: '#1e1e1e',
          color: '#00ff41',
          padding: '15px',
          borderRadius: '8px'
        }}>
          {logs.length === 0 ? (
            <div style={{ color: '#888', textAlign: 'center', paddingTop: '20px' }}>
              Ready to connect...
            </div>
          ) : (
            logs.map((log, index) => (
              <div
                key={index}
                style={{
                  color: log.type === 'error' ? '#ff4757' : 
                        log.type === 'success' ? '#2ed573' : 
                        log.type === 'warning' ? '#ffa502' : '#00ff41',
                  marginBottom: '3px',
                  lineHeight: '1.4'
                }}
              >
                [{log.timestamp}] {log.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default StudentApp;

// StudentExam.jsx
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

const StudentExam = ({ examId, userId }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  
  // Refs
  const socketRef = useRef(null);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const screenVideoRef = useRef(null);
  const cameraProducerRef = useRef(null);
  const screenProducerRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);

  // ✅ OPTIMIZED: Initialize connection
  useEffect(() => {
    initializeConnection();
    return () => cleanup();
  }, []);

  const initializeConnection = async () => {
    try {
      setConnectionStatus('Connecting...');
      
      // Initialize socket
      socketRef.current = io('http://192.168.0.13:5000', {
        transports: ['websocket']
      });

      socketRef.current.on('connect', () => {
        console.log('✅ Socket connected');
        setIsConnected(true);
        joinExam();
      });

      socketRef.current.on('joinedExam', async (data) => {
        console.log('✅ Joined exam:', data);
        setConnectionStatus('Setting up media...');
        await setupMediaSoup(data.peerId);
      });

      socketRef.current.on('disconnect', () => {
        setIsConnected(false);
        setConnectionStatus('Disconnected');
      });

    } catch (error) {
      console.error('❌ Connection error:', error);
      setConnectionStatus('Connection Failed');
    }
  };

  const joinExam = () => {
    socketRef.current.emit('joinExam', {
      examId,
      role: 'student',
      userId
    });
  };

  // ✅ OPTIMIZED: Setup MediaSoup with transport reuse
  const setupMediaSoup = async (peerId) => {
    try {
      console.log('🚀 Setting up MediaSoup...');

      // Get RTP capabilities
      const rtpCapabilities = await fetch('http://192.168.0.13:5000/api/rtp-capabilities')
        .then(res => res.json());

      if (!rtpCapabilities.success) {
        throw new Error('Failed to get RTP capabilities');
      }

      // Create device
      deviceRef.current = new mediasoupClient.Device();
      await deviceRef.current.load({ 
        routerRtpCapabilities: rtpCapabilities.rtpCapabilities 
      });

      // ✅ OPTIMIZED: Setup transports in single call
      const transportData = await fetch('http://192.168.0.13:5000/api/setup-transports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId, role: 'student' })
      }).then(res => res.json());

      if (!transportData.success) {
        throw new Error('Failed to setup transports');
      }

      // Create send transport
      sendTransportRef.current = deviceRef.current.createSendTransport({
        id: transportData.transports.send.id,
        iceParameters: transportData.transports.send.iceParameters,
        iceCandidates: transportData.transports.send.iceCandidates,
        dtlsParameters: transportData.transports.send.dtlsParameters
      });

      // Setup transport event handlers
      sendTransportRef.current.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          // ✅ OPTIMIZED: Connect transport
          await fetch('http://192.168.0.13:5000/api/connect-transports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              peerId, 
              sendDtlsParameters: dtlsParameters 
            })
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      sendTransportRef.current.on('produce', async (parameters, callback, errback) => {
        try {
          const response = await fetch('http://192.168.0.13:5000/api/produce', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              peerId,
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
              streamType: parameters.appData.streamType
            })
          });
          
          const result = await response.json();
          callback({ id: result.producerId });
        } catch (error) {
          errback(error);
        }
      });

      setConnectionStatus('Ready for exam');
      console.log('✅ MediaSoup setup complete');

    } catch (error) {
      console.error('❌ MediaSoup setup error:', error);
      setConnectionStatus('Setup Failed');
    }
  };

  // ✅ Start camera
  const startCamera = async () => {
    try {
      console.log('📷 Starting camera...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true
      });

      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
      }

      // Produce camera stream
      const videoTrack = stream.getVideoTracks()[0];
      cameraProducerRef.current = await sendTransportRef.current.produce({
        track: videoTrack,
        appData: { streamType: 'camera' }
      });

      // Produce audio
      const audioTrack = stream.getAudioTracks()[0];
      await sendTransportRef.current.produce({
        track: audioTrack,
        appData: { streamType: 'audio' }
      });

      setIsCameraOn(true);
      console.log('✅ Camera started');

    } catch (error) {
      console.error('❌ Camera error:', error);
    }
  };

  // ✅ Start screen sharing
  const startScreenShare = async () => {
    try {
      console.log('🖥️ Starting screen share...');
      
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1280, height: 720 },
        audio: false
      });

      screenStreamRef.current = stream;
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
      }

      // Produce screen stream
      const videoTrack = stream.getVideoTracks()[0];
      screenProducerRef.current = await sendTransportRef.current.produce({
        track: videoTrack,
        appData: { streamType: 'screen' }
      });

      // Handle screen share end
      videoTrack.onended = () => {
        stopScreenShare();
      };

      setIsScreenSharing(true);
      console.log('✅ Screen sharing started');

    } catch (error) {
      console.error('❌ Screen share error:', error);
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraProducerRef.current) {
      cameraProducerRef.current.close();
      cameraProducerRef.current = null;
    }
    setIsCameraOn(false);
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    if (screenProducerRef.current) {
      screenProducerRef.current.close();
      screenProducerRef.current = null;
    }
    setIsScreenSharing(false);
  };

  const cleanup = () => {
    stopCamera();
    stopScreenShare();
    if (sendTransportRef.current) {
      sendTransportRef.current.close();
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            Student Exam Portal
          </h1>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-600">
              Status: <span className={`font-semibold ${
                isConnected ? 'text-green-600' : 'text-red-600'
              }`}>
                {connectionStatus}
              </span>
            </span>
            <span className="text-sm text-gray-600">
              Exam ID: {examId}
            </span>
            <span className="text-sm text-gray-600">
              User ID: {userId}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex space-x-4">
            <button
              onClick={isCameraOn ? stopCamera : startCamera}
              disabled={!isConnected}
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                isCameraOn 
                  ? 'bg-red-500 hover:bg-red-600 text-white' 
                  : 'bg-green-500 hover:bg-green-600 text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isCameraOn ? '📷 Stop Camera' : '📷 Start Camera'}
            </button>
            
            <button
              onClick={isScreenSharing ? stopScreenShare : startScreenShare}
              disabled={!isConnected}
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                isScreenSharing 
                  ? 'bg-red-500 hover:bg-red-600 text-white' 
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isScreenSharing ? '🖥️ Stop Screen' : '🖥️ Share Screen'}
            </button>
          </div>
        </div>

        {/* Video Displays */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Camera Feed */}
          <div className="bg-white rounded-lg shadow-md p-4">
            <h3 className="text-lg font-semibold mb-3 text-gray-700">
              📷 Camera Feed
            </h3>
            <div className="bg-gray-900 rounded-lg overflow-hidden">
              <video
                ref={cameraVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-64 object-cover"
              />
              {!isCameraOn && (
                <div className="w-full h-64 flex items-center justify-center text-gray-400">
                  Camera Off
                </div>
              )}
            </div>
          </div>

          {/* Screen Share */}
          <div className="bg-white rounded-lg shadow-md p-4">
            <h3 className="text-lg font-semibold mb-3 text-gray-700">
              🖥️ Screen Share
            </h3>
            <div className="bg-gray-900 rounded-lg overflow-hidden">
              <video
                ref={screenVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-64 object-cover"
              />
              {!isScreenSharing && (
                <div className="w-full h-64 flex items-center justify-center text-gray-400">
                  Screen Share Off
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Info */}
        <div className="bg-white rounded-lg shadow-md p-6 mt-6">
          <h3 className="text-lg font-semibold mb-3 text-gray-700">Connection Status</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>Socket: {isConnected ? '✅ Connected' : '❌ Disconnected'}</div>
            <div>Camera: {isCameraOn ? '✅ Active' : '⭕ Inactive'}</div>
            <div>Screen: {isScreenSharing ? '✅ Sharing' : '⭕ Not Sharing'}</div>
            <div>Status: {connectionStatus}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentExam;

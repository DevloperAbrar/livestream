import React, { useState, useEffect, useRef } from 'react';
import Peer from 'simple-peer';
import Chat from './Chat';
import './AdminPanel.css';

const AdminPanel = ({ socket, user }) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [peers, setPeers] = useState(new Map());
  const [stream, setStream] = useState(null);
  const [streamError, setStreamError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const videoRef = useRef();
  const peersRef = useRef(new Map());
  const streamRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    // Send user info when socket connects
    socket.emit('user-info', {
      username: user.username,
      isAdmin: user.isAdmin
    });

    socket.on('viewer-joined', (data) => {
      console.log('Viewer joined:', data.viewerSocketId, data.viewerUsername);
      if (streamRef.current && isStreaming) {
        createPeerConnection(data.viewerSocketId);
      }
    });

    socket.on('webrtc-signal', (data) => {
      console.log('WebRTC signal received:', data.type, 'from:', data.from);
      handleSignal(data);
    });

    socket.on('viewer-count-update', (data) => {
      setViewerCount(data.viewerCount);
    });

    socket.on('viewer-left', (data) => {
      console.log('Viewer left:', data.viewerSocketId, data.viewerUsername);
      const peer = peersRef.current.get(data.viewerSocketId);
      if (peer) {
        peer.destroy();
        peersRef.current.delete(data.viewerSocketId);
        setPeers(new Map(peersRef.current));
      }
    });

    socket.on('stream-error', (data) => {
      console.error('Stream error:', data.message);
      setStreamError(data.message);
    });

    socket.on('connect', () => {
      console.log('Admin connected to server');
      setConnectionStatus('connected');
    });

    socket.on('disconnect', () => {
      console.log('Admin disconnected from server');
      setConnectionStatus('disconnected');
    });

    return () => {
      socket.off('viewer-joined');
      socket.off('webrtc-signal');
      socket.off('viewer-count-update');
      socket.off('viewer-left');
      socket.off('stream-error');
      socket.off('connect');
      socket.off('disconnect');
    };
  }, [socket, user, isStreaming]);

  const createPeerConnection = (viewerSocketId) => {
    if (!streamRef.current) {
      console.log('No stream available for peer connection');
      return;
    }

    // Don't create duplicate peer connections
    if (peersRef.current.has(viewerSocketId)) {
      console.log('Peer connection already exists for viewer:', viewerSocketId);
      return;
    }

    console.log('Creating peer connection for viewer:', viewerSocketId);

    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream: streamRef.current,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' }
        ]
      }
    });

    peer.on('signal', (signal) => {
      console.log('Sending offer to viewer:', viewerSocketId);
      socket.emit('webrtc-signal', {
        signal,
        to: viewerSocketId,
        type: 'offer'
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error with viewer', viewerSocketId, ':', err);
      peersRef.current.delete(viewerSocketId);
      setPeers(new Map(peersRef.current));
    });

    peer.on('close', () => {
      console.log('Peer connection closed with viewer:', viewerSocketId);
      peersRef.current.delete(viewerSocketId);
      setPeers(new Map(peersRef.current));
    });

    peer.on('connect', () => {
      console.log('Peer connected with viewer:', viewerSocketId);
    });

    peer.on('stream', (remoteStream) => {
      console.log('Received stream from viewer (unexpected):', viewerSocketId);
    });

    peersRef.current.set(viewerSocketId, peer);
    setPeers(new Map(peersRef.current));
  };

  const handleSignal = (data) => {
    const peer = peersRef.current.get(data.from);
    if (peer && data.signal && data.type === 'answer') {
      console.log('Processing answer from viewer:', data.from);
      try {
        peer.signal(data.signal);
      } catch (error) {
        console.error('Error processing signal:', error);
      }
    }
  };

  const startStream = async () => {
    try {
      console.log('Starting stream...');
      setStreamError('');
      
      // Request camera and microphone permissions
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      console.log('Media stream obtained:', mediaStream.getTracks().map(t => `${t.kind}: ${t.enabled}`));

      // Store stream in both state and ref
      setStream(mediaStream);
      streamRef.current = mediaStream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }

      // Notify server that stream is starting
      socket.emit('start-stream', {
        adminUsername: user.username,
        streamInfo: {
          video: mediaStream.getVideoTracks().length > 0,
          audio: mediaStream.getAudioTracks().length > 0
        }
      });
      
      setIsStreaming(true);
      console.log('Stream started successfully');
    } catch (error) {
      console.error('Error starting stream:', error);
      setStreamError('Error accessing camera/microphone: ' + error.message);
      
      // Clean up on error
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setStream(null);
      setIsStreaming(false);
    }
  };

  const stopStream = () => {
    console.log('Stopping stream...');
    setStreamError('');
    
    // Stop all media tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('Stopped track:', track.kind);
      });
      streamRef.current = null;
    }
    
    setStream(null);

    // Clear video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Destroy all peer connections
    peersRef.current.forEach((peer, viewerSocketId) => {
      console.log('Destroying peer connection with viewer:', viewerSocketId);
      peer.destroy();
    });
    peersRef.current.clear();
    setPeers(new Map());

    // Notify server that stream is stopping
    socket.emit('stop-stream');
    setIsStreaming(false);
    setViewerCount(0);

    console.log('Stream stopped successfully');
  };

  // Auto-reconnect peer connections when stream changes
  useEffect(() => {
    if (isStreaming && streamRef.current) {
      // Recreate peer connections for existing viewers
      peersRef.current.forEach((peer, viewerSocketId) => {
        if (peer.destroyed) {
          peersRef.current.delete(viewerSocketId);
          createPeerConnection(viewerSocketId);
        }
      });
    }
  }, [stream, isStreaming]);

  return (
    <div className="AdminStreamPanelContainer">
      <div className="AdminStreamPanelControls">
        <h2 className="AdminStreamPanelTitle">Admin Dashboard</h2>

        <div className="AdminStreamPanelButtonGroup">
          {!isStreaming ? (
            <button 
              onClick={startStream} 
              className="AdminStreamPanelStartBtn"
              disabled={connectionStatus !== 'connected'}
            >
              {connectionStatus !== 'connected' ? 'Connecting...' : 'Start Live Stream'}
            </button>
          ) : (
            <button onClick={stopStream} className="AdminStreamPanelStopBtn">
              Stop Live Stream
            </button>
          )}
        </div>

        {streamError && (
          <div style={{ color: 'red', margin: '10px 0', fontSize: '14px' }}>
            Error: {streamError}
          </div>
        )}

        <div className="AdminStreamPanelInfo">
          <p>Status: {isStreaming ? 'Live' : 'Offline'}</p>
          <p>Connection: {connectionStatus}</p>
          <p>Viewers: {viewerCount}</p>
          <p>Active Connections: {peers.size}</p>
          <p>Socket ID: {socket?.id}</p>
          <p>Admin: {user?.username}</p>
        </div>
      </div>

      <div className="AdminStreamPanelContent">
        <div className="AdminStreamPanelVideo">
          <h3>Your Stream Preview</h3>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="AdminStreamPanelVideoPlayer"
            style={{ 
              width: '100%', 
              maxWidth: '640px', 
              height: 'auto',
              backgroundColor: '#000',
              borderRadius: '8px',
              minHeight: '200px'
            }}
          />
          {!isStreaming && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: 'white',
              textAlign: 'center',
              backgroundColor: 'rgba(0,0,0,0.7)',
              padding: '10px',
              borderRadius: '5px'
            }}>
              <p>Stream Preview</p>
              <p>Click "Start Live Stream" to begin</p>
            </div>
          )}
        </div>

        <div className="AdminStreamPanelChat">
          <Chat socket={socket} user={user} />
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
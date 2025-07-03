import React, { useState, useEffect, useRef } from 'react';
import Peer from 'simple-peer';
import Chat from './Chat';
import './ViewLivestram.css';

const ViewerPanel = ({ socket, user }) => {
  const [isStreamLive, setIsStreamLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [peer, setPeer] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [hasJoinedStream, setHasJoinedStream] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const videoRef = useRef();
  const peerRef = useRef(null);
  const hasSignalledRef = useRef(false);

  useEffect(() => {
    if (!socket) return;

    // Send user info when socket connects
    socket.emit('user-info', {
      username: user.username,
      isAdmin: user.isAdmin
    });

    // Listen for stream events
    socket.on('stream-started', (data) => {
      console.log('✅ Stream started event received:', data);
      setIsStreamLive(true);
      setConnectionError('');
      
      // Auto-join when stream starts (after a small delay)
      setTimeout(() => {
        if (!hasJoinedStream) {
          console.log('Auto-joining stream...');
          joinStream();
        }
      }, 1000);
    });

    socket.on('stream-ended', (data) => {
      console.log('❌ Stream ended event received:', data);
      setIsStreamLive(false);
      setIsConnected(false);
      setIsJoining(false);
      setHasJoinedStream(false);
      setConnectionError('');
      cleanupPeer();
    });

    socket.on('stream-status', (status) => {
      console.log('📊 Stream status received:', status);
      setIsStreamLive(status.isLive);
      setViewerCount(status.viewerCount);
      
      // Auto-join if stream is live and we haven't joined yet
      if (status.isLive && !hasJoinedStream && !isJoining) {
        console.log('Auto-joining stream from status update...');
        setTimeout(() => joinStream(), 500);
      }
    });

    socket.on('viewer-count-update', (data) => {
      console.log('👥 Viewer count update:', data.viewerCount);
      setViewerCount(data.viewerCount);
    });

    socket.on('viewer-joined-confirmed', (data) => {
      console.log('✅ Viewer join confirmed:', data);
      setConnectionError('');
    });

    // Listen for WebRTC signals
    socket.on('webrtc-signal', (data) => {
      console.log('🔄 WebRTC signal received:', data.type, 'from:', data.from);
      if (data.type === 'offer') {
        handleOfferSignal(data);
      }
    });

    socket.on('connect', () => {
      console.log('🔗 Socket connected');
      setConnectionStatus('connected');
      // Request stream status on connect
      socket.emit('get-stream-status');
    });

    socket.on('disconnect', () => {
      console.log('🔌 Socket disconnected');
      setConnectionStatus('disconnected');
      setIsStreamLive(false);
      setIsConnected(false);
      setHasJoinedStream(false);
      cleanupPeer();
    });

    socket.on('stream-error', (error) => {
      console.error('❌ Stream error:', error);
      setConnectionError(error.message);
      setIsJoining(false);
    });

    // Check initial stream status
    socket.emit('get-stream-status');

    return () => {
      socket.off('stream-started');
      socket.off('stream-ended');
      socket.off('stream-status');
      socket.off('viewer-count-update');
      socket.off('viewer-joined-confirmed');
      socket.off('webrtc-signal');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('stream-error');
      cleanupPeer();
    };
  }, [socket, user]);

  const cleanupPeer = () => {
    if (peerRef.current) {
      console.log('🧹 Cleaning up peer connection');
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setPeer(null);
    hasSignalledRef.current = false;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const joinStream = () => {
    if (!socket || hasJoinedStream || isJoining || !isStreamLive) {
      console.log('❌ Cannot join stream:', { 
        hasSocket: !!socket, 
        hasJoinedStream, 
        isJoining, 
        isStreamLive 
      });
      return;
    }

    console.log('🎬 Joining stream...');
    setIsJoining(true);
    setConnectionError('');
    setHasJoinedStream(true);

    // Clean up any existing peer
    cleanupPeer();

    // Notify server that we want to join
    socket.emit('join-stream');

    // Set timeout for join confirmation
    setTimeout(() => {
      if (isJoining && !isConnected) {
        console.log('⏰ Join timeout - no WebRTC offer received');
        setConnectionError('No response from stream - please try again');
        setIsJoining(false);
        setHasJoinedStream(false);
      }
    }, 10000);
  };

  const handleOfferSignal = (data) => {
    console.log('🎯 Handling offer signal from admin:', data.from);
    
    if (peerRef.current) {
      console.log('🧹 Cleaning up existing peer before creating new one');
      cleanupPeer();
    }

    const newPeer = new Peer({
      initiator: false,
      trickle: false,
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

    newPeer.on('signal', (signal) => {
      if (!hasSignalledRef.current) {
        console.log('📡 Sending answer signal to admin');
        hasSignalledRef.current = true;
        socket.emit('webrtc-signal', {
          signal,
          to: data.from,
          type: 'answer',
          from: socket.id
        });
      }
    });

    newPeer.on('stream', (stream) => {
      console.log('🎥 Received stream from admin!', stream);
      console.log('📹 Stream tracks:', stream.getTracks().map(t => `${t.kind}: ${t.enabled}`));
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().then(() => {
          console.log('▶️ Video started playing');
          setIsConnected(true);
          setIsJoining(false);
          setConnectionError('');
        }).catch(error => {
          console.error('❌ Error playing video:', error);
          setConnectionError('Error playing video: ' + error.message);
          setIsJoining(false);
        });
      }
    });

    newPeer.on('error', (err) => {
      console.error('❌ Peer error:', err);
      setConnectionError('Connection failed: ' + err.message);
      setIsConnected(false);
      setIsJoining(false);
      setHasJoinedStream(false);
    });

    newPeer.on('close', () => {
      console.log('🔒 Peer connection closed');
      setIsConnected(false);
      setIsJoining(false);
    });

    newPeer.on('connect', () => {
      console.log('✅ Peer data channel connected');
    });

    // Process the offer signal
    try {
      newPeer.signal(data.signal);
      peerRef.current = newPeer;
      setPeer(newPeer);
    } catch (error) {
      console.error('❌ Error processing offer signal:', error);
      setConnectionError('Error processing connection signal');
      setIsJoining(false);
      setHasJoinedStream(false);
    }

    // Set timeout for connection
    setTimeout(() => {
      if (isJoining && !isConnected && peerRef.current) {
        console.log('⏰ WebRTC connection timeout');
        setConnectionError('Connection timeout - please try again');
        setIsJoining(false);
        setHasJoinedStream(false);
        cleanupPeer();
      }
    }, 15000);
  };

  const leaveStream = () => {
    console.log('🚪 Leaving stream...');
    cleanupPeer();
    setIsConnected(false);
    setIsJoining(false);
    setHasJoinedStream(false);
    setConnectionError('');
    socket.emit('leave-stream');
  };

  const retryConnection = () => {
    console.log('🔄 Retrying connection...');
    setConnectionError('');
    setHasJoinedStream(false);
    setIsJoining(false);
    cleanupPeer();
    setTimeout(() => {
      joinStream();
    }, 1000);
  };

  return (
    <div className="ViewerStreamPanelContainer">
      <div className="ViewerStreamPanelControls">
        <h2>Live Stream Viewer</h2>

        <div className="ViewerStreamPanelInfo">
          <p>Status: {isStreamLive ? 'Live' : 'Offline'}</p>
          <p>Viewers: {viewerCount}</p>
          <p>Connection: {
            isConnected ? 'Connected' : 
            isJoining ? 'Connecting...' : 
            connectionError ? 'Error' : 'Disconnected'
          }</p>
          <p>Socket: {connectionStatus}</p>
          {connectionError && (
            <p style={{ color: 'red', fontSize: '12px' }}>
              {connectionError}
            </p>
          )}
          <p>Socket ID: {socket?.id}</p>
          <p>Joined: {hasJoinedStream ? 'Yes' : 'No'}</p>
        </div>

        <div className="ViewerStreamPanelActions">
          {isStreamLive && !hasJoinedStream && !isJoining && (
            <button onClick={joinStream} className="ViewerStreamPanelJoinBtn">
              Join Stream
            </button>
          )}
          {isJoining && (
            <button disabled className="ViewerStreamPanelJoinBtn">
              Connecting...
            </button>
          )}
          {isConnected && (
            <button onClick={leaveStream} className="ViewerStreamPanelLeaveBtn">
              Leave Stream
            </button>
          )}
          {connectionError && !isJoining && (
            <button onClick={retryConnection} className="ViewerStreamPanelJoinBtn">
              Retry Connection
            </button>
          )}
        </div>
      </div>

      <div className="ViewerStreamPanelContent">
        <div className="ViewerStreamPanelVideoSection">
          <h3>Live Stream</h3>
          {isStreamLive ? (
            <div style={{ position: 'relative' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                controls={false}
                style={{ 
                  width: '100%', 
                  maxWidth: '640px', 
                  height: 'auto',
                  backgroundColor: '#000',
                  borderRadius: '8px',
                  minHeight: '200px'
                }}
              />
              {!isConnected && !isJoining && (
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
                  <p>Stream is live but not connected</p>
                  <p>Click "Join Stream" to connect</p>
                </div>
              )}
              {isJoining && (
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
                  <p>Connecting to stream...</p>
                </div>
              )}
            </div>
          ) : (
            <div className="ViewerStreamPanelNoStream">
              <p>No live stream available</p>
              <p>Please wait for the admin to start streaming</p>
            </div>
          )}
        </div>

        <div className="ViewerStreamPanelChatSection">
          <Chat socket={socket} user={user} />
        </div>
      </div>
    </div>
  );
};

export default ViewerPanel;
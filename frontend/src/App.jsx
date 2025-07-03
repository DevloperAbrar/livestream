import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import Login from './components/Login';
import AdminPanel from './components/AdminPanel';
import ViewerPanel from './components/ViewerPanel';
import './App.css'; // Import your custom CSS

const BACKEND_URL = import.meta.env.VITE_REACT_APP_BACKEND_URL || 'http://localhost:5009';

function App() {
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (token) {
      const userData = JSON.parse(localStorage.getItem('user') || '{}');
      setUser(userData);

      const newSocket = io(BACKEND_URL);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Connected to server:', newSocket.id);
        setIsConnected(true);
        newSocket.emit('user-info', userData);
      });

      newSocket.on('disconnect', () => {
        console.log('Disconnected from server');
        setIsConnected(false);
      });

      return () => {
        newSocket.close();
      };
    }
  }, [token]);

  const handleLogin = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    localStorage.setItem('token', authToken);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (socket) {
      socket.close();
      setSocket(null);
    }
    setIsConnected(false);
  };

  if (!token || !user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="LivestreamappContainer">
      <header className="LivestreamappHeader">
        <h1 className="LivestreamappTitle">Live Stream Platform</h1>
        <div className="LivestreamappUserInfo">
          <span className="LivestreamappUsername">Welcome, {user.username}</span>
          <button className="LivestreamappLogoutButton" onClick={handleLogout}>Logout</button>
          <span className={`LivestreamappStatus ${isConnected ? 'LivestreamappStatusConnected' : 'LivestreamappStatusDisconnected'}`}>
            Status: {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>

      <main className="LivestreamappMain">
        {user.isAdmin ? (
          <AdminPanel socket={socket} user={user} />
        ) : (
          <ViewerPanel socket={socket} user={user} />
        )}
      </main>
    </div>
  );
}

export default App;

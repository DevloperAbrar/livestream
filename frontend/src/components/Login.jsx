import React, { useState } from 'react';
import axios from 'axios';
import './login.css'

const BACKEND_URL = import.meta.env.VITE_REACT_APP_BACKEND_URL || 'http://localhost:5009';

const Login = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    adminKey: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/login' : '/api/register';
      const response = await axios.post(`${BACKEND_URL}${endpoint}`, formData);
      
      onLogin(response.data.user, response.data.token);
    } catch (err) {
      setError(err.response?.data?.error || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="AdminLoginstreamContainer">
      <div className="AdminLoginstreamFormBox">
        <h2 className="AdminLoginstreamTitle">{isLogin ? 'Login' : 'Register'}</h2>

        {error && <div className="AdminLoginstreamError">{error}</div>}

        <form onSubmit={handleSubmit} className="AdminLoginstreamForm">
          <div className="AdminLoginstreamInputGroup">
            <input
              type="text"
              name="username"
              placeholder="Username"
              value={formData.username}
              onChange={handleChange}
              required
              className="AdminLoginstreamInput"
            />
          </div>

          <div className="AdminLoginstreamInputGroup">
            <input
              type="password"
              name="password"
              placeholder="Password"
              value={formData.password}
              onChange={handleChange}
              required
              className="AdminLoginstreamInput"
            />
          </div>

          {!isLogin && (
            <div className="AdminLoginstreamInputGroup">
              <input
                type="password"
                name="adminKey"
                placeholder="Admin Key (optional)"
                value={formData.adminKey}
                onChange={handleChange}
                className="AdminLoginstreamInput"
              />
              <small className="AdminLoginstreamHint">Enter admin key to register as admin</small>
            </div>
          )}

          <button type="submit" disabled={loading} className="AdminLoginstreamButton">
            {loading ? 'Loading...' : (isLogin ? 'Login' : 'Register')}
          </button>
        </form>

        <p className="AdminLoginstreamSwitchText">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button 
            type="button" 
            onClick={() => setIsLogin(!isLogin)} 
            className="AdminLoginstreamSwitchButton"
          >
            {isLogin ? 'Register' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default Login;

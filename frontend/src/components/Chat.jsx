import React, { useState, useEffect, useRef } from 'react';
import './Chat.css'; // Import the CSS file

const Chat = ({ socket, user }) => {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    socket.on('chat-message', (data) => {
      setMessages(prev => [...prev, data]);
    });

    return () => {
      socket.off('chat-message');
    };
  }, [socket]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim() && socket) {
      socket.emit('chat-message', { message: message.trim() });
      setMessage('');
    }
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="AdminChatStreamContainer">
      <h3 className="AdminChatStreamTitle">Live Chat</h3>
      
      <div className="AdminChatStreamMessages">
        {messages.length === 0 ? (
          <div className="AdminChatStreamNoMessages">
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`AdminChatStreamMessage ${msg.isAdmin ? 'AdminChatStreamAdminMessage' : 'AdminChatStreamUserMessage'}`}
            >
              <div className="AdminChatStreamMessageHeader">
                <span className="AdminChatStreamUsername">
                  {msg.username}
                  {msg.isAdmin && <span className="AdminChatStreamBadge">ADMIN</span>}
                </span>
                <span className="AdminChatStreamTimestamp">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="AdminChatStreamMessageContent">{msg.message}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={sendMessage} className="AdminChatStreamInputArea">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type your message..."
          maxLength={500}
          className="AdminChatStreamInput"
        />
        <button
          type="submit"
          disabled={!message.trim()}
          className="AdminChatStreamSendButton"
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default Chat;

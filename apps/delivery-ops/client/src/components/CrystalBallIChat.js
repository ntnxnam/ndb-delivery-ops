/**
 * CrystalBallI Chat Widget
 * 
 * Conversational AI interface for Release Trends page.
 * Allows users to ask questions like "When will this release land?"
 * and get intelligent, context-aware responses.
 */

import React, { useState, useRef, useEffect } from 'react';
import { getApiBase } from '../utils/api';
import './CrystalBallIChat.css';

const API_BASE = getApiBase();

const CrystalBallIChat = ({ 
  releaseVersion, 
  features = [], 
  targetDate, 
  className = '' 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId] = useState(() => `conv_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`);
  
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Focus input when chat opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);
  
  const handleSendMessage = async (message) => {
    if (!message.trim() || isLoading) return;
    
    const userMessage = {
      id: Date.now(),
      type: 'user',
      text: message,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    
    try {
      // Get JIRA credentials from localStorage (same as VooDoo uses)
      const jiraToken = localStorage.getItem('jiraToken') || '';
      const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
      
      const response = await fetch(`${API_BASE}/crystalball-i/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Jira-Token': jiraToken,
          'X-Username': username,
        },
        body: JSON.stringify({
          question: message,
          context: {
            releaseVersion,
            targetDate,
            features,
            conversationId,
            source: 'voodoo_release_trends'
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const aiResponse = await response.json();
      
      const assistantMessage = {
        id: Date.now() + 1,
        type: 'assistant',
        text: aiResponse.answer,
        confidence: aiResponse.confidence,
        reasoning: aiResponse.reasoning,
        keyInsights: aiResponse.keyInsights || [],
        recommendations: aiResponse.recommendations || [],
        followUpQuestions: aiResponse.followUpQuestions || [],
        confidenceLevel: aiResponse.confidenceLevel,
        urgency: aiResponse.urgency,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      
    } catch (error) {
      console.error('CrystalBallI Chat Error:', error);
      
      const errorMessage = {
        id: Date.now() + 1,
        type: 'error',
        text: `I'm having trouble processing your question: ${error.message}. Please try again.`,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleQuickQuestion = (question) => {
    handleSendMessage(question);
  };
  
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(inputValue);
    }
  };
  
  const toggleChat = () => {
    setIsOpen(!isOpen);
    
    // Add welcome message on first open
    if (!isOpen && messages.length === 0) {
      const welcomeMessage = {
        id: Date.now(),
        type: 'assistant',
        text: `Hi! I'm CrystalBallI, your AI assistant for release insights. I can help you understand ${releaseVersion || 'your release'} timeline, risks, team velocity, and more. What would you like to know?`,
        timestamp: new Date(),
        isWelcome: true
      };
      
      setMessages([welcomeMessage]);
    }
  };
  
  const clearChat = () => {
    setMessages([]);
    setInputValue('');
  };
  
  const quickQuestions = [
    "When will this release land?",
    "What are the biggest risks?", 
    "How is team velocity?",
    "Which features are stuck?",
    "What should we descope?"
  ];
  
  const getConfidenceBadge = (confidence) => {
    if (confidence >= 80) return { text: 'High Confidence', class: 'high' };
    if (confidence >= 60) return { text: 'Medium Confidence', class: 'medium' };
    return { text: 'Low Confidence', class: 'low' };
  };
  
  const getUrgencyBadge = (urgency) => {
    if (urgency === 'high') return { text: '⚠️ Urgent', class: 'urgent' };
    if (urgency === 'medium') return { text: '📋 Attention', class: 'attention' };
    return null;
  };
  
  return (
    <div className={`crystalball-chat ${className}`}>
      {/* Chat Toggle Button */}
      <button 
        className={`chat-toggle ${isOpen ? 'open' : ''}`}
        onClick={toggleChat}
        title="Ask CrystalBallI about this release"
      >
        🔮 {isOpen ? 'Close' : 'Ask AI'}
        {messages.length > 1 && !isOpen && (
          <span className="message-indicator">{messages.length - 1}</span>
        )}
      </button>
      
      {/* Chat Window */}
      {isOpen && (
        <div className="chat-window">
          {/* Header */}
          <div className="chat-header">
            <div className="chat-title">
              <span className="ai-icon">🔮</span>
              <div>
                <h3>CrystalBallI</h3>
                <p>AI Release Assistant{releaseVersion && ` • ${releaseVersion}`}</p>
              </div>
            </div>
            <div className="chat-actions">
              <button 
                className="clear-btn" 
                onClick={clearChat}
                title="Clear conversation"
              >
                🗑️
              </button>
              <button 
                className="close-btn" 
                onClick={toggleChat}
                title="Close chat"
              >
                ✕
              </button>
            </div>
          </div>
          
          {/* Messages */}
          <div className="chat-messages">
            {messages.map(message => (
              <div key={message.id} className={`message ${message.type}`}>
                {message.type === 'user' && (
                  <div className="message-content">
                    <div className="message-text">{message.text}</div>
                    <div className="message-time">
                      {message.timestamp.toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </div>
                  </div>
                )}
                
                {message.type === 'assistant' && (
                  <div className="message-content">
                    <div className="message-header">
                      <span className="ai-avatar">🔮</span>
                      <div className="message-meta">
                        {message.confidence !== undefined && (
                          <span className={`confidence-badge ${getConfidenceBadge(message.confidence).class}`}>
                            {getConfidenceBadge(message.confidence).text} ({message.confidence}%)
                          </span>
                        )}
                        {message.urgency && getUrgencyBadge(message.urgency) && (
                          <span className={`urgency-badge ${getUrgencyBadge(message.urgency).class}`}>
                            {getUrgencyBadge(message.urgency).text}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="message-text">{message.text}</div>
                    
                    {/* Key Insights */}
                    {message.keyInsights && message.keyInsights.length > 0 && (
                      <div className="insights-section">
                        <h4>💡 Key Insights</h4>
                        <ul>
                          {message.keyInsights.map((insight, idx) => (
                            <li key={idx} className={`insight ${insight.type}`}>
                              {insight.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {/* Recommendations */}
                    {message.recommendations && message.recommendations.length > 0 && (
                      <div className="recommendations-section">
                        <h4>📋 Recommendations</h4>
                        <ul>
                          {message.recommendations.map((rec, idx) => (
                            <li key={idx}>{rec}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {/* Follow-up Questions */}
                    {message.followUpQuestions && message.followUpQuestions.length > 0 && (
                      <div className="followup-section">
                        <h4>💬 You might also ask:</h4>
                        <div className="followup-questions">
                          {message.followUpQuestions.map((question, idx) => (
                            <button
                              key={idx}
                              className="followup-btn"
                              onClick={() => handleQuickQuestion(question)}
                            >
                              {question}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Reasoning (collapsible) */}
                    {message.reasoning && (
                      <details className="reasoning-section">
                        <summary>🧠 How I arrived at this answer</summary>
                        <p>{message.reasoning}</p>
                      </details>
                    )}
                    
                    <div className="message-time">
                      {message.timestamp.toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </div>
                  </div>
                )}
                
                {message.type === 'error' && (
                  <div className="message-content error">
                    <span className="error-icon">⚠️</span>
                    <div className="message-text">{message.text}</div>
                  </div>
                )}
              </div>
            ))}
            
            {isLoading && (
              <div className="message assistant loading">
                <div className="message-content">
                  <span className="ai-avatar">🔮</span>
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
          
          {/* Quick Questions */}
          {messages.length <= 1 && (
            <div className="quick-questions">
              <p>Try asking:</p>
              <div className="quick-buttons">
                {quickQuestions.map((question, idx) => (
                  <button
                    key={idx}
                    className="quick-btn"
                    onClick={() => handleQuickQuestion(question)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Input */}
          <div className="chat-input">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask me about this release..."
              disabled={isLoading}
              rows="1"
            />
            <button 
              className={`send-btn ${inputValue.trim() ? 'active' : ''}`}
              onClick={() => handleSendMessage(inputValue)}
              disabled={!inputValue.trim() || isLoading}
            >
              🚀
            </button>
          </div>
          
          {/* Footer */}
          <div className="chat-footer">
            <span>🔮 CrystalBallI • Powered by NDB Context Intelligence</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CrystalBallIChat;
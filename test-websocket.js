#!/usr/bin/env node

/**
 * Test WebSocket client for Honeygraph write stream
 */

import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3030/fork-stream';

function testWebSocketConnection() {
  console.log('🔌 Connecting to Honeygraph WebSocket...');
  console.log('URL:', WS_URL);
  
  const ws = new WebSocket(WS_URL);
  
  ws.on('open', () => {
    console.log('✅ Connected to WebSocket');
    
    // Test sending a message
    const testMessage = {
      type: 'hello',
      nodeId: 'test-client-' + Date.now(),
      timestamp: Date.now()
    };
    
    console.log('📤 Sending test message:', testMessage);
    ws.send(JSON.stringify(testMessage));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('📥 Received message:', message);
      
      // Handle authentication challenge
      if (message.type === 'auth_challenge') {
        console.log('🔐 Received authentication challenge');
        console.log('Challenge details:', message);
        
        // For testing, we'll just acknowledge but not provide real auth
        const authResponse = {
          type: 'auth_response',
          challenge: message.challenge,
          account: 'test-unauthorized-account',
          signature: 'fake-signature-for-testing'
        };
        
        console.log('📤 Sending auth response (will fail):', authResponse);
        ws.send(JSON.stringify(authResponse));
      }
    } catch (error) {
      console.log('📥 Received raw message:', data.toString());
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
  });
  
  ws.on('close', (code, reason) => {
    console.log(`🔌 Connection closed - Code: ${code}, Reason: ${reason}`);
  });
  
  // Test timeout
  setTimeout(() => {
    console.log('⏰ Test timeout - closing connection');
    ws.close();
  }, 10000);
}

// Run the test
testWebSocketConnection();
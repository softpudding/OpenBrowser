// DAS Agent Chat Functionality

document.addEventListener('DOMContentLoaded', function() {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatMessages = document.getElementById('chat-messages');
    const chatPanel = document.getElementById('das-chat-panel');
    const rightPanel = document.getElementById('das-right-panel');
    const openChatBtn = document.getElementById('open-chat-btn');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const dasAgentToggle = document.getElementById('das-agent-toggle');
    
    // Open chat panel
    function openChat() {
        if (rightPanel) rightPanel.style.display = 'none';
        if (chatPanel) chatPanel.style.display = 'flex';
    }
    
    // Close chat panel
    function closeChat() {
        if (chatPanel) chatPanel.style.display = 'none';
        if (rightPanel) rightPanel.style.display = 'block';
    }
    
    // Event listeners for open/close buttons
    if (openChatBtn) {
        openChatBtn.addEventListener('click', openChat);
    }
    
    if (closeChatBtn) {
        closeChatBtn.addEventListener('click', closeChat);
    }
    
    if (dasAgentToggle) {
        dasAgentToggle.addEventListener('click', openChat);
    }
    
    // Auto-resize textarea
    if (chatInput) {
        chatInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    }
    
    // Send message function
    function sendMessage() {
        const message = chatInput.value.trim();
        
        if (!message) {
            return;
        }
        
        // Track input message if tracker exists
        if (window.tracker && typeof window.tracker.track === 'function') {
            window.tracker.track('input', {
                element: chatInput.tagName,
                elementId: chatInput.id,
                valueLength: message.length,
                value: message.substring(0, 50) // Limit length for privacy
            });
        }
        
        // Add user message to chat
        addUserMessage(message);
        
        // Clear input
        chatInput.value = '';
        chatInput.style.height = 'auto';
        
        // Disable send button temporarily
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';
        
        // Simulate agent response delay
        setTimeout(function() {
            addAgentMessage('Hello, I am DAS Agent');
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send Message';
        }, 800);
    }
    
    // Add user message to chat
    function addUserMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message user';
        messageDiv.innerHTML = `
            <div class="chat-avatar">👤</div>
            <div class="chat-bubble">${escapeHtml(text)}</div>
        `;
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
    }
    
    // Add agent message to chat
    function addAgentMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        messageDiv.innerHTML = `
            <div class="chat-avatar">🤖</div>
            <div class="chat-bubble">${escapeHtml(text)}</div>
        `;
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
    }
    
    // Scroll chat to bottom
    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Event listeners
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }
    
    if (chatInput) {
        chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }
    
    // Sidebar menu interactions
    const menuItems = document.querySelectorAll('.das-menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            // Remove active class from all items
            menuItems.forEach(mi => mi.classList.remove('active'));
            // Add active class to clicked item
            this.classList.add('active');
            
            // Open chat if DAS Agent is clicked
            if (this.dataset.section === 'das-agent') {
                openChat();
            }
        });
    });
    
    // Tab switching in info section
    const tabs = document.querySelectorAll('.das-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    console.log('DAS Console loaded successfully');
});

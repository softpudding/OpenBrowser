// TechForum JavaScript - Medium Difficulty
// Initialize tracker and add complex interactions

// Initialize tracker immediately (in case DOMContentLoaded already fired)
window.tracker = new AgentTracker('techforum.com', 'medium');

document.addEventListener('DOMContentLoaded', function() {
    let currentQuestionId = null;
    
    // Search functionality - navigate to search results
    const mainSearch = document.getElementById('main-search');
    if (mainSearch) {
        mainSearch.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                tracker.track('search', {
                    query: this.value,
                    location: 'header'
                });
                window.location.href = '/techforum/search.html?q=' + encodeURIComponent(this.value);
            }
        });
    }
    
    // Ask button - navigate to ask page
    const askBtn = document.getElementById('ask-btn');
    if (askBtn) {
        askBtn.addEventListener('click', function() {
            tracker.track('ask_question_click', {
                location: 'header'
            });
            window.location.href = '/techforum/ask.html';
        });
    }
    
    // Login button - navigate to login page
    const loginBtn = document.querySelector('.login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', function() {
            tracker.track('login_click', {
                location: 'header'
            });
            window.location.href = '/techforum/login.html';
        });
    }
    
    // Question link clicks - navigate to question page
    document.querySelectorAll('.question-link').forEach(function(link) {
        link.addEventListener('click', function(e) {
            tracker.track('question_click', {
                questionTitle: this.textContent,
                questionId: this.closest('.question-card').dataset.questionId,
                href: this.href
            });
            // Let navigation happen naturally
        });
    });
    
    // Topic clicks - navigate to topic page
    document.querySelectorAll('.topic-link').forEach(function(link) {
        link.addEventListener('click', function(e) {
            tracker.track('topic_click', {
                topicName: this.textContent,
                href: this.href
            });
            // Let navigation happen naturally
        });
    });
    
    // Column clicks - navigate to column page
    document.querySelectorAll('.column-item').forEach(function(item) {
        item.addEventListener('click', function(e) {
            tracker.track('column_click', {
                columnTitle: this.querySelector('.column-title').textContent,
                href: this.querySelector('a').href
            });
            // Let navigation happen naturally
        });
    });
    
    // Action buttons (upvote, downvote, comment, share, collect)
    document.querySelectorAll('.action-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const action = this.dataset.action;
            const questionCard = this.closest('.question-card');
            const questionId = questionCard.dataset.questionId;
            const questionTitle = questionCard.querySelector('.question-title').textContent;
            
            tracker.track('answer_action', {
                action: action,
                questionId: questionId,
                questionTitle: questionTitle
            });
            
            switch(action) {
                case 'upvote':
                    const wasActive = this.classList.contains('active');
                    this.classList.toggle('active');
                    const upvoteCountSpan = this.querySelector('.count');
                    let upvoteCount = parseInt(upvoteCountSpan.textContent.replace(/,/g, ''));
                    
                    if (!wasActive) {
                        // Now active - add 1
                        upvoteCountSpan.textContent = (upvoteCount + 1).toLocaleString();
                        tracker.track('upvote_toggle', {
                            questionId: questionId,
                            voted: true
                        });
                    } else {
                        // Was active, now removed - subtract 1
                        upvoteCountSpan.textContent = (upvoteCount - 1).toLocaleString();
                        tracker.track('upvote_toggle', {
                            questionId: questionId,
                            voted: false
                        });
                    }
                    break;
                    
                case 'downvote':
                    // Just track, no alert
                    tracker.track('downvote_click', {
                        questionId: questionId
                    });
                    break;
                    
                case 'comment':
                    // Toggle comment section (same as clicking "x 条评论")
                    const commentToggle = questionCard.querySelector(`.comment-toggle[data-question-id="${questionId}"]`);
                    if (commentToggle) {
                        commentToggle.click();
                    }
                    tracker.track('comment_button_click', {
                        questionId: questionId
                    });
                    break;
                    
                case 'share':
                    tracker.track('share_click', {
                        questionId: questionId
                    });
                    // Could navigate to share page or show share modal
                    break;
                    
                case 'collect':
                    tracker.track('collect_click', {
                        questionId: questionId
                    });
                    // Could navigate to collect page or show collect modal
                    break;
            }
        });
    });
    
    // Comment modal functions
    const commentModal = document.getElementById('comment-modal');
    const modalClose = document.getElementById('modal-close');
    const commentCancel = document.getElementById('comment-cancel');
    const commentSubmit = document.getElementById('comment-submit');
    const commentText = document.getElementById('comment-text');
    const modalOverlay = commentModal ? commentModal.querySelector('.modal-overlay') : null;
    
    function openCommentModal(questionTitle) {
        if (commentModal) {
            commentModal.style.display = 'block';
            commentText.focus();
            tracker.track('comment_modal_open', {
                questionId: currentQuestionId,
                questionTitle: questionTitle
            });
        }
    }
    
    function closeCommentModal() {
        if (commentModal) {
            commentModal.style.display = 'none';
            commentText.value = '';
            tracker.track('comment_modal_close', {
                questionId: currentQuestionId
            });
        }
    }
    
    if (modalClose) {
        modalClose.addEventListener('click', closeCommentModal);
    }
    
    if (commentCancel) {
        commentCancel.addEventListener('click', closeCommentModal);
    }
    
    if (commentSubmit) {
        commentSubmit.addEventListener('click', function() {
            const text = commentText.value.trim();
            if (text) {
                tracker.track('comment_submit', {
                    questionId: currentQuestionId,
                    commentLength: text.length
                });
                // Simulate comment submission - just close modal
                closeCommentModal();
            }
            // If empty, just don't submit (no alert)
        });
    }
    
    if (modalOverlay) {
        modalOverlay.addEventListener('click', closeCommentModal);
    }
    
    // Close modal on Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && commentModal && commentModal.style.display === 'block') {
            closeCommentModal();
        }
    });
    
    // Sidebar navigation - navigate to corresponding pages
    document.querySelectorAll('.sidebar-item').forEach(function(item) {
        const href = item.querySelector('a') ? item.querySelector('a').href : null;
        item.addEventListener('click', function(e) {
            if (href) {
                // Let the link navigate naturally
                return;
            }
            // If no href, prevent default and just track
            e.preventDefault();
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            
            const text = this.textContent.trim();
            tracker.track('sidebar_navigation', {
                item: text
            });
        });
    });
    
    // Header navigation - let links navigate naturally
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.addEventListener('click', function(e) {
            tracker.track('header_navigation', {
                item: this.textContent,
                href: this.href
            });
            // Let navigation happen naturally
        });
    });
    
    console.log('[TechForum] Mock website initialized. Tracker active.');

    // Initialize comment sections - hide all by default
    document.querySelectorAll('.comment-list').forEach(function(list) {
        list.style.display = 'none';
    });
    document.querySelectorAll('.comment-toggle').forEach(function(toggle) {
        toggle.classList.remove('active');
    });

    // Comment section toggle functionality
document.querySelectorAll('.comment-toggle').forEach(function(toggle) {
    toggle.addEventListener('click', function() {
        const questionId = this.dataset.questionId;
        const commentList = document.querySelector(`.comment-list[data-question-id="${questionId}"]`);
        
        if (commentList) {
            const isHidden = commentList.style.display === 'none' || !commentList.style.display;
            
            if (isHidden) {
                commentList.style.display = 'block';
                this.classList.add('active');
                tracker.track('comment_section_expand', {
                    questionId: questionId
                });
            } else {
                commentList.style.display = 'none';
                this.classList.remove('active');
                tracker.track('comment_section_collapse', {
                    questionId: questionId
                });
            }
        }
    });
});

// Load more comments - only for buttons inside .comment-load-more that don't have view-all-comments-btn class
document.querySelectorAll('.comment-load-more button:not(.view-all-comments-btn)').forEach(function(btn) {
    btn.addEventListener('click', function() {
        tracker.track('comment_load_more', {});
        // In real app, would load more comments via API
        // For mock, just show a message or add more dummy comments
        this.textContent = '没有更多评论了';
        this.disabled = true;
    });
});

// View all comments modal functionality
const allCommentsModal = document.getElementById('all-comments-modal');
const allCommentsBody = document.getElementById('all-comments-body');
const allCommentsClose = document.getElementById('all-comments-close');
const allCommentsOverlay = document.getElementById('all-comments-overlay');

// View all comments button
document.querySelectorAll('.view-all-comments-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        tracker.track('view_all_comments_click', {});
        
        // Get the comment list from the first question (has 10 comments)
        const commentList = document.querySelector('.comment-list[data-question-id="1"]');
        if (commentList) {
            // Clone all comments (including hidden ones)
            const allCommentItems = commentList.querySelectorAll('.comment-item');
            
            // Clear previous content
            allCommentsBody.innerHTML = '';
            
            // Clone and show all comments
            allCommentItems.forEach(function(item) {
                const clone = item.cloneNode(true);
                clone.style.display = 'block';
                clone.classList.remove('hidden-comment');
                allCommentsBody.appendChild(clone);
            });
            
            // Re-bind event listeners to cloned elements
            cloneEventListeners(allCommentsBody);
            
            // Show modal
            allCommentsModal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    });
});

// Close modal
function closeAllCommentsModal() {
    allCommentsModal.style.display = 'none';
    document.body.style.overflow = 'auto';
}

if (allCommentsClose) {
    allCommentsClose.addEventListener('click', closeAllCommentsModal);
}

if (allCommentsOverlay) {
    allCommentsOverlay.addEventListener('click', closeAllCommentsModal);
}

// Close on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && allCommentsModal && allCommentsModal.style.display === 'flex') {
        closeAllCommentsModal();
    }
});

// Helper function to clone event listeners
function cloneEventListeners(container) {
    // Like buttons
    container.querySelectorAll('.comment-action-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const text = this.textContent.trim();
            
            if (text.includes('👍')) {
                const wasActive = this.classList.contains('active');
                this.classList.toggle('active');
                
                const match = text.match(/👍\s*(\d+)/);
                if (match) {
                    let count = parseInt(match[1]);
                    if (!wasActive) {
                        this.textContent = '👍 ' + (count + 1);
                    } else {
                        this.textContent = '👍 ' + (count - 1);
                    }
                }
                
                tracker.track('comment_like', { liked: !wasActive });
            } else if (text === '回复') {
                tracker.track('comment_reply_click', {});
                
                // Remove any existing reply inputs
                container.querySelectorAll('.reply-input-container').forEach(el => el.remove());
                
                // Create reply input
                const replyContainer = document.createElement('div');
                replyContainer.className = 'reply-input-container';
                replyContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 8px;';
                replyContainer.innerHTML = `
                    <input type="text" class="reply-input" placeholder="写下你的回复..." 
                        style="flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;">
                    <button class="reply-submit" 
                        style="padding: 6px 12px; background: #0066ff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
                        回复
                    </button>
                    <button class="reply-cancel"
                        style="padding: 6px 12px; background: #fff; color: #666; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 13px;">
                        取消
                    </button>
                `;
                
                const commentActions = this.closest('.comment-actions');
                commentActions.parentNode.insertBefore(replyContainer, commentActions.nextSibling);
                
                const input = replyContainer.querySelector('.reply-input');
                input.focus();
                
                replyContainer.querySelector('.reply-cancel').addEventListener('click', function() {
                    replyContainer.remove();
                });
                
                replyContainer.querySelector('.reply-submit').addEventListener('click', function() {
                    const replyText = input.value.trim();
                    if (replyText) {
                        tracker.track('comment_reply_submit', { replyLength: replyText.length });
                        
                        // Create reply element
                        const replyItem = document.createElement('div');
                        replyItem.className = 'comment-item';
                        replyItem.style.cssText = 'padding-left: 42px; background: #f9f9f9;';
                        replyItem.innerHTML = `
                            <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1zaXplPSI0MCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiM2NjYiPkE8L3RleHQ+PC9zdmc+" alt="avatar" class="comment-avatar">
                            <div class="comment-content">
                                <div class="comment-header">
                                    <span class="comment-author">我</span>
                                    <span class="comment-time">刚刚</span>
                                </div>
                                <div class="comment-text">${replyText}</div>
                                <div class="comment-actions">
                                    <button class="comment-action-btn">👍 0</button>
                                    <button class="comment-action-btn">回复</button>
                                </div>
                            </div>
                        `;
                        
                        // Find the original comment in the main comment list
                        const currentComment = replyContainer.closest('.comment-item');
                        if (currentComment) {
                            // Check if we're in modal or main list
                            const isInModal = currentComment.closest('.all-comments-body') !== null;
                            
                            if (isInModal) {
                                // Add to modal
                                currentComment.parentNode.insertBefore(replyItem.cloneNode(true), currentComment.nextSibling);
                                
                                // Also add to original comment list
                                const originalCommentList = document.querySelector('.comment-list[data-question-id="1"]');
                                if (originalCommentList) {
                                    // Find corresponding comment by index or content
                                    const commentIndex = Array.from(currentComment.parentNode.children).indexOf(currentComment);
                                    const originalComments = originalCommentList.querySelectorAll('.comment-item:not(.hidden-comment)');
                                    if (originalComments[commentIndex]) {
                                        const originalReply = replyItem.cloneNode(true);
                                        originalComments[commentIndex].parentNode.insertBefore(originalReply, originalComments[commentIndex].nextSibling);
                                    }
                                }
                            } else {
                                // Add to main list
                                currentComment.parentNode.insertBefore(replyItem, currentComment.nextSibling);
                                
                                // Also add to modal if open
                                const modalBody = document.getElementById('all-comments-body');
                                if (modalBody && modalBody.style.display !== 'none') {
                                    const modalComments = modalBody.querySelectorAll('.comment-item');
                                    if (modalComments[commentIndex]) {
                                        const modalReply = replyItem.cloneNode(true);
                                        modalComments[commentIndex].parentNode.insertBefore(modalReply, modalComments[commentIndex].nextSibling);
                                    }
                                }
                            }
                        }
                        
                        // Remove input
                        replyContainer.remove();
                        
                        // Re-bind event listeners to new comment
                        const newLikeBtn = replyItem.querySelector('.comment-action-btn');
                        if (newLikeBtn) {
                            newLikeBtn.addEventListener('click', function(e) {
                                e.stopPropagation();
                                const text = this.textContent.trim();
                                if (text.includes('👍')) {
                                    this.classList.toggle('active');
                                    const match = text.match(/👍\s*(\d+)/);
                                    if (match) {
                                        let count = parseInt(match[1]);
                                        count = this.classList.contains('active') ? count + 1 : count - 1;
                                        this.textContent = '👍 ' + count;
                                    }
                                    tracker.track('comment_like', { liked: this.classList.contains('active') });
                                }
                            });
                        }
                    }
                });
                
                input.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        replyContainer.querySelector('.reply-submit').click();
                    }
                });
            }
        });
    });
    
    // +1 buttons
    container.querySelectorAll('.comment-plus-one-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            tracker.track('comment_plus_one', {});
            
            const commentList = this.closest('.comment-list') || this.closest('.all-comments-body');
            const replyItem = document.createElement('div');
            replyItem.className = 'comment-item';
            replyItem.innerHTML = `
                <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1zaXplPSI0MCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiM2NjYiPkE8L3RleHQ+PC9zdmc+" alt="avatar" class="comment-avatar">
                <div class="comment-content">
                    <div class="comment-header">
                        <span class="comment-author">我</span>
                        <span class="comment-time">刚刚</span>
                    </div>
                    <div class="comment-text">+1</div>
                    <div class="comment-actions">
                        <button class="comment-action-btn">👍 0</button>
                        <button class="comment-action-btn">回复</button>
                    </div>
                </div>
            `;
            
            const inputArea = commentList.querySelector('.comment-input-area');
            if (inputArea) {
                inputArea.parentNode.insertBefore(replyItem, inputArea.nextSibling);
            } else {
                commentList.insertBefore(replyItem, commentList.firstChild);
            }
            
            cloneEventListeners(replyItem);
        });
    });
}


// Enhanced comment like functionality with count update
document.querySelectorAll('.comment-action-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const text = this.textContent.trim();
        
        if (text.includes('👍')) {
            // Like button - toggle state and update count
            const wasActive = this.classList.contains('active');
            this.classList.toggle('active');
            
            // Extract current count
            const match = text.match(/👍\s*(\d+)/);
            if (match) {
                let count = parseInt(match[1]);
                if (!wasActive) {
                    count++;
                    this.textContent = '👍 ' + count;
                } else {
                    count--;
                    this.textContent = '👍 ' + count;
                }
            }
            
            tracker.track('comment_like', {
                liked: !wasActive,
                newCount: wasActive ? parseInt(match[1]) - 1 : parseInt(match[1]) + 1
            });
        } else if (text === '回复') {
            // Reply button - show reply input
            tracker.track('comment_reply_click', {});
            
            // Remove any existing reply inputs
            document.querySelectorAll('.reply-input-container').forEach(el => el.remove());
            
            // Create reply input
            const replyContainer = document.createElement('div');
            replyContainer.className = 'reply-input-container';
            replyContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 8px;';
            replyContainer.innerHTML = `
                <input type="text" class="reply-input" placeholder="写下你的回复..." 
                    style="flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;">
                <button class="reply-submit" 
                    style="padding: 6px 12px; background: #0066ff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
                    回复
                </button>
                <button class="reply-cancel"
                    style="padding: 6px 12px; background: #fff; color: #666; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 13px;">
                    取消
                </button>
            `;
            
            // Insert after the comment actions
            const commentActions = this.closest('.comment-actions');
            commentActions.parentNode.insertBefore(replyContainer, commentActions.nextSibling);
            
            // Focus the input
            const input = replyContainer.querySelector('.reply-input');
            input.focus();
            
            // Cancel button
            replyContainer.querySelector('.reply-cancel').addEventListener('click', function() {
                replyContainer.remove();
            });
            
            // Submit button
            replyContainer.querySelector('.reply-submit').addEventListener('click', function() {
                const replyText = input.value.trim();
                if (replyText) {
                    tracker.track('comment_reply_submit', {
                        replyLength: replyText.length
                    });
                    
                    // Add reply to the comment (mock)
                    const replyItem = document.createElement('div');
                    replyItem.className = 'comment-item';
                    replyItem.style.cssText = 'padding-left: 42px; background: #f9f9f9;';
                    replyItem.innerHTML = `
                        <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1zaXplPSI0MCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiM2NjYiPkE8L3RleHQ+PC9zdmc+" alt="avatar" class="comment-avatar">
                        <div class="comment-content">
                            <div class="comment-header">
                                <span class="comment-author">我</span>
                                <span class="comment-time">刚刚</span>
                            </div>
                            <div class="comment-text">${replyText}</div>
                            <div class="comment-actions">
                                <button class="comment-action-btn">👍 0</button>
                                <button class="comment-action-btn">回复</button>
                            </div>
                        </div>
                    `;
                    
                    // Insert after current comment
                    const currentComment = replyContainer.closest('.comment-item');
                    currentComment.parentNode.insertBefore(replyItem, currentComment.nextSibling);
                    
                    // Remove input
                    replyContainer.remove();
                    
                    // Re-bind event listeners to new comment
                    const newLikeBtn = replyItem.querySelector('.comment-action-btn');
                    if (newLikeBtn) {
                        newLikeBtn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            const text = this.textContent.trim();
                            if (text.includes('👍')) {
                                this.classList.toggle('active');
                                const match = text.match(/👍\s*(\d+)/);
                                if (match) {
                                    let count = parseInt(match[1]);
                                    count = this.classList.contains('active') ? count + 1 : count - 1;
                                    this.textContent = '👍 ' + count;
                                }
                                tracker.track('comment_like', { liked: this.classList.contains('active') });
                            }
                        });
                    }
                }
            });
            
            // Submit on Enter
            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    replyContainer.querySelector('.reply-submit').click();
                }
            });
        }
    });
    });

    // Comment input area - submit button click
    document.querySelectorAll('.comment-submit-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        const questionId = this.dataset.questionId;
        const inputField = document.querySelector(`.comment-input-field[data-question-id="${questionId}"]`);
        
        if (inputField) {
            const text = inputField.value.trim();
            if (text) {
                tracker.track('comment_submit_direct', {
                    questionId: questionId,
                    commentLength: text.length
                });
                
                // Create new comment
                const commentItem = document.createElement('div');
                commentItem.className = 'comment-item';
                commentItem.innerHTML = `
                    <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1zaXplPSI0MCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiM2NjYiPkE8L3RleHQ+PC9zdmc+" alt="avatar" class="comment-avatar">
                    <div class="comment-content">
                        <div class="comment-header">
                            <span class="comment-author">我</span>
                            <span class="comment-time">刚刚</span>
                        </div>
                        <div class="comment-text">${text}</div>
                        <div class="comment-actions">
                            <button class="comment-action-btn">👍 0</button>
                            <button class="comment-action-btn">回复</button>
                        </div>
                    </div>
                `;
                
                // Insert at the beginning of comment list (after input area)
                const commentList = document.querySelector(`.comment-list[data-question-id="${questionId}"]`);
                const inputArea = commentList.querySelector('.comment-input-area');
                
                if (commentList && inputArea) {
                    commentList.insertBefore(commentItem, inputArea.nextSibling);
                }
                
                // Clear input
                inputField.value = '';
                
                // Update comment count
                const commentToggle = document.querySelector(`.comment-toggle[data-question-id="${questionId}"]`);
                const countSpan = commentToggle?.querySelector('.comment-count');
                if (countSpan) {
                    const match = countSpan.textContent.match(/(\d+)/);
                    if (match) {
                        const count = parseInt(match[1]) + 1;
                        countSpan.textContent = count + ' 条评论';
                    }
                }
                
                // Re-bind event listeners to new comment
                const likeBtn = commentItem.querySelector('.comment-action-btn');
                const replyBtn = commentItem.querySelectorAll('.comment-action-btn')[1];
                
                if (likeBtn) {
                    likeBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        this.classList.toggle('active');
                        const text = this.textContent.trim();
                        const match = text.match(/👍\s*(\d+)/);
                        if (match) {
                            let count = parseInt(match[1]);
                            count = this.classList.contains('active') ? count + 1 : count - 1;
                            this.textContent = '👍 ' + count;
                        }
                        tracker.track('comment_like', { liked: this.classList.contains('active') });
                    });
                }
                
                if (replyBtn) {
                    replyBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        tracker.track('comment_reply_click', {});
                        
                        // Remove any existing reply inputs
                        document.querySelectorAll('.reply-input-container').forEach(el => el.remove());
                        
                        // Create reply input
                        const replyContainer = document.createElement('div');
                        replyContainer.className = 'reply-input-container';
                        replyContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 8px;';
                        replyContainer.innerHTML = `
                            <input type="text" class="reply-input" placeholder="写下你的回复..." 
                                style="flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;">
                            <button class="reply-submit" 
                                style="padding: 6px 12px; background: #0066ff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
                                回复
                            </button>
                            <button class="reply-cancel"
                                style="padding: 6px 12px; background: #fff; color: #666; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 13px;">
                                取消
                            </button>
                        `;
                        
                        const commentActions = this.closest('.comment-actions');
                        commentActions.parentNode.insertBefore(replyContainer, commentActions.nextSibling);
                        
                        const input = replyContainer.querySelector('.reply-input');
                        input.focus();
                        
                        replyContainer.querySelector('.reply-cancel').addEventListener('click', function() {
                            replyContainer.remove();
                        });
                        
                        replyContainer.querySelector('.reply-submit').addEventListener('click', function() {
                            const replyText = input.value.trim();
                            if (replyText) {
                                tracker.track('comment_reply_submit', { replyLength: replyText.length });
                                
                                const replyItem = document.createElement('div');
                                replyItem.className = 'comment-item';
                                replyItem.style.cssText = 'padding-left: 42px; background: #f9f9f9;';
                                replyItem.innerHTML = `
                                    <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1zaXplPSI0MCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiM2NjYiPkE8L3RleHQ+PC9zdmc+" alt="avatar" class="comment-avatar">
                                    <div class="comment-content">
                                        <div class="comment-header">
                                            <span class="comment-author">我</span>
                                            <span class="comment-time">刚刚</span>
                                        </div>
                                        <div class="comment-text">${replyText}</div>
                                        <div class="comment-actions">
                                            <button class="comment-action-btn">👍 0</button>
                                            <button class="comment-action-btn">回复</button>
                                        </div>
                                    </div>
                                `;
                                
                                const currentComment = replyContainer.closest('.comment-item');
                                currentComment.parentNode.insertBefore(replyItem, currentComment.nextSibling);
                                replyContainer.remove();
                            }
                        });
                        
                        input.addEventListener('keypress', function(e) {
                            if (e.key === 'Enter') {
                                replyContainer.querySelector('.reply-submit').click();
                            }
                        });
                    });
                }
            }
        }
    });
    });

    // Comment input - submit on Enter
    document.querySelectorAll('.comment-input-field').forEach(function(input) {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const questionId = this.dataset.questionId;
                const submitBtn = document.querySelector(`.comment-submit-btn[data-question-id="${questionId}"]`);
                if (submitBtn) {
                    submitBtn.click();
                }
            }
        });
    });
    
    // +1 button - quick comment
    document.querySelectorAll('.comment-plus-one-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const questionId = this.dataset.questionId;
            
            tracker.track('comment_plus_one', {
                questionId: questionId
            });
            
            // Create a +1 comment
            const commentList = document.querySelector(`.comment-list[data-question-id="${questionId}"]`);
            if (commentList) {
                const commentItem = document.createElement('div');
                commentItem.className = 'comment-item';
                commentItem.innerHTML = `
                    <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1zaXplPSI0MCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiM2NjYiPkE8L3RleHQ+PC9zdmc+" alt="avatar" class="comment-avatar">
                    <div class="comment-content">
                        <div class="comment-header">
                            <span class="comment-author">我</span>
                            <span class="comment-time">刚刚</span>
                        </div>
                        <div class="comment-text">+1</div>
                        <div class="comment-actions">
                            <button class="comment-action-btn">👍 0</button>
                            <button class="comment-action-btn">回复</button>
                        </div>
                    </div>
                `;
                
                const inputArea = commentList.querySelector('.comment-input-area');
                if (inputArea) {
                    commentList.insertBefore(commentItem, inputArea.nextSibling);
                }
                
                // Update comment count
                const commentToggle = document.querySelector(`.comment-toggle[data-question-id="${questionId}"]`);
                const countSpan = commentToggle?.querySelector('.comment-count');
                if (countSpan) {
                    const match = countSpan.textContent.match(/(\d+)/);
                    if (match) {
                        const count = parseInt(match[1]) + 1;
                        countSpan.textContent = count + ' 条评论';
                    }
                }
            }
        });
    });

}); // End DOMContentLoaded

// CloudStack Homepage JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Top Banner close functionality
    const bannerClose = document.getElementById('banner-close');
    const topBanner = document.getElementById('top-banner');
    
    if (bannerClose && topBanner) {
        bannerClose.addEventListener('click', function() {
            topBanner.style.display = 'none';
        });
    }
    
    // Mobile menu toggle
    const hamburgerMenu = document.getElementById('hamburger-menu');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    const mobileMenuClose = document.getElementById('mobile-menu-close');
    
    if (hamburgerMenu && mobileMenuOverlay) {
        hamburgerMenu.addEventListener('click', function() {
            mobileMenuOverlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        });
    }
    
    if (mobileMenuClose && mobileMenuOverlay) {
        mobileMenuClose.addEventListener('click', function() {
            mobileMenuOverlay.style.display = 'none';
            document.body.style.overflow = '';
        });
    }
    
    if (mobileMenuOverlay) {
        mobileMenuOverlay.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
    }
    
    // Search functionality
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    
    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', function() {
            const query = searchInput.value.trim();
            if (query) {
                window.location.href = `search.html?q=${encodeURIComponent(query)}`;
            }
        });
        
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (query) {
                    window.location.href = `search.html?q=${encodeURIComponent(query)}`;
                }
            }
        });
    }
    
    // Products Dropdown
    const productsLink = document.querySelector('[data-dropdown="products"]');
    const productsDropdown = document.getElementById('products-dropdown');
    
    if (productsLink && productsDropdown) {
        productsLink.addEventListener('mouseenter', function() {
            productsDropdown.style.display = 'block';
        });
        
        productsDropdown.addEventListener('mouseenter', function() {
            productsDropdown.style.display = 'block';
        });
        
        productsDropdown.addEventListener('mouseleave', function() {
            productsDropdown.style.display = 'none';
        });
        
        productsLink.addEventListener('mouseleave', function() {
            setTimeout(() => {
                if (!productsDropdown.matches(':hover')) {
                    productsDropdown.style.display = 'none';
                }
            }, 200);
        });
    }
    
    // Login - Navigate to console login page
    const loginBtn = document.getElementById('login-btn');
    const mobileLoginBtn = document.getElementById('mobile-login-btn');
    
    if (loginBtn) {
        loginBtn.addEventListener('click', function() {
            window.location.href = 'console-login.html';
        });
    }
    
    if (mobileLoginBtn) {
        mobileLoginBtn.addEventListener('click', function() {
            mobileMenuOverlay.style.display = 'none';
            document.body.style.overflow = '';
            setTimeout(() => {
                window.location.href = 'console-login.html';
            }, 300);
        });
    }
    
    // Signup Modal
    const signupBtn = document.getElementById('signup-btn');
    const mobileSignupBtn = document.getElementById('mobile-signup-btn');
    const signupModalClose = document.getElementById('signup-modal-close');
    const showLogin = document.getElementById('show-login');
    
    function openSignupModal() {
        if (signupModalOverlay) {
            signupModalOverlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            if (loginModalOverlay) loginModalOverlay.style.display = 'none';
        }
    }
    
    if (signupBtn) signupBtn.addEventListener('click', openSignupModal);
    if (mobileSignupBtn) mobileSignupBtn.addEventListener('click', function() {
        mobileMenuOverlay.style.display = 'none';
        document.body.style.overflow = '';
        setTimeout(openSignupModal, 300);
    });
    
    if (signupModalClose) {
        signupModalClose.addEventListener('click', function() {
            signupModalOverlay.style.display = 'none';
            document.body.style.overflow = '';
        });
    }
    
    if (signupModalOverlay) {
        signupModalOverlay.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
    }
    
    if (showSignup) {
        showSignup.addEventListener('click', function(e) {
            e.preventDefault();
            openSignupModal();
        });
    }
    
    if (showLogin) {
        showLogin.addEventListener('click', function(e) {
            e.preventDefault();
            if (signupModalOverlay) signupModalOverlay.style.display = 'none';
            setTimeout(openLoginModal, 100);
        });
    }
    
    // Login Form Submit
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;
            
            // Simulate login
            console.log('Login attempt:', username);
            alert('Login successful! Welcome to CloudStack.');
            
            // Hide login modal and show user avatar
            if (loginModalOverlay) {
                loginModalOverlay.style.display = 'none';
                document.body.style.overflow = '';
            }
            
            const userAvatar = document.getElementById('user-avatar');
            const loginBtnEl = document.getElementById('login-btn');
            const signupBtnEl = document.getElementById('signup-btn');
            
            if (userAvatar) {
                userAvatar.style.display = 'flex';
                userAvatar.textContent = username.charAt(0).toUpperCase();
            }
            if (loginBtnEl) loginBtnEl.style.display = 'none';
            if (signupBtnEl) signupBtnEl.style.display = 'none';
        });
    }
    
    // Signup Form Submit
    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
        signupForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const email = document.getElementById('signup-email').value;
            const password = document.getElementById('signup-password').value;
            const confirm = document.getElementById('signup-confirm').value;
            
            if (password !== confirm) {
                alert('Passwords do not match!');
                return;
            }
            
            console.log('Signup attempt:', email);
            alert('Account created successfully! Welcome to CloudStack.');
            
            if (signupModalOverlay) {
                signupModalOverlay.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
    }
    
    // Notification Panel
    const notificationBtn = document.getElementById('notification-btn');
    const notificationPanel = document.getElementById('notification-panel');
    const notificationPanelClose = document.getElementById('notification-panel-close');
    const markAllRead = document.getElementById('mark-all-read');
    
    if (notificationBtn && notificationPanel) {
        notificationBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            notificationPanel.style.display = notificationPanel.style.display === 'none' ? 'block' : 'none';
        });
        
        document.addEventListener('click', function(e) {
            if (notificationPanel && !notificationPanel.contains(e.target) && !notificationBtn.contains(e.target)) {
                notificationPanel.style.display = 'none';
            }
        });
    }
    
    if (notificationPanelClose && notificationPanel) {
        notificationPanelClose.addEventListener('click', function() {
            notificationPanel.style.display = 'none';
        });
    }
    
    if (markAllRead && notificationPanel) {
        markAllRead.addEventListener('click', function() {
            const unreadItems = notificationPanel.querySelectorAll('.notification-item.unread');
            unreadItems.forEach(item => {
                item.classList.remove('unread');
            });
            const badge = notificationBtn.querySelector('.badge');
            if (badge) {
                badge.textContent = '0';
                badge.style.display = 'none';
            }
        });
    }
    
    // Language Modal
    const langBtn = document.getElementById('lang-btn');
    const langModalOverlay = document.getElementById('lang-modal-overlay');
    const langModalClose = document.getElementById('lang-modal-close');
    const langItems = document.querySelectorAll('.lang-item');
    
    if (langBtn && langModalOverlay) {
        langBtn.addEventListener('click', function() {
            langModalOverlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        });
    }
    
    if (langModalClose && langModalOverlay) {
        langModalClose.addEventListener('click', function() {
            langModalOverlay.style.display = 'none';
            document.body.style.overflow = '';
        });
    }
    
    if (langModalOverlay) {
        langModalOverlay.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
    }
    
    if (langItems) {
        langItems.forEach(item => {
            item.addEventListener('click', function() {
                langItems.forEach(i => i.classList.remove('active'));
                this.classList.add('active');
                setTimeout(() => {
                    langModalOverlay.style.display = 'none';
                    document.body.style.overflow = '';
                    alert('Language changed to: ' + this.querySelector('.lang-name').textContent);
                }, 200);
            });
        });
    }
    
    // Docs Button
    const docsBtn = document.getElementById('docs-btn');
    if (docsBtn) {
        docsBtn.addEventListener('click', function() {
            window.location.href = 'docs.html';
        });
    }
    
    // Hero buttons
    const heroViewNow = document.getElementById('hero-view-now');
    const heroConsultation = document.getElementById('hero-consultation');
    const heroFreeTrial = document.getElementById('hero-free-trial');
    
    if (heroViewNow) {
        heroViewNow.addEventListener('click', function() {
            window.location.href = 'console.html';
        });
    }
    
    if (heroConsultation) {
        heroConsultation.addEventListener('click', function() {
            window.location.href = 'support.html#consultation';
        });
    }
    
    if (heroFreeTrial) {
        heroFreeTrial.addEventListener('click', function() {
            window.location.href = 'promotions.html#free-trial';
        });
    }
    
    // CTA Section Free Trial
    const ctaFreeTrial = document.querySelector('.cta-section .hero-btn');
    if (ctaFreeTrial) {
        ctaFreeTrial.addEventListener('click', function() {
            window.location.href = 'promotions.html#free-trial';
        });
    }
    
    // Password Strength Indicator
    const passwordInput = document.getElementById('signup-password');
    const passwordStrength = document.getElementById('password-strength');
    
    if (passwordInput && passwordStrength) {
        passwordInput.addEventListener('input', function() {
            const value = this.value;
            let strength = 0;
            
            if (value.length >= 8) strength++;
            if (/[a-z]/.test(value) && /[A-Z]/.test(value)) strength++;
            if (/\d/.test(value)) strength++;
            if (/[^a-zA-Z0-9]/.test(value)) strength++;
            
            passwordStrength.className = 'password-strength';
            if (value.length === 0) {
                passwordStrength.style.display = 'none';
            } else {
                passwordStrength.style.display = 'block';
                if (strength <= 1) passwordStrength.classList.add('weak');
                else if (strength <= 2) passwordStrength.classList.add('medium');
                else passwordStrength.classList.add('strong');
            }
        });
    }
    
    // Captcha Refresh
    const refreshCaptcha = document.getElementById('refresh-captcha');
    const captchaImage = document.getElementById('captcha-image');
    
    if (refreshCaptcha && captchaImage) {
        refreshCaptcha.addEventListener('click', function() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let captcha = '';
            for (let i = 0; i < 5; i++) {
                captcha += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            captchaImage.textContent = captcha;
        });
    }
    
    // Social Login Buttons
    const socialBtns = document.querySelectorAll('.social-btn');
    socialBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const method = this.classList.contains('wechat') ? 'WeChat' : 
                          this.classList.contains('alipay') ? 'Alipay' : 'Phone';
            alert(`${method} login - This would open ${method} QR code in a real implementation.`);
        });
    });
    
    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            if (href !== '#' && href.length > 1) {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            }
        });
    });
    
    // Add scroll animation to header
    let lastScroll = 0;
    const header = document.querySelector('.homepage-header');
    
    window.addEventListener('scroll', function() {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll > 100) {
            header.style.boxShadow = '0 2px 16px rgba(0,0,0,0.1)';
        } else {
            header.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
        }
        
        lastScroll = currentScroll;
    });
    
    console.log('CloudStack Homepage loaded successfully');
});

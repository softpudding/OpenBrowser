// Pricing Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Pricing Period Toggle
    const toggleBtns = document.querySelectorAll('.toggle-btn');
    const priceAmounts = document.querySelectorAll('.plan-price .amount');
    
    // Store original prices
    const originalPrices = {
        '0': '0',
        '0.024': '0.024',
        '999': '999'
    };
    
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            toggleBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const period = this.dataset.period;
            
            // Update prices based on period
            priceAmounts.forEach((amount, index) => {
                const keys = Object.keys(originalPrices);
                const key = keys[index % keys.length];
                
                if (period === 'hourly') {
                    amount.textContent = originalPrices[key];
                } else if (period === 'monthly') {
                    if (key === '0') {
                        amount.textContent = '0';
                    } else if (key === '0.024') {
                        amount.textContent = '17.28';
                    } else if (key === '999') {
                        amount.textContent = '999';
                    }
                } else if (period === 'yearly') {
                    if (key === '0') {
                        amount.textContent = '0';
                    } else if (key === '0.024') {
                        amount.textContent = '138.24';
                    } else if (key === '999') {
                        amount.textContent = '9590';
                    }
                }
            });
        });
    });
    
    // Pricing Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            // Update active tab
            tabBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // Update tab content
            const tabId = this.dataset.tab;
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === tabId) {
                    content.classList.add('active');
                }
            });
        });
    });
    
    // Table buttons
    const tableBtns = document.querySelectorAll('.table-btn');
    tableBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const row = this.closest('tr');
            const productName = row.querySelector('td:first-child').textContent;
            alert(`Adding ${productName} to cart...`);
        });
    });
    
    console.log('Pricing page loaded successfully');
});

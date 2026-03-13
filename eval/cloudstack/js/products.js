// Products Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Category Filter
    const filterBtns = document.querySelectorAll('.filter-btn');
    const productItems = document.querySelectorAll('.product-item');
    
    filterBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            // Update active state
            filterBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // Filter products
            const category = this.dataset.category;
            
            productItems.forEach(item => {
                if (category === 'all' || item.classList.contains(category)) {
                    item.classList.remove('hidden');
                } else {
                    item.classList.add('hidden');
                }
            });
        });
    });
    
    // Product buttons - navigate to detail page
    const productBtns = document.querySelectorAll('.product-btn');
    productBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const productCard = this.closest('.product-item');
            const productName = productCard.querySelector('h3').textContent;
            alert(`Navigating to ${productName} detail page...`);
            // In a real implementation, this would navigate to the product detail page
        });
    });
    
    console.log('Products page loaded successfully');
});

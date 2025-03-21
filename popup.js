document.addEventListener('DOMContentLoaded', function() {
  console.log('Popup loaded');
  const statusElement = document.getElementById('status');
  const toggleButton = document.getElementById('toggleMonitoring');
  const productListElement = document.getElementById('productList');
  const addProductButton = document.getElementById('addProduct');
  const checkNowButton = document.getElementById('checkNow');
  const checkIntervalInput = document.getElementById('checkInterval');
  const purchaseLimitInput = document.getElementById('purchaseLimit');
  const resetCountButton = document.getElementById('resetCount');
  const purchaseCountElement = document.getElementById('purchaseCount');
  const statusMessageElement = document.getElementById('status-message');
  
  let isMonitoring = false;
  let stockStatus = {};
  let monitoredProducts = [];
  
  // Load initial state
  chrome.runtime.sendMessage({ action: 'getProducts' }, (response) => {
    if (response) {
      stockStatus = response.stockStatus || {};
      monitoredProducts = response.products || [];
      updateProductList(monitoredProducts);
    } else {
      console.error('No response received from getProducts');
      updateProductList([]);
    }
  });
  
  chrome.storage.sync.get(['checkInterval', 'purchaseLimit'], (result) => {
    checkIntervalInput.value = result.checkInterval || 30;
    purchaseLimitInput.value = result.purchaseLimit || 3;
  });
  
  // Check if monitoring is already active
  chrome.runtime.sendMessage({ action: 'getMonitoringStatus' }, (response) => {
    if (response) {
      isMonitoring = response.isMonitoring || false;
      updateMonitoringUI();
    }
  });
  
  // Update purchase count display
  function updatePurchaseCountDisplay() {
    chrome.runtime.sendMessage({ action: 'getPurchaseStats' }, (response) => {
      if (response) {
        purchaseCountElement.textContent = `Items Purchased: ${response.count}/${response.limit}`;
        
        // Disable all cart buttons if limit reached
        if (response.count >= response.limit) {
          document.querySelectorAll('.cart-btn').forEach(btn => {
            btn.disabled = true;
            btn.title = 'Purchase limit reached';
          });
        }
      }
    });
  }
  
  // Update purchase count on load
  updatePurchaseCountDisplay();
  
  // Reset purchase count
  resetCountButton.addEventListener('click', function() {
    this.textContent = 'Resetting...';
    this.disabled = true;
    
    chrome.runtime.sendMessage({ action: 'resetPurchaseCount' }, (response) => {
      if (response && response.success) {
        updatePurchaseCountDisplay();
        statusMessageElement.textContent = 'Purchase count reset!';
        statusMessageElement.style.color = '#22c55e';
        
        // Re-enable cart buttons
        document.querySelectorAll('.cart-btn').forEach(btn => {
          if (!btn.hasAttribute('data-disabled-stock')) {
            btn.disabled = false;
            btn.title = '';
          }
        });
        
        setTimeout(() => {
          statusMessageElement.textContent = '';
          this.textContent = 'Reset Count';
          this.disabled = false;
        }, 2000);
      } else {
        this.textContent = 'Reset Count';
        this.disabled = false;
      }
    });
  });
  
  // Update purchase limit
  purchaseLimitInput.addEventListener('change', function() {
    const limit = parseInt(this.value, 10);
    if (limit < 1) {
      this.value = 1;
      return;
    }
    
    if (limit > 10) {
      this.value = 10;
      return;
    }
    
    chrome.runtime.sendMessage({ 
      action: 'updatePurchaseLimit', 
      limit: limit 
    }, (response) => {
      if (response && response.success) {
        updatePurchaseCountDisplay();
      }
    });
  });
  
  // Listen for stock status updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'stockStatusUpdate') {
      stockStatus = message.stockStatus || {};
      if (stockStatus) {
        const products = Object.values(stockStatus)
          .filter(item => item && item.product)
          .map(item => item.product);
        updateProductList(products);
      }
    }
    return true;
  });
  
  // Toggle monitoring
  toggleButton.addEventListener('click', () => {
    isMonitoring = !isMonitoring;
    
    chrome.runtime.sendMessage({ 
      action: isMonitoring ? 'startMonitoring' : 'stopMonitoring' 
    }, (response) => {
      if (response && response.success) {
        updateMonitoringUI();
      }
    });
  });
  
  // Add product
  addProductButton.addEventListener('click', function() {
    // Add visual feedback that the button was clicked
    this.textContent = 'Adding...';
    this.disabled = true;
    
    const nameInput = document.getElementById('productName');
    const urlInput = document.getElementById('productUrl');
    const addToCartUrlInput = document.getElementById('addToCartUrl');
    const autoCheckoutInput = document.getElementById('autoCheckout');
    
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    const addToCartUrl = addToCartUrlInput.value.trim();
    const autoCheckout = autoCheckoutInput.checked;
    
    if (!name || !url) {
      alert('Please enter both a name and URL for the product.');
      this.textContent = 'Add Product';
      this.disabled = false;
      return;
    }
    
    if (!url.includes('bestbuy.com') && !url.includes('target.com')) {
      alert('Please enter a valid Best Buy or Target URL.');
      this.textContent = 'Add Product';
      this.disabled = false;
      return;
    }
    
    const button = this;
    
    // Attempt to add product
    chrome.runtime.sendMessage({
      action: 'addProduct',
      product: { name, url, addToCartUrl, autoCheckout }
    }, function(response) {
      if (response && response.success) {
        nameInput.value = '';
        urlInput.value = '';
        addToCartUrlInput.value = '';
        stockStatus = response.stockStatus || {};
        monitoredProducts = response.products || [];
        updateProductList(monitoredProducts);
        button.textContent = 'Product Added!';
        statusMessageElement.textContent = 'Product added successfully!';
        statusMessageElement.style.color = '#22c55e';
        
        setTimeout(function() {
          button.textContent = 'Add Product';
          button.disabled = false;
          statusMessageElement.textContent = '';
        }, 2000);
      } else {
        statusMessageElement.textContent = 'Failed to add product. Please try again.';
        statusMessageElement.style.color = '#ef4444';
        button.textContent = 'Add Product';
        button.disabled = false;
        
        setTimeout(function() {
          statusMessageElement.textContent = '';
        }, 3000);
      }
    });
  });
  
  // Check stock now button
  checkNowButton.addEventListener('click', () => {
    checkNowButton.textContent = 'Checking...';
    checkNowButton.disabled = true;
    
    chrome.runtime.sendMessage({
      action: 'forceCheck'
    }, (response) => {
      if (response && response.success) {
        stockStatus = response.stockStatus || {};
        const products = Object.values(stockStatus)
          .filter(item => item && item.product)
          .map(item => item.product);
        updateProductList(products);
      }
      
      checkNowButton.textContent = 'Check Stock Now';
      checkNowButton.disabled = false;
    });
  });
  
  // Update check interval
  checkIntervalInput.addEventListener('change', () => {
    const seconds = parseInt(checkIntervalInput.value, 10);
    if (seconds < 5) {
      checkIntervalInput.value = 5;
      alert('Interval cannot be less than 5 seconds to avoid overloading Best Buy servers.');
      return;
    }
    
    chrome.runtime.sendMessage({
      action: 'updateCheckInterval',
      seconds
    });
  });
  
  // Update the UI based on monitoring state
  function updateMonitoringUI() {
    if (isMonitoring) {
      statusElement.textContent = 'Active';
      statusElement.classList.add('active');
      toggleButton.textContent = 'Stop Monitoring';
      toggleButton.classList.add('active');
    } else {
      statusElement.textContent = 'Inactive';
      statusElement.classList.remove('active');
      toggleButton.textContent = 'Start Monitoring';
      toggleButton.classList.remove('active');
    }
  }
  
  // Add a button to open the dedicated monitor page
  const monitorPageBtn = document.createElement('button');
  monitorPageBtn.className = 'add-btn';
  monitorPageBtn.style.marginTop = '15px';
  monitorPageBtn.style.width = '100%';
  monitorPageBtn.textContent = 'Open Full-Page Monitor';
  monitorPageBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('monitor.html') });
  });
  
  // Add it to the bottom of popup
  document.body.appendChild(monitorPageBtn);
  
  // Update the product list UI
  function updateProductList(products) {
    productListElement.innerHTML = '';
    
    if (!products || products.length === 0) {
      productListElement.innerHTML = `
        <div class="product-item">
          <p>No products added yet. Add a Pokemon card URL below.</p>
        </div>
      `;
      return;
    }
    
    // First update purchase count to know if limit is reached
    chrome.runtime.sendMessage({ action: 'getPurchaseStats' }, (stats) => {
      const limitReached = stats && stats.count >= stats.limit;
      
      // Sort products: in-stock first, then by name
      const sortedProducts = [...products].sort((a, b) => {
        const statusA = stockStatus[a.url];
        const statusB = stockStatus[b.url];
        
        // If one is in stock and the other isn't, prioritize the in-stock one
        if (statusA?.inStock && !statusB?.inStock) return -1;
        if (!statusA?.inStock && statusB?.inStock) return 1;
        
        // If both in same stock state, sort by name alphabetically
        return a.name.localeCompare(b.name);
      });
      
      sortedProducts.forEach(product => {
        const productElement = document.createElement('div');
        productElement.className = 'product-item';
        
        // Get stock status info
        const status = stockStatus[product.url];
        
        let stockStatusHtml;
        if (status) {
          if (status.inStock) {
            stockStatusHtml = `
              <div class="product-status in-stock">
                ✅ IN STOCK!
              </div>
              <div class="last-checked">Last checked: ${status.lastChecked || 'Not checked yet'}</div>
            `;
          } else {
            stockStatusHtml = `
              <div class="product-status out-of-stock">
                ❌ Out of Stock
              </div>
              <div class="last-checked">Last checked: ${status.lastChecked || 'Not checked yet'}</div>
              ${status.lastInStock ? `<div class="last-in-stock">Last seen in stock: ${status.lastInStock}</div>` : ''}
            `;
          }
        } else {
          stockStatusHtml = `<div class="product-status">Status: Not checked yet</div>`;
        }
        
        // Determine if buttons should be disabled
        const disableButtons = limitReached || (!status || !status.inStock);
        const buttonTitle = limitReached ? 'Purchase limit reached' : 
                           (!status || !status.inStock ? 'Item is out of stock' : '');
        
        productElement.innerHTML = `
          <div class="product-details">
            <div class="product-name">${product.name}</div>
            <div class="product-url">${product.url}</div>
            <div class="product-option">${product.autoCheckout ? 'Auto-add to cart: Enabled' : 'Auto-add to cart: Disabled'}</div>
            ${product.addToCartUrl ? '<div class="product-option">Direct Add to Cart URL: ✓</div>' : ''}
            ${stockStatusHtml}
          </div>
          <div class="product-actions">
            <button class="cart-btn" 
                    data-url="${product.url}" 
                    data-cart-url="${product.addToCartUrl || ''}" 
                    ${disableButtons ? 'disabled' : ''}
                    title="${buttonTitle}"
                    ${!status || !status.inStock ? 'data-disabled-stock="true"' : ''}>
              Add to Cart
            </button>
            <button class="remove-btn" data-url="${product.url}">Remove</button>
          </div>
        `;
        
        productListElement.appendChild(productElement);
      });
      
      // Add event listeners to buttons
      addButtonEventListeners();
    });
  }
  
  // Add all button event listeners
  function addButtonEventListeners() {
    // Add event listeners to remove buttons
    document.querySelectorAll('.remove-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const url = e.target.getAttribute('data-url');
        
        chrome.runtime.sendMessage({
          action: 'removeProduct',
          url
        }, (response) => {
          if (response && response.success) {
            stockStatus = response.stockStatus || {};
            monitoredProducts = response.products || [];
            updateProductList(monitoredProducts);
            statusMessageElement.textContent = 'Product removed!';
            statusMessageElement.style.color = '#22c55e';
            setTimeout(() => {
              statusMessageElement.textContent = '';
            }, 2000);
          }
        });
      });
    });
    
    // Add event listeners to cart buttons
    document.querySelectorAll('.cart-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const url = e.target.getAttribute('data-url');
        const cartUrl = e.target.getAttribute('data-cart-url');
        const product = getProductByUrl(url);
        
        if (product) {
          button.textContent = 'Adding...';
          button.disabled = true;
          
          chrome.runtime.sendMessage({
            action: 'addToCart',
            product: product,
            cartUrl: cartUrl
          }, (response) => {
            if (response && response.success) {
              button.textContent = 'Added!';
              updatePurchaseCountDisplay(); // Update the count display
              
              setTimeout(() => {
                button.textContent = 'Add to Cart';
                // Check if we should keep the button disabled
                chrome.runtime.sendMessage({ action: 'getPurchaseStats' }, (stats) => {
                  const limitReached = stats && stats.count >= stats.limit;
                  button.disabled = limitReached;
                  button.title = limitReached ? 'Purchase limit reached' : '';
                });
              }, 3000);
            } else if (response && response.limitReached) {
              button.textContent = 'Limit Reached';
              statusMessageElement.textContent = 'Purchase limit reached. Reset count to buy more.';
              statusMessageElement.style.color = '#ef4444';
              
              setTimeout(() => {
                button.textContent = 'Add to Cart';
                button.disabled = true;
                button.title = 'Purchase limit reached';
                statusMessageElement.textContent = '';
              }, 3000);
            } else {
              button.textContent = 'Failed';
              
              setTimeout(() => {
                button.textContent = 'Add to Cart';
                button.disabled = false;
              }, 3000);
            }
          });
        }
      });
    });
  }
  
  // Helper function to get product by URL
  function getProductByUrl(url) {
    return monitoredProducts.find(p => p && p.url === url);
  }
});
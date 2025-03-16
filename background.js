// Global variables
let monitoredProducts = [];
let isMonitoring = false;
let checkoutInProgress = false;
let stockStatus = {}; // Track stock status for each product

// Initialize when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['monitoredProducts', 'checkInterval', 'purchaseLimit'], (result) => {
    monitoredProducts = result.monitoredProducts || [];
    const checkInterval = result.checkInterval || 30; // Default 30 seconds
    
    // Set default purchase limit if not set
    if (!result.purchaseLimit) {
      chrome.storage.sync.set({ purchaseLimit: 3 });
    }
    
    setupMonitoring(checkInterval);
  });
});

// Set up the monitoring alarm
function setupMonitoring(intervalSeconds) {
  // Clear any existing alarms
  chrome.alarms.clearAll();
  
  // Create a new alarm that will trigger the check
  chrome.alarms.create('checkStock', {
    periodInMinutes: intervalSeconds / 60
  });
  
  // Listen for the alarm
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkStock' && isMonitoring) {
      checkAllProductsStock();
    }
  });
}

// Check stock for all monitored products
async function checkAllProductsStock() {
  if (monitoredProducts.length === 0 || checkoutInProgress) return;
  
  for (const product of monitoredProducts) {
    const inStock = await checkProductStock(product);
    
    // Update stock status
    const previousStatus = stockStatus[product.url];
    stockStatus[product.url] = {
      inStock: inStock,
      lastChecked: new Date().toLocaleString(),
      product: product,
      // Track when it was last in stock
      lastInStock: inStock ? new Date().toLocaleString() : (previousStatus?.lastInStock || null)
    };
    
    // If status changed to in stock, notify
    if (inStock && (!previousStatus || !previousStatus.inStock)) {
      notifyStockAvailable(product);
      
      if (product.autoCheckout) {
        checkoutInProgress = true;
        await attemptCheckout(product);
        checkoutInProgress = false;
      }
    }
  }
  
  // Broadcast stock status update to popup if open
  chrome.runtime.sendMessage({
    action: 'stockStatusUpdate',
    stockStatus: stockStatus
  });
}

// Check if a product is in stock
async function checkProductStock(product) {
  try {
    // Determine which retailer we're checking
    const isTarget = product.url.includes('target.com');
    const isBestBuy = product.url.includes('bestbuy.com');
    
    // Target-specific stock checking
    if (isTarget) {
      return await checkTargetStock(product);
    }
    
    // Best Buy-specific stock checking
    else if (isBestBuy) {
      return await checkBestBuyStock(product);
    }
    
    // Generic fallback method for other retailers
    else {
      return await checkGenericStock(product);
    }
  } catch (error) {
    console.error(`Error checking stock for ${product.url}:`, error);
    return false;
  }
}

// Check Target product stock
async function checkTargetStock(product) {
  try {
    // Instead of using APIs, we'll use a front-end only approach
    
    // 1. Add randomized delay to simulate human browsing
    const randomDelay = Math.floor(Math.random() * 2000) + 1000; // 1-3 seconds
    await new Promise(resolve => setTimeout(resolve, randomDelay));
    
    // 2. Use a more browser-like request with proper headers
    const headers = {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Referer': 'https://www.google.com/'
    };
    
    // 3. Use the normal product page instead of APIs
    const response = await fetch(product.url, {
      headers: headers,
      // Important: don't send cookies with every request
      credentials: 'omit'
    });
    
    if (!response.ok) return false;
    
    const text = await response.text();
    
    // 4. Look for HTML patterns indicating in-stock status
    // These are more reliable than API responses and less likely to trigger bot detection
    const inStockIndicators = [
      'Add to cart</button>',
      'add to cart</button>',
      'Add to Cart</button>',
      'data-test="shippingButton"',
      'data-test="orderPickupButton"',
      'pick up ready within',
      'shipping to',
      'deliver it'
    ];
    
    const outOfStockIndicators = [
      'Sold out</button>',
      'sold out</button>',
      'Out of stock</button>',
      'out of stock</button>',
      'Out of stock at',
      'out of stock at',
      'Currently unavailable',
      'currently unavailable'
    ];
    
    // Check for in-stock indicators
    const isInStock = inStockIndicators.some(indicator => 
      text.toLowerCase().includes(indicator.toLowerCase()));
    
    // Check for out-of-stock indicators
    const isOutOfStock = outOfStockIndicators.some(indicator => 
      text.toLowerCase().includes(indicator.toLowerCase()));
    
    // If in-stock indicators are present and out-of-stock indicators are not, consider it in stock
    return isInStock && !isOutOfStock;
  } catch (error) {
    console.error(`Error checking Target stock for ${product.url}:`, error);
    return false;
  }
}

// Helper function to get random user agents
function getRandomUserAgent() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:98.0) Gecko/20100101 Firefox/98.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 12_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.3 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36 Edg/99.0.1150.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36'
  ];
  
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Modify the setupMonitoring function to add jitter to the timing
function setupMonitoring(intervalSeconds) {
  // Clear any existing alarms
  chrome.alarms.clearAll();
  
  // Add jitter to the interval to make it less predictable
  // This helps avoid detection patterns
  const jitter = Math.random() * 0.3; // Up to 30% jitter
  const adjustedInterval = intervalSeconds * (1 + jitter);
  
  // Create a new alarm that will trigger the check
  chrome.alarms.create('checkStock', {
    periodInMinutes: adjustedInterval / 60
  });
  
  console.log(`Monitoring set up with interval: ${adjustedInterval.toFixed(2)} seconds`);
  
  // Listen for the alarm
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkStock' && isMonitoring) {
      checkAllProductsStock();
    }
  });
}

// Modified checkAllProductsStock to distribute checks over time
async function checkAllProductsStock() {
  if (monitoredProducts.length === 0 || checkoutInProgress) return;
  
  // Instead of checking all products at once, stagger them
  for (const product of monitoredProducts) {
    // Add a random delay between product checks
    const staggerDelay = Math.floor(Math.random() * 5000) + 2000; // 2-7 seconds between products
    await new Promise(resolve => setTimeout(resolve, staggerDelay));
    
    // Skip some checks randomly (about 10% of the time)
    if (Math.random() < 0.1) {
      console.log(`Randomly skipping check for ${product.name} to appear more human-like`);
      continue;
    }
    
    const inStock = await checkProductStock(product);
    
    // Update stock status
    const previousStatus = stockStatus[product.url];
    stockStatus[product.url] = {
      inStock: inStock,
      lastChecked: new Date().toLocaleString(),
      product: product,
      lastInStock: inStock ? new Date().toLocaleString() : (previousStatus?.lastInStock || null)
    };
    
    // If status changed to in stock, notify
    if (inStock && (!previousStatus || !previousStatus.inStock)) {
      notifyStockAvailable(product);
      
      if (product.autoCheckout) {
        checkoutInProgress = true;
        await attemptCheckout(product);
        checkoutInProgress = false;
      }
    }
  }
  
  // Broadcast stock status update to popup if open
  chrome.runtime.sendMessage({
    action: 'stockStatusUpdate',
    stockStatus: stockStatus
  });
}

// Modify the UI to set reasonable minimum values for intervals
function updateMonitorSettings() {
  // Modify monitor.html and popup.html to set these minimums
  
  // In monitor.html, change the interval input:
  // <input type="number" id="checkInterval" min="30" value="60">
  // <small class="help-text">Minimum 30 seconds recommended to avoid detection</small>
  
  // In popup.html, change the interval input:
  // <input type="number" id="checkInterval" min="30" value="60">
  // <small class="help-text">Minimum 30 seconds recommended to avoid detection</small>
  
  // And update the JS to enforce these minimums:
  checkIntervalInput.addEventListener('change', () => {
    const seconds = parseInt(checkIntervalInput.value, 10);
    if (seconds < 30) {
      checkIntervalInput.value = 30;
      alert('Warning: Intervals below 30 seconds may trigger site bans. Using 30 seconds minimum.');
      return;
    }
    
    chrome.runtime.sendMessage({
      action: 'updateCheckInterval',
      seconds
    });
  });
}

// Add cookie management to rotate/clear cookies occasionally
async function manageCookies() {
  // Clear cookies for target.com every X checks to avoid building up a consistent profile
  // This should be called periodically, perhaps every 10-20 checks
  
  const targetDomains = ['target.com', 'www.target.com', '.target.com'];
  
  // Get all cookies for these domains
  for (const domain of targetDomains) {
    const cookies = await chrome.cookies.getAll({ domain });
    
    // Remove each cookie
    for (const cookie of cookies) {
      await chrome.cookies.remove({
        url: `https://${cookie.domain}${cookie.path}`,
        name: cookie.name
      });
    }
  }
  
  console.log('Cleared cookies for Target domains to maintain anonymity');
}

// New function: Randomize which products get checked each cycle
function getProductsToCheck() {
  if (monitoredProducts.length <= 3) {
    // If we have 3 or fewer products, check them all
    return monitoredProducts;
  }
  
  // Otherwise, randomly select about 70% of products each time
  const shuffled = [...monitoredProducts].sort(() => 0.5 - Math.random());
  const numToCheck = Math.ceil(monitoredProducts.length * 0.7);
  return shuffled.slice(0, numToCheck);
}
  
  // New function to perform a deeper verification check for Target products
  async function verifyTargetAvailability(product, tcin) {
    try {
      // If we don't have a TCIN, extract it
      if (!tcin && product.url.includes('/A-')) {
        const parts = product.url.split('/A-');
        if (parts.length > 1) {
          tcin = parts[1].split('?')[0].split('#')[0];
        }
      }
      
      if (!tcin) {
        console.log('Could not extract TCIN for secondary verification');
        return false;
      }
      
      // Use fulfillment API which indicates actual checkout ability
      const fulfillmentUrl = `https://www.target.com/v1/available_to_promise/fulfill?key=feee1e2d7f9aabd4e1b9604359f7c52e`;
      
      // Prepare the payload that simulates adding to cart
      const payload = {
        "items": [{
          "tcin": tcin,
          "quantity": 1
        }]
      };
      
      // Make the request to check fulfillment
      const response = await fetch(fulfillmentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        return false;
      }
      
      const data = await response.json();
      
      // Check if the product can be fulfilled (either via shipping or pickup)
      if (data && data.items && data.items.length > 0) {
        const item = data.items[0];
        
        // Check if item can be shipped
        if (item.fulfillment && item.fulfillment.shipping && item.fulfillment.shipping.available) {
          return true;
        }
        
        // Check if item is available for pickup
        if (item.fulfillment && item.fulfillment.pickup && 
            item.fulfillment.pickup.availability === "AVAILABLE") {
          return true;
        }
        
        // Check generic availability 
        if (item.available) {
          return true;
        }
      }
      
      // Additional verification: try the cart API directly
      try {
        const cartCheckUrl = `https://www.target.com/guest/checkout/v1/cart`;
        
        const cartPayload = {
          "cart": {
            "items": [{
              "item_id": tcin,
              "quantity": 1
            }],
            "item_type": "REGULAR",
            "channel_id": "10"
          }
        };
        
        const cartResponse = await fetch(cartCheckUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(cartPayload)
        });
        
        if (cartResponse.ok) {
          const cartData = await cartResponse.json();
          // If we can add to cart successfully, it's in stock
          if (cartData && !cartData.errors) {
            return true;
          }
          
          // Check for specific error types
          if (cartData.errors) {
            // Filter out errors not related to stock availability
            const stockErrors = cartData.errors.filter(error => 
              error.code === "OUT_OF_STOCK" || 
              error.message.toLowerCase().includes("out of stock") ||
              error.message.toLowerCase().includes("sold out")
            );
            
            // If there are no stock-related errors, the product might be available
            if (stockErrors.length === 0 && cartData.errors.length > 0) {
              // The error might be something else (like auth), not stock related
              return true;
            }
          }
        }
      } catch (cartError) {
        console.error("Cart verification failed:", cartError);
      }
      
      return false;
    } catch (error) {
      console.error("Target availability verification failed:", error);
      return false;
    }
  }

// Check Best Buy product stock
async function checkBestBuyStock(product) {
  try {
    // First approach: Use direct API if we can extract a SKU
    let sku = '';
    
    // Extract SKU from URL
    if (product.url.includes('/skuId=')) {
      sku = product.url.split('/skuId=')[1].split('&')[0].split('/')[0];
    } else if (product.url.includes('/p/')) {
      // Format: /p/[some-text]/[SKU]
      const parts = product.url.split('/p/');
      if (parts.length > 1) {
        const afterP = parts[1].split('/');
        if (afterP.length > 1) {
          sku = afterP[1].split('?')[0].split('#')[0];
        }
      }
    }
    
    // If we found a SKU, use the API directly (much faster)
    if (sku && /^\d+$/.test(sku)) {
      console.log(`Using direct API for SKU: ${sku}`);
      
      // Try multiple APIs to be thorough
      const apis = [
        `https://www.bestbuy.com/api/3.0/priceBlocks?skus=${sku}`,
        `https://www.bestbuy.com/api/tcfb/model.json?paths=%5B%5B%22shop%22%2C%22scds%22%2C%22v2%22%2C%22page%22%2C%22tenants%22%2C%22bbypres%22%2C%22pages%22%2C%22globalnavigationv5sv%22%2C%22header%22%5D%2C%5B%22shop%22%2C%22buttonstate%22%2C%22v5%22%2C%22item%22%2C%22skus%22%2C${sku}%2C%22conditions%22%2C%22NONE%22%2C%22destinationZipCode%22%2C%22%2520%22%2C%22storeId%22%2C%22%2520%22%2C%22context%22%2C%22cyp%22%2C%22addAll%22%2C%22false%22%5D%5D&method=get`,
        `https://www.bestbuy.com/site/canary/component/fulfillment/v1/item/fulfillment?skuId=${sku}`
      ];
      
      // Try each API endpoint
      for (let i = 0; i < apis.length; i++) {
        try {
          const response = await fetch(apis[i], { 
            credentials: 'include',
            headers: { 'Cache-Control': 'no-cache' }
          });
          
          if (response.ok) {
            const data = await response.json();
            
            // Different response formats for different APIs
            if (data.availabilities && data.availabilities.length > 0) {
              // First API format
              if (data.availabilities.some(a => a.shipping?.status === 'Available')) {
                return true;
              }
            } else if (data.jsonGraph?.shop?.buttonstate?.v5?.item?.skus) {
              // Second API format
              const buttonState = data.jsonGraph.shop.buttonstate.v5.item.skus[sku]?.conditions?.NONE?.addToCartState?.value;
              if (buttonState === 'AVAILABLE_TO_CART') {
                return true;
              }
            } else if (data.priceBlocks && data.priceBlocks.length > 0) {
              // Third API format
              if (data.priceBlocks.some(block => block.sku.buttonState.purchasable)) {
                return true;
              }
            }
          }
        } catch (apiError) {
          console.log(`API check ${i} failed:`, apiError);
        }
      }
    }
    
    // Second approach: Direct page fetch (fallback)
    const response = await fetch(product.url, { 
      credentials: 'include',
      headers: { 'Cache-Control': 'no-cache' }
    });
    
    if (!response.ok) return false;
    
    const text = await response.text();
    
    // Check for common "in stock" indicators
    const inStockIndicators = [
      '"availability":"Available"',
      'Add to Cart</button>',
      '"purchasable":true',
      'data-button-state="ADD_TO_CART"',
      '"inventoryStatus":"Available"'
    ];
    
    const outOfStockIndicators = [
      'Sold Out</button>',
      'Out of Stock</button>',
      '"availability":"SoldOut"',
      'data-button-state="SOLD_OUT"'
    ];
    
    // Check if any in-stock indicators are present
    const isInStock = inStockIndicators.some(indicator => text.includes(indicator));
    
    // Check if any out-of-stock indicators are present
    const isOutOfStock = outOfStockIndicators.some(indicator => text.includes(indicator));
    
    // If in-stock indicators are present and out-of-stock indicators are not, consider it in stock
    return isInStock && !isOutOfStock;
  } catch (error) {
    console.error(`Error checking Best Buy stock for ${product.url}:`, error);
    return false;
  }
}

// Generic stock check for other retailers
async function checkGenericStock(product) {
  try {
    // Generic method that will work for most websites
    const response = await fetch(product.url, { 
      headers: { 'Cache-Control': 'no-cache' }
    });
    
    if (!response.ok) return false;
    
    const text = await response.text();
    
    // Common in-stock indicators across most e-commerce sites
    const inStockIndicators = [
      'in stock',
      'add to cart',
      'add to bag',
      'available',
      'buy now',
      'in-stock',
      'instock',
      'purchasable',
      'availability":"in',
      '"availability":true'
    ];
    
    const outOfStockIndicators = [
      'out of stock',
      'sold out',
      'unavailable',
      'out-of-stock',
      'outofstock',
      'availability":"out',
      '"availability":false',
      'notify me when available'
    ];
    
    // Check for in-stock indicators (case insensitive)
    const isInStock = inStockIndicators.some(indicator => 
      text.toLowerCase().includes(indicator.toLowerCase()));
    
    // Check for out-of-stock indicators (case insensitive)
    const isOutOfStock = outOfStockIndicators.some(indicator => 
      text.toLowerCase().includes(indicator.toLowerCase()));
    
    // If in-stock indicators are present and out-of-stock indicators are not, consider it in stock
    return isInStock && !isOutOfStock;
  } catch (error) {
    console.error(`Error checking generic stock for ${product.url}:`, error);
    return false;
  }
}

// Send notification when stock is available
function notifyStockAvailable(product) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'images/icon128.png',
    title: 'Pokemon Cards In Stock!',
    message: `${product.name} is now available! ${product.autoCheckout ? 'Attempting checkout...' : ''}`,
    priority: 2
  });
}

// Attempt checkout for a product
async function attemptCheckout(product) {
  try {
    // Determine which retailer
    const isTarget = product.url.includes('target.com');
    const isBestBuy = product.url.includes('bestbuy.com');
    
    // Check purchase limit
    const result = await chrome.storage.sync.get(['purchaseCount', 'purchaseLimit']);
    const purchaseCount = result.purchaseCount || 0;
    const purchaseLimit = result.purchaseLimit || 3;
    
    if (purchaseCount >= purchaseLimit) {
      console.log(`Purchase limit reached (${purchaseLimit}). Cannot checkout.`);
      return false;
    }
    
    // Use the appropriate add to cart function
    if (isTarget) {
      return await addToCartTarget(product, product.addToCartUrl, purchaseCount);
    } else if (isBestBuy) {
      return await addToCartBestBuy(product, product.addToCartUrl, purchaseCount);
    } else {
      return await addToCartGeneric(product, product.addToCartUrl, purchaseCount);
    }
  } catch (error) {
    console.error('Checkout process failed:', error);
    return false;
  }
}

// Attempt to add Target product to cart
async function addToCartTarget(product, directCartUrl, purchaseCount) {
  try {
    // Try to extract the TCIN (Target's product ID)
    let tcin = '';
    
    // First check if we have a direct cart URL
    if (directCartUrl && directCartUrl.length > 0) {
      try {
        // Try to extract TCIN from direct URL
        if (directCartUrl.includes('tcin=')) {
          tcin = directCartUrl.split('tcin=')[1].split('&')[0];
        }
        
        // Create a new tab with the direct add to cart URL
        const tab = await chrome.tabs.create({ url: directCartUrl, active: true });
        
        // Watch for navigation to cart page
        chrome.tabs.onUpdated.addListener(function cartListener(tabId, changeInfo, tab) {
          if (tabId === tab.id && changeInfo.url && changeInfo.url.includes('target.com/cart')) {
            chrome.storage.sync.set({ purchaseCount: purchaseCount + 1 });
            chrome.tabs.onUpdated.removeListener(cartListener);
          }
        });
        
        return { success: true, method: 'directUrl' };
      } catch (error) {
        console.error('Direct URL failed for Target:', error);
      }
    }
    
    // If no direct URL or it failed, try to extract TCIN from product URL
    if (!tcin && product.url.includes('/A-')) {
      const parts = product.url.split('/A-');
      if (parts.length > 1) {
        tcin = parts[1].split('?')[0].split('#')[0];
      }
    }
    
    // Fallback to browser automation
    const tab = await chrome.tabs.create({ url: product.url, active: false });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Execute the add to cart script specific to Target
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: performTargetAddToCart,
      args: [tcin]
    });
    
    // If successful, increment purchase count
    if (results[0]?.result?.success) {
      await chrome.storage.sync.set({ purchaseCount: purchaseCount + 1 });
    }
    
    // Make the tab active so the user can complete the purchase
    chrome.tabs.update(tab.id, { active: true });
    
    return results[0]?.result || { success: false };
  } catch (error) {
    console.error('Target add to cart failed:', error);
    return { success: false, error: error.message };
  }
}

// Attempt to add Best Buy product to cart
async function addToCartBestBuy(product, directCartUrl, purchaseCount) {
  try {
    // Try to extract SKU from URL or product page
    let sku = '';
    
    // Extract from direct cart URL if available
    if (directCartUrl && directCartUrl.length > 0) {
      try {
        const url = new URL(directCartUrl);
        sku = url.searchParams.get('skuId') || '';
      } catch (e) {
        console.log('Could not extract SKU from URL');
      }
    }
    
    // If not found, try from product URL
    if (!sku) {
      if (product.url.includes('/skuId=')) {
        sku = product.url.split('/skuId=')[1].split('&')[0].split('/')[0];
      } else if (product.url.includes('/p/')) {
        const parts = product.url.split('/p/');
        if (parts.length > 1) {
          const afterP = parts[1].split('/');
          if (afterP.length > 1) {
            sku = afterP[1].split('?')[0].split('#')[0];
          }
        }
      }
    }
    
    // If we have a SKU, try the direct API method (fastest)
    if (sku && /^\d+$/.test(sku)) {
      try {
        console.log(`Attempting direct API add to cart for SKU: ${sku}`);
        
        // First method: API endpoint
        const cartResponse = await fetch(`https://www.bestbuy.com/cart/api/v1/addToCart`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            items: [{
              skuId: sku,
              quantity: 1
            }]
          })
        });
        
        if (cartResponse.ok) {
          // Success! Increment purchase count and open cart
          await chrome.storage.sync.set({ purchaseCount: purchaseCount + 1 });
          await chrome.tabs.create({ url: 'https://www.bestbuy.com/cart', active: true });
          return { success: true, method: 'api' };
        }
      } catch (apiError) {
        console.error('API add to cart failed, trying alternatives:', apiError);
      }
    }
    
    // If direct API failed or wasn't possible, try other methods
    
    // If we have a direct add to cart URL, use it
    if (directCartUrl && directCartUrl.length > 0) {
      // Create a new tab with the direct add to cart URL
      const tab = await chrome.tabs.create({ url: directCartUrl, active: true });
      
      // Watch for navigation to cart page, then consider it a success
      chrome.tabs.onUpdated.addListener(function cartListener(tabId, changeInfo, tab) {
        if (tabId === tab.id && changeInfo.url && changeInfo.url.includes('bestbuy.com/cart')) {
          chrome.storage.sync.set({ purchaseCount: purchaseCount + 1 });
          chrome.tabs.onUpdated.removeListener(cartListener);
        }
      });
      
      return { success: true, method: 'directUrl' };
    }
    
    // Otherwise use the regular product page
    // Create a new tab to perform the add to cart action
    const tab = await chrome.tabs.create({ url: product.url, active: false });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Execute the add to cart script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: performBestBuyAddToCart,
      args: [sku]
    });
    
    // If successful, increment purchase count
    if (results[0]?.result?.success) {
      await chrome.storage.sync.set({ purchaseCount: purchaseCount + 1 });
    }
    
    // Make the tab active so the user can complete the purchase
    chrome.tabs.update(tab.id, { active: true });
    
    return results[0]?.result || { success: false };
  } catch (error) {
    console.error('Best Buy add to cart failed:', error);
    return { success: false, error: error.message };
  }
}

// Generic add to cart for other retailers
async function addToCartGeneric(product, directCartUrl, purchaseCount) {
  try {
    // If we have a direct URL, use it
    if (directCartUrl && directCartUrl.length > 0) {
      const tab = await chrome.tabs.create({ url: directCartUrl, active: true });
      
      // Watch for navigation to cart page
      chrome.tabs.onUpdated.addListener(function cartListener(tabId, changeInfo, tab) {
        if (tabId === tab.id && changeInfo.url && changeInfo.url.includes('cart')) {
          chrome.storage.sync.set({ purchaseCount: purchaseCount + 1 });
          chrome.tabs.onUpdated.removeListener(cartListener);
        }
      });
      
      return { success: true, method: 'directUrl' };
    }
    
    // Otherwise try generic add to cart
    const tab = await chrome.tabs.create({ url: product.url, active: false });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    // Execute the add to cart script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: performGenericAddToCart
    });
    
    // If successful, increment purchase count
    if (results[0]?.result?.success) {
      await chrome.storage.sync.set({ purchaseCount: purchaseCount + 1 });
    }
    
    // Make the tab active so the user can complete the purchase
    chrome.tabs.update(tab.id, { active: true });
    
    return results[0]?.result || { success: false };
  } catch (error) {
    console.error('Generic add to cart failed:', error);
    return { success: false, error: error.message };
  }
}

// This function runs in the context of the Target page
function performTargetAddToCart(tcin) {
  return new Promise(async (resolve) => {
    try {
      // First try to find and click add to cart buttons
      const addToCartSelectors = [
        'button[data-test="addToCartButton"]',
        'button[data-test="shippingButton"]',
        'button[data-test="orderPickupButton"]',
        'button[class*="AddToCart"]'
      ];
      
      let buttonClicked = false;
      
      // First try direct button selectors
      for (const selector of addToCartSelectors) {
        try {
          const buttons = document.querySelectorAll(selector);
          for (const button of buttons) {
            if (button && !button.disabled && button.offsetParent !== null) {
              button.click();
              buttonClicked = true;
              break;
            }
          }
          if (buttonClicked) break;
        } catch (e) {
          console.error(`Error with selector ${selector}:`, e);
        }
      }
      
      // Then try text-based button finding
      if (!buttonClicked) {
        try {
          const allButtons = document.querySelectorAll('button');
          for (const button of allButtons) {
            const buttonText = button.textContent.toLowerCase();
            if ((buttonText.includes('add to cart') || 
                buttonText.includes('add for shipping') || 
                buttonText.includes('add for pickup')) && 
                !button.disabled && 
                button.offsetParent !== null) {
              button.click();
              buttonClicked = true;
              break;
            }
          }
        } catch (e) {
          console.error('Error with text-based button finding:', e);
        }
      }
      
      if (!buttonClicked) {
        resolve({ success: false, error: 'Could not find Add to Cart button on Target page' });
        return;
      }
      
      // Wait for the cart update
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Look for view cart or checkout buttons
      const cartButtons = document.querySelectorAll('a[href="/cart"], button[data-test="goToCartButton"]');
      if (cartButtons.length > 0) {
        cartButtons[0].click();
      } else {
        // Navigate to cart directly
        window.location.href = 'https://www.target.com/cart';
      }
      
      resolve({ success: true, method: 'button' });
    } catch (error) {
      console.error('Target add to cart process failed:', error);
      resolve({ success: false, error: error.message });
    }
  });
}

// This function runs in the context of the Best Buy page
function performBestBuyAddToCart(sku) {
  return new Promise(async (resolve) => {
    try {
      // Fallback: Try to click "Add to Cart" button
      const addToCartSelectors = [
        'button.add-to-cart-button',
        'button[data-button-state="ADD_TO_CART"]',
        'button.c-button-primary:not([disabled])',
        'button[data-sku-id]:not([disabled])'
      ];
      
      let buttonClicked = false;
      
      // First pass: Look for obvious add to cart buttons
      for (const selector of addToCartSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button && !button.disabled && button.offsetParent !== null) {
            button.click();
            buttonClicked = true;
            break;
          }
        }
        if (buttonClicked) break;
      }
      
      // Second pass: Look for buttons containing "Add to Cart" text
      if (!buttonClicked) {
        const allButtons = document.querySelectorAll('button');
        for (const button of allButtons) {
          if (button.textContent.includes('Add to Cart') && !button.disabled && button.offsetParent !== null) {
            button.click();
            buttonClicked = true;
            break;
          }
        }
      }
      
      // Third pass: Look for add to cart links
      if (!buttonClicked) {
        const addToCartLinks = document.querySelectorAll('a[href*="add-to-cart"]');
        if (addToCartLinks.length > 0) {
          addToCartLinks[0].click();
          buttonClicked = true;
        }
      }
      
      if (!buttonClicked) {
        resolve({ success: false, error: 'Could not find Add to Cart button' });
        return;
      }
      
      // Wait for the cart to update
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Look for "go to cart" button that often appears after adding to cart
      const goToCartButtons = document.querySelectorAll('a[href="/cart"], button.go-to-cart-button');
      if (goToCartButtons.length > 0) {
        goToCartButtons[0].click();
      } else {
        // Otherwise navigate to cart
        window.location.href = 'https://www.bestbuy.com/cart';
      }
      
      resolve({ success: true, method: 'button' });
    } catch (error) {
      console.error('Add to cart process failed:', error);
      resolve({ success: false, error: error.message });
    }
  });
}
// Generic add to cart function that works for most retailers
function performGenericAddToCart() {
    return new Promise(async (resolve) => {
      try {
        // Common selectors for add to cart buttons across many websites
        const addToCartSelectors = [
          'button[id*="add-to-cart"]',
          'button[name*="add-to-cart"]',
          'button[class*="add-to-cart"]',
          'button.add_to_cart_button',
          'button.addToCart',
          'button.add_to_cart',
          'input[name*="add-to-cart"]',
          'a[href*="add-to-cart"]',
          'a.add_to_cart_button',
          'button'
        ];
        
        let buttonClicked = false;
        
        // First try specific selectors
        for (const selector of addToCartSelectors.slice(0, -1)) {
          const buttons = document.querySelectorAll(selector);
          for (const button of buttons) {
            if (button && !button.disabled && button.offsetParent !== null) {
              button.click();
              buttonClicked = true;
              break;
            }
          }
          if (buttonClicked) break;
        }
        
        // Then try text-based approach with all buttons
        if (!buttonClicked) {
          const allButtons = document.querySelectorAll(addToCartSelectors[addToCartSelectors.length - 1]);
          const addToCartTexts = ['add to cart', 'add to bag', 'add to basket', 'purchase', 'buy now'];
          
          for (const button of allButtons) {
            const buttonText = button.textContent.toLowerCase();
            if (addToCartTexts.some(text => buttonText.includes(text)) && 
                !button.disabled && 
                button.offsetParent !== null) {
              button.click();
              buttonClicked = true;
              break;
            }
          }
        }
        
        if (!buttonClicked) {
          resolve({ success: false, error: 'Could not find Add to Cart button' });
          return;
        }
        
        // Wait for the cart to update
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Try to find checkout/cart button
        const cartLinkSelectors = [
          'a[href*="cart"]',
          'a[href*="checkout"]',
          'button[class*="checkout"]',
          'button[class*="cart"]'
        ];
        
        for (const selector of cartLinkSelectors) {
          const links = document.querySelectorAll(selector);
          for (const link of links) {
            if (link && link.offsetParent !== null) {
              link.click();
              resolve({ success: true, method: 'button' });
              return;
            }
          }
        }
        
        resolve({ success: true, method: 'button', note: 'Added to cart but could not navigate to cart page' });
      } catch (error) {
        console.error('Generic add to cart process failed:', error);
        resolve({ success: false, error: error.message });
      }
    });
  }
  
  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startMonitoring') {
      isMonitoring = true;
      // Immediately check stock when monitoring starts
      checkAllProductsStock();
      sendResponse({ success: true });
    } else if (message.action === 'stopMonitoring') {
      isMonitoring = false;
      sendResponse({ success: true });
    } else if (message.action === 'addProduct') {
      try {
        // Make a copy of the product to ensure it's properly structured
        const newProduct = {
          name: message.product.name || '',
          url: message.product.url || '',
          addToCartUrl: message.product.addToCartUrl || '',
          autoCheckout: !!message.product.autoCheckout
        };
        
        // Add to monitored products array
        monitoredProducts.push(newProduct);
        
        // Save to storage
        chrome.storage.sync.set({ monitoredProducts }, function() {
          console.log('Product saved successfully');
        });
        
        // Check stock for the new product immediately
        checkProductStock(newProduct).then(inStock => {
          stockStatus[newProduct.url] = {
            inStock: inStock,
            lastChecked: new Date().toLocaleString(),
            product: newProduct,
            lastInStock: inStock ? new Date().toLocaleString() : null
          };
          sendResponse({ 
            success: true, 
            products: monitoredProducts, 
            stockStatus: stockStatus 
          });
        }).catch(error => {
          console.error('Error checking stock:', error);
          sendResponse({ 
            success: true, 
            products: monitoredProducts,
            stockStatus: stockStatus
          });
        });
      } catch (error) {
        console.error('Error adding product:', error);
        sendResponse({ success: false, error: error.message });
      }
      return true; // Required for async response
    } else if (message.action === 'removeProduct') {
      monitoredProducts = monitoredProducts.filter(p => p.url !== message.url);
      chrome.storage.sync.set({ monitoredProducts });
      // Remove from stock status
      delete stockStatus[message.url];
      sendResponse({ success: true, products: monitoredProducts, stockStatus: stockStatus });
    } else if (message.action === 'getProducts') {
      sendResponse({ products: monitoredProducts, stockStatus: stockStatus });
    } else if (message.action === 'updateCheckInterval') {
      setupMonitoring(message.seconds);
      chrome.storage.sync.set({ checkInterval: message.seconds });
      sendResponse({ success: true });
    } else if (message.action === 'forceCheck') {
      checkAllProductsStock().then(() => {
        sendResponse({ success: true, stockStatus: stockStatus });
      });
      return true; // Required for async response
    } else if (message.action === 'getMonitoringStatus') {
      sendResponse({ isMonitoring: isMonitoring });
    } else if (message.action === 'addToCart') {
      // Determine which retailer and use appropriate function
      const isTarget = message.product.url.includes('target.com');
      const isBestBuy = message.product.url.includes('bestbuy.com');
      
      // Get purchase count
      chrome.storage.sync.get(['purchaseCount', 'purchaseLimit'], async (result) => {
        const purchaseCount = result.purchaseCount || 0;
        const purchaseLimit = result.purchaseLimit || 3;
        
        if (purchaseCount >= purchaseLimit) {
          sendResponse({ success: false, limitReached: true });
          return;
        }
        
        let cartResult;
        if (isTarget) {
          cartResult = await addToCartTarget(message.product, message.cartUrl, purchaseCount);
        } else if (isBestBuy) {
          cartResult = await addToCartBestBuy(message.product, message.cartUrl, purchaseCount);
        } else {
          cartResult = await addToCartGeneric(message.product, message.cartUrl, purchaseCount);
        }
        
        sendResponse(cartResult);
      });
      
      return true; // Required for async response
    } else if (message.action === 'updatePurchaseLimit') {
      chrome.storage.sync.set({ purchaseLimit: message.limit });
      sendResponse({ success: true });
    } else if (message.action === 'resetPurchaseCount') {
      chrome.storage.sync.set({ purchaseCount: 0 });
      sendResponse({ success: true });
    } else if (message.action === 'getPurchaseStats') {
      chrome.storage.sync.get(['purchaseCount', 'purchaseLimit'], (result) => {
        sendResponse({
          count: result.purchaseCount || 0,
          limit: result.purchaseLimit || 3
        });
      });
      return true; // Required for async response
    }
    
    return true; // Required for async response
  });

  // Request queue to manage and throttle API calls
class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36'
    ];
  }

  // Add a request to the queue
  enqueue(url, options = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        url,
        options,
        resolve,
        reject
      });
      
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  // Process the queue with delays between requests
  async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    
    this.processing = true;
    
    // Calculate delay - random between 3-8 seconds to appear more human-like
    // For Target, which has stricter anti-bot measures, we need more delay
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    // Base delay between 3-8 seconds
    let delay = Math.floor(Math.random() * 5000) + 3000;
    
    // If last request was very recent, add more delay
    if (timeSinceLastRequest < 10000) {
      delay += Math.floor(Math.random() * 5000) + 5000;
    }
    
    // If too many requests lately, add even more delay
    if (this.queue.length > 5) {
      delay += Math.floor(Math.random() * 10000) + 10000;
      console.log(`High queue depth (${this.queue.length}), increasing delay to ${delay}ms`);
    }
    
    // Wait for the delay
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Get the next request
    const request = this.queue.shift();
    
    try {
      // Add random user agent and other headers to make request look more human
      const headers = {
        'User-Agent': this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Sec-GPC': '1',
        ...request.options.headers
      };
      
      // Add a random query parameter to bypass caching
      const url = new URL(request.url);
      url.searchParams.set('_t', Date.now());
      
      const response = await fetch(url.toString(), {
        ...request.options,
        headers
      });
      
      this.lastRequestTime = Date.now();
      request.resolve(response);
    } catch (error) {
      request.reject(error);
    }
    
    // Process the next request
    this.processQueue();
  }
}

// Initialize the request queue
const targetRequestQueue = new RequestQueue();

// Modify the checkTargetStock function to use the queue
async function checkTargetStock(product) {
  try {
    // Try to extract the TCIN (Target's product ID)
    let tcin = '';
    
    // Extract TCIN from URL
    if (product.url.includes('/A-')) {
      const parts = product.url.split('/A-');
      if (parts.length > 1) {
        tcin = parts[1].split('?')[0].split('#')[0];
      }
    }
    
    // First, try with a direct page load which is less likely to be blocked
    // This simulates a normal user visiting the page
    try {
      const response = await targetRequestQueue.enqueue(product.url);
      
      if (response.ok) {
        const text = await response.text();
        
        // Check for Target's in-stock indicators
        const inStockIndicators = [
          '"availability_status":"IN_STOCK"',
          '"available_to_promise":true',
          'data-test="shippingButton"',
          'data-test="orderPickupButton"',
          'Add to cart</button>',
          'available online',
          'pick up today'
        ];
        
        const outOfStockIndicators = [
          '"availability_status":"OUT_OF_STOCK"',
          'Sold out</button>',
          'Out of stock at',
          'Out of stock online',
          'data-test="oosDeliveryOption"',
          'This item is not available'
        ];
        
        // Check if any in-stock indicators are present
        const isInStock = inStockIndicators.some(indicator => 
          text.toLowerCase().includes(indicator.toLowerCase()));
        
        // Check if any out-of-stock indicators are present
        const isOutOfStock = outOfStockIndicators.some(indicator => 
          text.toLowerCase().includes(indicator.toLowerCase()));
        
        // If in-stock indicators are present and out-of-stock indicators are not, consider it in stock
        if (isInStock && !isOutOfStock) {
          // Perform additional verification to confirm it's truly in stock
          return await verifyTargetAvailability(product, tcin);
        } else if (isOutOfStock) {
          return false;
        }
      }
    } catch (pageError) {
      console.error(`Error checking Target product page: ${pageError}`);
    }
    
    // Only use the API as a fallback and with much less frequency
    if (tcin && /^\d+$/.test(tcin) && Math.random() > 0.7) { // Only try API 30% of the time
      console.log(`Using Target API for TCIN: ${tcin}`);
      
      // Get store ID if we have it stored (for pickup availability)
      const storeInfo = await chrome.storage.sync.get(['targetStoreId']);
      const storeId = storeInfo.targetStoreId || '';
      
      // Only try one API endpoint to reduce request count
      const apiUrl = `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=feee1e2d7f9aabd4e1b9604359f7c52e&tcin=${tcin}&pricing_store_id=${storeId}`;
      
      try {
        const response = await targetRequestQueue.enqueue(apiUrl, {
          headers: { 'Accept': 'application/json' }
        });
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.data && data.data.product) {
            const product = data.data.product;
            
            // Check button state
            if (product.button_state && product.button_state !== "OUT_OF_STOCK" && 
                product.button_state !== "SOLD_OUT") {
              // Perform additional verification to confirm it's truly in stock
              return await verifyTargetAvailability(product, tcin);
            }
          }
        }
      } catch (apiError) {
        console.error(`Target API error:`, apiError);
      }
    }
    
    return false;
  } catch (error) {
    console.error(`Error checking Target stock for ${product.url}:`, error);
    return false;
  }
}

// Modify the verifyTargetAvailability function to use the queue as well
async function verifyTargetAvailability(product, tcin) {
  try {
    // If we don't have a TCIN, extract it
    if (!tcin && product.url.includes('/A-')) {
      const parts = product.url.split('/A-');
      if (parts.length > 1) {
        tcin = parts[1].split('?')[0].split('#')[0];
      }
    }
    
    if (!tcin) {
      console.log('Could not extract TCIN for secondary verification');
      return false;
    }
    
    // The most reliable way is to see if the "Add to Cart" button is present and enabled
    // Let's create a temporary tab to check this
    // This is much less likely to be blocked because it's browser automation rather than API calls
    
    // We'll use this approach sparingly (only when a product seems to be in stock)
    try {
      // Create a tab but don't make it active to avoid disrupting the user
      const tab = await chrome.tabs.create({ 
        url: product.url, 
        active: false 
      });
      
      // Wait for the page to load
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Run a script in the context of the page to check if Add to Cart button exists and is enabled
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: checkAddToCartButton
      });
      
      // Close the tab
      chrome.tabs.remove(tab.id);
      
      // If the button was found and enabled, the product is in stock
      if (results && results[0] && results[0].result && results[0].result.buttonFound) {
        return !results[0].result.buttonDisabled;
      }
    } catch (tabError) {
      console.error("Tab verification failed:", tabError);
    }
    
    // As an absolute last resort, try the fulfillment API (but very infrequently)
    if (Math.random() > 0.9) { // Only 10% of the time
      try {
        const fulfillmentUrl = `https://www.target.com/v1/available_to_promise/fulfill?key=feee1e2d7f9aabd4e1b9604359f7c52e`;
        
        const payload = {
          "items": [{
            "tcin": tcin,
            "quantity": 1
          }]
        };
        
        const response = await targetRequestQueue.enqueue(fulfillmentUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        
        if (response.ok) {
          const data = await response.json();
          
          if (data && data.items && data.items.length > 0) {
            const item = data.items[0];
            
            // Check if item can be fulfilled
            if (item.fulfillment && 
                ((item.fulfillment.shipping && item.fulfillment.shipping.available) ||
                 (item.fulfillment.pickup && item.fulfillment.pickup.availability === "AVAILABLE"))) {
              return true;
            }
            
            if (item.available) {
              return true;
            }
          }
        }
      } catch (fulfillError) {
        console.error("Fulfillment check failed:", fulfillError);
      }
    }
    
    return false;
  } catch (error) {
    console.error("Target availability verification failed:", error);
    return false;
  }
}

// This function runs in the context of the product page
function checkAddToCartButton() {
  try {
    // Look for Add to Cart buttons
    const addToCartSelectors = [
      'button[data-test="addToCartButton"]',
      'button[data-test="shippingButton"]',
      'button[data-test="orderPickupButton"]',
      'button[class*="AddToCart"]',
      'button:contains("Add to cart")'
    ];
    
    let buttonFound = false;
    let buttonDisabled = true;
    
    // Check each selector
    for (const selector of addToCartSelectors) {
      let buttons;
      
      // Handle jQuery-style :contains selector
      if (selector.includes(":contains")) {
        const text = selector.match(/:contains\("(.+)"\)/)[1];
        buttons = Array.from(document.querySelectorAll('button')).filter(
          btn => btn.textContent.includes(text)
        );
      } else {
        buttons = document.querySelectorAll(selector);
      }
      
      for (const button of buttons) {
        if (button && button.offsetParent !== null) { // Button is visible
          buttonFound = true;
          buttonDisabled = button.disabled || 
                          button.classList.contains('disabled') ||
                          button.getAttribute('aria-disabled') === 'true';
          
          // If we found an enabled button, we can stop searching
          if (!buttonDisabled) {
            break;
          }
        }
      }
      
      if (buttonFound && !buttonDisabled) {
        break;
      }
    }
    
    // Also check if "This item is not available" or "Sold out" text is present
    const outOfStockText = document.body.innerText.includes("This item is not available") ||
                           document.body.innerText.includes("Sold out") ||
                           document.body.innerText.includes("Out of stock");
    
    return { 
      buttonFound, 
      buttonDisabled: buttonDisabled || outOfStockText,
      outOfStockText
    };
  } catch (error) {
    console.error("Error checking Add to Cart button:", error);
    return { buttonFound: false, buttonDisabled: true, error: error.toString() };
  }
}
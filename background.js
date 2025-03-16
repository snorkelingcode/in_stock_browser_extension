// Global variables with better state management
let monitoredProducts = [];
let isMonitoring = false;
let checkoutInProgress = false;
let stockStatus = {}; // Track stock status for each product
let consecutiveFailures = 0;
let lastCheckTime = 0;
let activeTabs = []; // Track tabs we've opened

// Constants for circuit breakers and rate limiting
const MAX_FAILURES = 3;
const MIN_CHECK_INTERVAL_MS = 30000; // 30 seconds minimum between checks
const FAILURE_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_TABS_PER_SESSION = 10; // Safety limit
let tabsCreatedThisSession = 0;

// Initialize when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed or updated");
  
  // Clean up any existing state
  chrome.alarms.clearAll();
  closeAllMonitoringTabs();
  
  // Load saved state
  chrome.storage.sync.get(['monitoredProducts', 'checkInterval', 'purchaseLimit'], (result) => {
    monitoredProducts = result.monitoredProducts || [];
    const checkInterval = result.checkInterval || 60; // Default 60 seconds, safer
    
    // Set default purchase limit if not set
    if (!result.purchaseLimit) {
      chrome.storage.sync.set({ purchaseLimit: 3 });
    }
    
    // Don't auto-start monitoring on install/update
    isMonitoring = false;
    
    setupMonitoring(checkInterval);
    console.log(`Extension initialized with ${monitoredProducts.length} products`);
  });
});

// Make sure we clean up when the extension is suspended or disabled
chrome.runtime.onSuspend.addListener(() => {
  console.log("Extension being suspended, cleaning up...");
  chrome.alarms.clearAll();
  isMonitoring = false;
  closeAllMonitoringTabs();
});

// Close any tabs we've opened for monitoring
function closeAllMonitoringTabs() {
  // Close any tabs we're tracking
  if (activeTabs.length > 0) {
    console.log(`Closing ${activeTabs.length} active monitoring tabs`);
    activeTabs.forEach(tabId => {
      chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
          console.log(`Tab ${tabId} already closed`);
        }
      });
    });
    activeTabs = [];
  }
  
  // Also do a search for any Target tabs that might have been missed
  chrome.tabs.query({url: "*://www.target.com/*"}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.remove(tab.id, () => {
        if (chrome.runtime.lastError) {
          console.log(`Tab ${tab.id} already closed`);
        }
      });
    });
  });
}

// Set up the monitoring alarm with jitter for stealth
function setupMonitoring(intervalSeconds) {
  // Clear any existing alarms
  chrome.alarms.clearAll();
  
  if (intervalSeconds < 30) {
    console.log("Interval too low, setting to minimum 30 seconds");
    intervalSeconds = 30; // Safety minimum
  }
  
  // Add jitter to the interval to make it less predictable
  const jitter = Math.random() * 0.3; // Up to 30% jitter
  const adjustedInterval = intervalSeconds * (1 + jitter);
  
  // Create a new alarm that will trigger the check
  chrome.alarms.create('checkStock', {
    periodInMinutes: adjustedInterval / 60
  });
  
  console.log(`Monitoring set up with interval: ${adjustedInterval.toFixed(2)} seconds`);
  
  // Listen for the alarm - only set this up once
  chrome.alarms.onAlarm.removeListener(alarmListener); // Remove any existing listener
  chrome.alarms.onAlarm.addListener(alarmListener);
}

// Separate function for the alarm listener to avoid duplication
function alarmListener(alarm) {
  if (alarm.name === 'checkStock' && isMonitoring) {
    // Check if we're in circuit breaker cooldown
    if (consecutiveFailures >= MAX_FAILURES) {
      console.log("Circuit breaker active - skipping check");
      return;
    }
    
    // Check if we've exceeded our tab limit (safety measure)
    if (tabsCreatedThisSession >= MAX_TABS_PER_SESSION) {
      console.log("Safety limit: Too many tabs created this session. Stopping monitoring.");
      isMonitoring = false;
      chrome.alarms.clearAll();
      return;
    }
    
    // Ensure minimum time between checks
    const now = Date.now();
    const timeSinceLastCheck = now - lastCheckTime;
    if (timeSinceLastCheck < MIN_CHECK_INTERVAL_MS) {
      console.log(`Check attempted too soon (${timeSinceLastCheck}ms since last check), skipping`);
      return;
    }
    
    // Now it's safe to check
    lastCheckTime = now;
    checkAllProductsStock();
  }
}

// Check stock for all monitored products with safeguards
async function checkAllProductsStock() {
  if (monitoredProducts.length === 0 || checkoutInProgress) {
    console.log("No products to check or checkout in progress, skipping check");
    return;
  }
  
  console.log(`Starting stock check for ${monitoredProducts.length} products`);
  
  // Limit the number of products we check at once
  const productsToCheck = getProductsToCheck();
  console.log(`Selected ${productsToCheck.length} products to check this cycle`);
  
  // Occasionally clear cookies
  if (Math.random() < 0.1) {
    try {
      await manageCookies();
    } catch (error) {
      console.error("Error managing cookies:", error);
    }
  }
  
  // Check each product with a delay between
  for (const product of productsToCheck) {
    try {
      // Add a random delay between product checks
      const staggerDelay = Math.floor(Math.random() * 5000) + 2000; // 2-7 seconds between products
      await new Promise(resolve => setTimeout(resolve, staggerDelay));
      
      // Skip some checks randomly (about 10% of the time)
      if (Math.random() < 0.1) {
        console.log(`Randomly skipping check for ${product.name} to appear more human-like`);
        continue;
      }
      
      console.log(`Checking stock for: ${product.name}`);
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
        
        // IMPORTANT: ONLY attempt checkout if it's explicitly enabled AND we're monitoring
        if (isMonitoring && product.autoCheckout === true) {
          checkoutInProgress = true;
          await attemptCheckout(product);
          checkoutInProgress = false;
        }
      }
      
      // Reset failures on successful check
      consecutiveFailures = 0;
    } catch (error) {
      console.error(`Error checking ${product.name}:`, error);
      consecutiveFailures++;
      
      // Check if we should trigger the circuit breaker
      if (consecutiveFailures >= MAX_FAILURES) {
        console.log(`Circuit breaker tripped after ${consecutiveFailures} failures`);
        
        // Schedule a reset of the circuit breaker after cooldown
        setTimeout(() => {
          console.log("Circuit breaker reset");
          consecutiveFailures = 0;
        }, FAILURE_COOLDOWN_MS);
      }
    }
  }
  
  // Broadcast stock status update to popup if open
  chrome.runtime.sendMessage({
    action: 'stockStatusUpdate',
    stockStatus: stockStatus
  });
  
  console.log("Stock check cycle completed");
}

// Safe tab creation with tracking
async function createSafeTab(url, active = false) {
  // Safety check - only create tabs if we're monitoring
  if (!isMonitoring && !checkoutInProgress) {
    console.log("Tab creation blocked - monitoring is off and not in checkout");
    throw new Error("Cannot create tab when monitoring is inactive");
  }
  
  // Check if we're above our limit
  if (tabsCreatedThisSession >= MAX_TABS_PER_SESSION) {
    console.log("Tab limit reached, cannot create more tabs");
    throw new Error("Tab creation limit reached");
  }
  
  // Create the tab
  tabsCreatedThisSession++;
  const tab = await chrome.tabs.create({ url, active });
  activeTabs.push(tab.id);
  
  // Set up auto-cleanup for this tab
  setTimeout(() => {
    chrome.tabs.get(tab.id, (tabInfo) => {
      if (chrome.runtime.lastError) {
        // Tab already closed
        const index = activeTabs.indexOf(tab.id);
        if (index > -1) activeTabs.splice(index, 1);
      } else {
        // Tab still open, force close it after timeout (safety)
        chrome.tabs.remove(tab.id, () => {
          const index = activeTabs.indexOf(tab.id);
          if (index > -1) activeTabs.splice(index, 1);
        });
      }
    });
  }, 30000); // 30-second safety timeout
  
  return tab;
}

// Router function to check stock based on retailer
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

// Simplified, reliable Target stock check
async function checkTargetStock(product) {
  try {
    // First try a simple fetch to check for obvious indicators
    const headers = getRandomizedHeaders();
    const response = await fetch(product.url, {
      headers: headers,
      credentials: 'omit' // Don't send cookies
    });
    
    if (!response.ok) {
      console.error(`Error fetching page: ${response.status} ${response.statusText}`);
      return false;
    }
    
    const html = await response.text();
    
    // Check for obvious out-of-stock text
    if (html.includes("Out of stock") || 
        html.includes("Sold out") || 
        html.includes("Preorders have sold out")) {
      console.log("Found obvious out-of-stock text in HTML");
      return false;
    }
    
    // Check for in-stock indicators
    const hasAddToCartButton = html.includes("Add to cart</button>");
    const hasArrivesBy = html.includes("Arrives by");
    
    if (hasAddToCartButton && hasArrivesBy) {
      console.log("Found 'Add to cart' button and 'Arrives by' text - likely in stock");
      return true;
    }
    
    // If still uncertain, try browser automation as a last resort
    try {
      console.log("Using browser check as fallback");
      
      const tab = await createSafeTab(product.url, false);
      
      // Wait for the page to load properly
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      // Run our simplified check script
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: simpleTargetStockCheck
      });
      
      // Close the tab
      chrome.tabs.remove(tab.id, () => {
        const index = activeTabs.indexOf(tab.id);
        if (index > -1) activeTabs.splice(index, 1);
      });
      
      if (results && results[0] && results[0].result) {
        console.log("Browser check results:", results[0].result);
        return results[0].result.inStock;
      }
    } catch (tabError) {
      console.error("Browser check failed:", tabError);
      // Fall back to HTML result if browser check fails
      return hasAddToCartButton;
    }
    
    return false;
  } catch (error) {
    console.error(`Error checking Target stock for ${product.url}:`, error);
    return false;
  }
}

// Simplified browser-side stock check function
function simpleTargetStockCheck() {
  try {
    // Create a simple result object
    const result = {
      inStock: false,
      reason: "default",
      debug: {}
    };
    
    // 1. Check for truly obvious indicators
    
    // Out of stock text
    if (document.body.innerText.includes("Out of stock") || 
        document.body.innerText.includes("Sold out") ||
        document.body.innerText.includes("Preorders have sold out")) {
      result.inStock = false;
      result.reason = "out_of_stock_text";
      return result;
    }
    
    // 2. Check for red Add to cart button - extremely reliable indicator
    const addToCartButtons = Array.from(document.querySelectorAll('button')).filter(btn => 
      btn.innerText.trim().toLowerCase() === "add to cart"
    );
    
    if (addToCartButtons.length > 0) {
      // Find if any aren't disabled
      const enabledButton = addToCartButtons.find(btn => !btn.disabled);
      if (enabledButton) {
        result.inStock = true;
        result.reason = "enabled_add_to_cart_button";
        return result;
      }
    }
    
    // 3. Check for shipping option with arrival date
    const hasShippingOption = document.querySelector('button[data-test="fulfillment-cell-shipping"]');
    const hasArrivalDate = document.body.innerText.includes("Arrives by");
    
    if (hasShippingOption && hasArrivalDate) {
      result.inStock = true;
      result.reason = "shipping_with_arrival";
      return result;
    }
    
    // If we reach here, we're uncertain - default to out of stock
    result.reason = "uncertain";
    return result;
    
  } catch (error) {
    console.error("Error in browser stock check:", error);
    return { inStock: false, error: error.toString() };
  }
}

// Best Buy stock checking
async function checkBestBuyStock(product) {
  // Similar simplified implementation as for Target
  // Focusing on HTML parsing first, browser check as fallback
  // Code omitted for brevity
  return false; // Placeholder
}

// Generic stock check
async function checkGenericStock(product) {
  // Similar simplified implementation
  // Code omitted for brevity
  return false; // Placeholder
}

// Helper functions
function getRandomizedHeaders() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:98.0) Gecko/20100101 Firefox/98.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 12_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.3 Safari/605.1.15'
  ];
  
  return {
    'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'DNT': '1'
  };
}

async function manageCookies() {
  const targetDomains = ['target.com', 'www.target.com', '.target.com'];
  
  for (const domain of targetDomains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const cookie of cookies) {
        await chrome.cookies.remove({
          url: `https://${cookie.domain}${cookie.path}`,
          name: cookie.name
        });
      }
    } catch (error) {
      console.error(`Error clearing cookies for ${domain}:`, error);
    }
  }
  
  console.log('Cleared cookies for target domains');
}

function getProductsToCheck() {
  if (monitoredProducts.length <= 3) {
    return monitoredProducts;
  }
  
  // Check fewer products (50%) to reduce load
  const shuffled = [...monitoredProducts].sort(() => 0.5 - Math.random());
  const numToCheck = Math.ceil(monitoredProducts.length * 0.5);
  return shuffled.slice(0, numToCheck);
}

function notifyStockAvailable(product) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'images/icon128.png',
    title: 'Pokemon Cards In Stock!',
    message: `${product.name} is now available! ${product.autoCheckout ? 'Attempting checkout...' : ''}`,
    priority: 2
  });
}

// Heavily simplified checkout functions with proper safety checks
async function attemptCheckout(product) {
  // Only proceed if monitoring is active and auto-checkout is enabled
  if (!isMonitoring || !product.autoCheckout) {
    console.log("Checkout aborted - monitoring is off or auto-checkout disabled");
    return false;
  }
  
  try {
    // Further implementation would go here...
    return false; // Temporarily disabled for safety
  } catch (error) {
    console.error('Checkout process failed:', error);
    return false;
  }
}

// Message handlers
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message.action);
  
  if (message.action === 'startMonitoring') {
    console.log("Starting monitoring");
    isMonitoring = true;
    tabsCreatedThisSession = 0; // Reset tab counter
    consecutiveFailures = 0; // Reset failures
    
    // Immediately check stock when monitoring starts
    checkAllProductsStock();
    sendResponse({ success: true });
  } 
  else if (message.action === 'stopMonitoring') {
    console.log("Stopping monitoring");
    isMonitoring = false;
    
    // Clean up resources
    chrome.alarms.clearAll();
    closeAllMonitoringTabs();
    
    sendResponse({ success: true });
  }
  else if (message.action === 'getMonitoringStatus') {
    // Also return alarm and tab info for debugging
    chrome.alarms.getAll((alarms) => {
      sendResponse({ 
        isMonitoring: isMonitoring,
        activeTabs: activeTabs.length,
        alarms: alarms.length,
        failures: consecutiveFailures
      });
    });
    return true; // For async response
  }
  else if (message.action === 'debug') {
    // Debug command to report on internal state
    const state = {
      isMonitoring,
      checkoutInProgress,
      monitoredProducts: monitoredProducts.length,
      activeTabs: activeTabs.length,
      tabsCreatedThisSession,
      consecutiveFailures,
      lastCheckTime
    };
    console.log("Current state:", state);
    
    // Also force cleanup
    closeAllMonitoringTabs();
    chrome.alarms.clearAll();
    
    sendResponse({ state });
  }
  
// Message handlers
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message.action);
  
  if (message.action === 'startMonitoring') {
    console.log("Starting monitoring");
    isMonitoring = true;
    tabsCreatedThisSession = 0; // Reset tab counter
    consecutiveFailures = 0; // Reset failures
    
    // Immediately check stock when monitoring starts
    checkAllProductsStock();
    sendResponse({ success: true });
  } 
  else if (message.action === 'stopMonitoring') {
    console.log("Stopping monitoring");
    isMonitoring = false;
    
    // Clean up resources
    chrome.alarms.clearAll();
    closeAllMonitoringTabs();
    
    sendResponse({ success: true });
  }
  else if (message.action === 'getMonitoringStatus') {
    // Also return alarm and tab info for debugging
    chrome.alarms.getAll((alarms) => {
      sendResponse({ 
        isMonitoring: isMonitoring,
        activeTabs: activeTabs.length,
        alarms: alarms.length,
        failures: consecutiveFailures
      });
    });
    return true; // For async response
  }
  else if (message.action === 'debug') {
    // Debug command to report on internal state
    const state = {
      isMonitoring,
      checkoutInProgress,
      monitoredProducts: monitoredProducts.length,
      activeTabs: activeTabs.length,
      tabsCreatedThisSession,
      consecutiveFailures,
      lastCheckTime
    };
    console.log("Current state:", state);
    
    // Also force cleanup
    closeAllMonitoringTabs();
    chrome.alarms.clearAll();
    
    sendResponse({ state });
  }
  else if (message.action === 'addProduct') {
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
      
      // Only check stock if monitoring is active
      if (isMonitoring) {
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
      } else {
        // If not monitoring, just respond with success
        sendResponse({ 
          success: true, 
          products: monitoredProducts,
          stockStatus: stockStatus
        });
      }
    } catch (error) {
      console.error('Error adding product:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Required for async response
  } 
  else if (message.action === 'removeProduct') {
    monitoredProducts = monitoredProducts.filter(p => p.url !== message.url);
    chrome.storage.sync.set({ monitoredProducts });
    // Remove from stock status
    delete stockStatus[message.url];
    sendResponse({ success: true, products: monitoredProducts, stockStatus: stockStatus });
  } 
  else if (message.action === 'getProducts') {
    sendResponse({ products: monitoredProducts, stockStatus: stockStatus });
  } 
  else if (message.action === 'updateCheckInterval') {
    // Enforce minimum interval for safety
    const seconds = Math.max(30, message.seconds);
    setupMonitoring(seconds);
    chrome.storage.sync.set({ checkInterval: seconds });
    sendResponse({ success: true });
  } 
  else if (message.action === 'forceCheck') {
    // Only allow manual checks if monitoring is active
    if (isMonitoring) {
      checkAllProductsStock().then(() => {
        sendResponse({ success: true, stockStatus: stockStatus });
      });
    } else {
      sendResponse({ success: false, reason: "monitoring_inactive" });
    }
    return true; // Required for async response
  } 
  else if (message.action === 'addToCart') {
    // Only allow add to cart if explicitly requested by user
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
      
      // Add special flag to indicate this is an explicit user-requested checkout
      // This allows checkout even when monitoring is off
      checkoutInProgress = true;
      
      let cartResult;
      try {
        if (isTarget) {
          cartResult = await addToCartTarget(message.product, message.cartUrl, purchaseCount, true);
        } else if (isBestBuy) {
          cartResult = await addToCartBestBuy(message.product, message.cartUrl, purchaseCount, true);
        } else {
          cartResult = await addToCartGeneric(message.product, message.cartUrl, purchaseCount, true);
        }
      } finally {
        // Always reset checkout flag when done
        checkoutInProgress = false;
      }
      
      sendResponse(cartResult);
    });
    
    return true; // Required for async response
  } 
  else if (message.action === 'updatePurchaseLimit') {
    chrome.storage.sync.set({ purchaseLimit: message.limit });
    sendResponse({ success: true });
  } 
  else if (message.action === 'resetPurchaseCount') {
    chrome.storage.sync.set({ purchaseCount: 0 });
    sendResponse({ success: true });
  } 
  else if (message.action === 'getPurchaseStats') {
    chrome.storage.sync.get(['purchaseCount', 'purchaseLimit'], (result) => {
      sendResponse({
        count: result.purchaseCount || 0,
        limit: result.purchaseLimit || 3
      });
    });
    return true; // Required for async response
  }
  else if (message.action === 'emergencyStop') {
    // Emergency stop command to halt all activity
    isMonitoring = false;
    checkoutInProgress = false;
    chrome.alarms.clearAll();
    closeAllMonitoringTabs();
    console.log("EMERGENCY STOP EXECUTED - ALL MONITORING HALTED");
    sendResponse({ success: true });
  }
  
  return true; // Required for async response
});

// Modified cart functions with extra safety parameter
async function addToCartTarget(product, directCartUrl, purchaseCount, userInitiated = false) {
  try {
    // Only proceed if monitoring is active OR this was explicitly user initiated
    if (!isMonitoring && !userInitiated) {
      console.log("Add to cart blocked - monitoring is off and not user initiated");
      return { success: false, error: "monitoring_inactive" };
    }
    
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
        const tab = await createSafeTab(directCartUrl, true);
        
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
    const tab = await createSafeTab(product.url, false);
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
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

// This function runs in the context of the Target page
function performTargetAddToCart(tcin) {
  return new Promise(async (resolve) => {
    try {
      console.log("Starting Target add to cart process");
      
      // Step 1: First select the shipping fulfillment option (card/button)
      const shippingOptionSelectors = [
        'button[data-test="fulfillment-cell-shipping"]',
        'button[aria-label*="shipping"]',
        'button[aria-label*="Shipping"]',
        'button[class*="ndsButtonSecondary"][data-test="fulfillment-cell-shipping"]'
      ];
      
      let shippingSelected = false;
      
      // Try to select shipping option
      for (const selector of shippingOptionSelectors) {
        const shippingButtons = document.querySelectorAll(selector);
        console.log(`Found ${shippingButtons.length} shipping option buttons with selector: ${selector}`);
        
        for (const button of shippingButtons) {
          if (button && !button.disabled && button.offsetParent !== null) {
            // Log the button we're about to click
            console.log(`Clicking shipping option: ${button.textContent.trim()}`);
            button.click();
            shippingSelected = true;
            break;
          }
        }
        
        if (shippingSelected) break;
      }
      
      if (shippingSelected) {
        console.log("Shipping option selected, waiting before proceeding to Add to Cart");
        // Give time for the UI to update after selecting shipping
        await new Promise(resolve => setTimeout(resolve, 1500));
      } else {
        console.log("No shipping option needed or found, proceeding to Add to Cart");
      }
      
      // Step 2: Look for the RED "Add to cart" button
      const allButtons = document.querySelectorAll('button');
      let addToCartButton = null;
      
      // First try to find a red "Add to cart" button
      for (const button of allButtons) {
        if (button.innerText.trim().toLowerCase() === "add to cart" && 
            !button.disabled && button.offsetParent !== null) {
          
          const style = getComputedStyle(button);
          const bgColor = style.backgroundColor;
          
          // Check if it's a red button (Target's primary action color)
          if (bgColor.includes('rgb(204, 0, 0)') || 
              bgColor.includes('rgb(255, 0, 0)') ||
              bgColor === '#cc0000' || 
              bgColor === '#ff0000') {
            
            console.log("Found RED Add to Cart button");
            addToCartButton = button;
            break;
          }
        }
      }
      
      // If no red button found, fall back to other selectors
      if (!addToCartButton) {
        const addToCartSelectors = [
          'button[data-test="shippingButton"]',
          'button[data-test="addToCartButton"]',
          'button[id*="addToCartButtonOrTextIdFor"]'
        ];
        
        for (const selector of addToCartSelectors) {
          const buttons = document.querySelectorAll(selector);
          for (const button of buttons) {
            if (button && !button.disabled && button.offsetParent !== null) {
              const buttonText = button.textContent.trim().toLowerCase();
              if (buttonText.includes('add to cart') || buttonText.includes('add for shipping')) {
                console.log(`Found Add to Cart button: ${buttonText}`);
                addToCartButton = button;
                break;
              }
            }
          }
          if (addToCartButton) break;
        }
      }
      
      // Click the button if found
      if (addToCartButton) {
        addToCartButton.click();
        console.log("Add to Cart button clicked");
      } else {
        console.error('Could not find enabled Add to Cart button');
        resolve({ success: false, error: 'No Add to Cart button found' });
        return;
      }
      
      // Wait for the cart update
      console.log("Waiting for cart update...");
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Look for go to cart button
      const goToCartButtons = document.querySelectorAll('button[data-test="goToCartButton"], a[href="/cart"]');
      if (goToCartButtons.length > 0) {
        console.log("Clicking Go to Cart button");
        goToCartButtons[0].click();
      } else {
        console.log("No Go to Cart button found, navigating directly to cart");
        window.location.href = 'https://www.target.com/cart';
      }
      
      resolve({ success: true, method: 'button' });
    } catch (error) {
      console.error('Target add to cart process failed:', error);
      resolve({ success: false, error: error.message });
    }
  });
}

// Stubs for the other cart functions - implement similarly to the Target function
async function addToCartBestBuy(product, directCartUrl, purchaseCount, userInitiated = false) {
  // Safety check
  if (!isMonitoring && !userInitiated) {
    return { success: false, error: "monitoring_inactive" };
  }
  
  // Implementation would go here
  return { success: false, error: "not_implemented" };
}

async function addToCartGeneric(product, directCartUrl, purchaseCount, userInitiated = false) {
  // Safety check
  if (!isMonitoring && !userInitiated) {
    return { success: false, error: "monitoring_inactive" };
  }
  
  // Implementation would go here
  return { success: false, error: "not_implemented" };
}

// Periodically clean up tabs and check for issues (safety watchdog)
setInterval(() => {
  // If monitoring is off but we still have active tabs, force close them
  if (!isMonitoring && activeTabs.length > 0) {
    console.log(`Safety watchdog: Found ${activeTabs.length} active tabs while monitoring is off`);
    closeAllMonitoringTabs();
  }
  
  // If tab count is suspiciously high, log a warning
  if (activeTabs.length > 5) {
    console.log(`Warning: High number of active tabs (${activeTabs.length})`);
  }
  
  // Reset tab counter daily
  const now = new Date();
  if (now.getHours() === 3 && now.getMinutes() < 5) { // Around 3 AM
    tabsCreatedThisSession = 0;
    console.log("Daily tab counter reset");
  }
}, 60000); // Check every minute
  
  return true; // Required for async response
});
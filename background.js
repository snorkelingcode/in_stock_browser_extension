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

// Set up the monitoring alarm with jitter for stealth
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

// Check stock for all monitored products with staggered timing
async function checkAllProductsStock() {
  if (monitoredProducts.length === 0 || checkoutInProgress) return;
  
  // Only check a random subset of products to reduce detection
  const productsToCheck = getProductsToCheck();
  
  // Occasionally clear cookies to avoid building profiles
  if (Math.random() < 0.1) { // 10% chance each check cycle
    try {
      await manageCookies();
    } catch (error) {
      console.error("Error managing cookies:", error);
    }
  }
  
  // Instead of checking all products at once, stagger them
  for (const product of productsToCheck) {
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

// The most reliable way to check Target stock - always use browser automation to detect enabled buttons
// The most reliable way to check Target stock - look for specific visual elements
async function checkTargetStock(product) {
  try {
    console.log(`Checking stock for: ${product.url}`);
    
    // Create a hidden tab to check the page with real browser rendering
    const tab = await chrome.tabs.create({ 
      url: product.url, 
      active: false // Keep it in background
    });
    
    // Wait for the page to load properly
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    // Run a simple, focused script in the context of the page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: simpleTargetStockCheck
    });
    
    // Close the tab
    chrome.tabs.remove(tab.id);
    
    if (results && results[0] && results[0].result) {
      const checkResult = results[0].result;
      console.log("Simple Target stock check results:", checkResult);
      return checkResult.inStock;
    }
    
    return false;
  } catch (error) {
    console.error(`Error checking Target stock for ${product.url}:`, error);
    return false;
  }
}

// A simpler approach focusing on reliable visual indicators
function simpleTargetStockCheck() {
  try {
    // Create an object to store our findings
    const result = {
      inStock: false,
      reason: "default",
      debug: {}
    };
    
    // 1. Check for RED "Add to cart" button (most reliable in-stock indicator)
    const allButtons = document.querySelectorAll('button');
    let addToCartButton = null;
    
    // Find button with "Add to cart" text
    for (const button of allButtons) {
      if (button.innerText.trim().toLowerCase() === "add to cart") {
        addToCartButton = button;
        break;
      }
    }
    
    result.debug.foundAddToCartButton = !!addToCartButton;
    
    if (addToCartButton) {
      // Check if it's enabled
      const isDisabled = addToCartButton.disabled || 
                       addToCartButton.hasAttribute('disabled') ||
                       addToCartButton.getAttribute('aria-disabled') === 'true';
      
      // Check if it's red (Target's in-stock color)
      const style = getComputedStyle(addToCartButton);
      const backgroundColor = style.backgroundColor;
      
      result.debug.addToCartButtonDisabled = isDisabled;
      result.debug.addToCartButtonColor = backgroundColor;
      
      // If we have a red, enabled "Add to cart" button, it's definitely in stock
      if (!isDisabled && (
          backgroundColor.includes('rgb(204, 0, 0)') || 
          backgroundColor.includes('rgb(255, 0, 0)') ||
          backgroundColor === '#cc0000' ||
          backgroundColor === '#ff0000')) {
        result.inStock = true;
        result.reason = "red_enabled_add_to_cart_button";
        return result;
      }
    }
    
    // 2. Check for explicit "Out of stock" text
    const pageText = document.body.innerText;
    if (pageText.includes("Out of stock")) {
      result.inStock = false;
      result.reason = "explicit_out_of_stock_text";
      return result;
    }
    
    // 3. Check for "Preorders have sold out" text
    if (pageText.includes("Preorders have sold out")) {
      result.inStock = false;
      result.reason = "preorders_sold_out";
      return result;
    }
    
    // 4. Check for "shipping" option with "arrives by" date (good in-stock indicator)
    const hasShippingOption = document.querySelector('button[data-test="fulfillment-cell-shipping"]');
    const hasArrivesByText = pageText.includes("Arrives by");
    
    result.debug.hasShippingOption = !!hasShippingOption;
    result.debug.hasArrivesByText = hasArrivesByText;
    
    if (hasShippingOption && hasArrivesByText) {
      result.inStock = true;
      result.reason = "shipping_with_arrival_date";
      return result;
    }
    
    // If we get here, use some backup checks
    
    // 5. Check for any enabled button with "add to cart" in its text
    for (const button of allButtons) {
      const buttonText = button.innerText.toLowerCase();
      if (buttonText.includes("add to cart") && !button.disabled) {
        result.inStock = true;
        result.reason = "enabled_add_to_cart_text";
        return result;
      }
    }
    
    // 6. Final fallback: check if the page has a quantity selector and enabled "Add to cart" button
    const hasQuantitySelector = document.querySelector('div[data-test="qtySpinner"]') || 
                               document.querySelector('select[id="quantity"]');
                               
    result.debug.hasQuantitySelector = !!hasQuantitySelector;
    
    if (hasQuantitySelector && addToCartButton && !addToCartButton.disabled) {
      result.inStock = true;
      result.reason = "quantity_selector_with_enabled_button";
      return result;
    }
    
    // Default: if we can't find clear in-stock indicators, consider it out of stock
    result.reason = "no_clear_indicators";
    return result;
    
  } catch (error) {
    console.error("Error in simple Target stock check:", error);
    return { 
      inStock: false, 
      reason: "error",
      error: error.toString()
    };
  }
}

function checkButtonDisabledStateTarget() {
  try {
    console.log("Starting Target button state check...");
    
    // 1. MOST DIRECT INDICATORS - these are clear visual indicators on the page
    
    // Check for explicit "OUT OF STOCK" text first (very reliable indicator)
    const explicitOutOfStock = document.querySelector('div:contains("Out of stock")');
    if (explicitOutOfStock) {
      console.log("Found explicit 'Out of stock' message on page");
      return {
        inStock: false,
        outOfStock: true,
        foundButtons: [],
        reason: "explicit_out_of_stock_message"
      };
    }

    // Check if there's a "Notify me when it's back" button (very reliable out-of-stock indicator)
    const notifyButton = document.querySelector('button:contains("Notify me when")');
    if (notifyButton) {
      console.log("Found 'Notify me when it's back' button");
      return {
        inStock: false,
        outOfStock: true,
        foundButtons: [],
        reason: "notify_button_present"
      };
    }
    
    // Check for "Preorders have sold out" text
    const preordersSoldOut = document.body.innerText.includes("Preorders have sold out");
    if (preordersSoldOut) {
      console.log("Found 'Preorders have sold out' text");
      return {
        inStock: false,
        outOfStock: true,
        foundButtons: [],
        reason: "preorders_sold_out"
      };
    }
    
    // Check for RED "Add to cart" button (very reliable in-stock indicator)
    const redAddToCartButton = Array.from(document.querySelectorAll('button')).find(btn => {
      const style = getComputedStyle(btn);
      const isRed = style.backgroundColor.includes('rgb(204, 0, 0)') || 
                   style.backgroundColor.includes('rgb(255, 0, 0)') ||
                   style.backgroundColor.includes('#cc0000') ||
                   style.backgroundColor.includes('#ff0000');
      
      const hasAddToCartText = btn.innerText.toLowerCase().includes('add to cart');
      
      return isRed && hasAddToCartText && !btn.disabled;
    });
    
    if (redAddToCartButton) {
      console.log("Found RED 'Add to cart' button - item is definitely in stock");
      return {
        inStock: true,
        outOfStock: false,
        foundButtons: [{
          text: redAddToCartButton.innerText,
          disabled: false,
          selector: "red_add_to_cart"
        }],
        reason: "red_add_to_cart_button"
      };
    }
    
    // Check for "Shipping" fulfillment option with an "Arrives by" date
    const shippingOption = document.querySelector('.styles__FulfillmentTileInfoWrapper-sc-1hh5gkt-2:contains("Shipping")') ||
                          document.querySelector('[data-test="fulfillment-cell-shipping"]:contains("Shipping")');
    
    const hasArrivesByDate = document.querySelector('span:contains("Arrives by")') || 
                            document.body.innerText.includes("Arrives by");
    
    if (shippingOption && hasArrivesByDate) {
      console.log("Found shipping option with 'Arrives by' date - item is likely in stock");
      return {
        inStock: true,
        outOfStock: false,
        foundButtons: [],
        reason: "shipping_with_arrival_date"
      };
    }
    
    // 2. BUTTON STATE CHECKS - more detailed analysis of button states
    
    // Look for add to cart and preorder buttons
    const buttonSelectors = [
      'button[data-test="shippingButton"]',
      'button[data-test="addToCartButton"]',
      'button[data-test="preorderButton"]',
      'button[id*="addToCartButtonOrTextIdFor"]'
    ];
    
    let foundButtons = [];
    let hasEnabledAddToCartButton = false;
    let hasDisabledPreorderButton = false;
    
    // Check each selector
    for (const selector of buttonSelectors) {
      const buttons = document.querySelectorAll(selector);
      for (const button of buttons) {
        // Check if button exists and is visible
        if (button && button.offsetParent !== null) {
          const buttonText = button.textContent.trim();
          const isDisabled = button.disabled || 
                          button.hasAttribute('disabled') || 
                          button.getAttribute('aria-disabled') === 'true' ||
                          button.dataset.test === 'preorderButtonDisabled' ||
                          button.classList.contains('disabled');
          
          console.log(`Found button: "${buttonText}", disabled: ${isDisabled}`);
          
          foundButtons.push({
            text: buttonText,
            disabled: isDisabled,
            selector: selector
          });
          
          if (!isDisabled && 
             (buttonText.toLowerCase().includes('add to cart') || 
              buttonText.toLowerCase().includes('add for shipping'))) {
            hasEnabledAddToCartButton = true;
          }
          
          if (isDisabled && buttonText.toLowerCase().includes('preorder')) {
            hasDisabledPreorderButton = true;
          }
        }
      }
    }
    
    // Check for any enabled "Add to cart" button
    if (hasEnabledAddToCartButton) {
      console.log("Found enabled 'Add to cart' button - item is in stock");
      return {
        inStock: true,
        outOfStock: false,
        foundButtons: foundButtons,
        reason: "enabled_add_to_cart_button"
      };
    }
    
    // Check for disabled preorder button - clear indicator item is out of stock
    if (hasDisabledPreorderButton) {
      console.log("Found disabled 'Preorder' button - item is out of stock");
      return {
        inStock: false,
        outOfStock: true,
        foundButtons: foundButtons,
        reason: "disabled_preorder_button"
      };
    }
    
    // If we have any buttons but they're all disabled, probably out of stock
    if (foundButtons.length > 0 && foundButtons.every(btn => btn.disabled)) {
      console.log("All buttons are disabled - item is likely out of stock");
      return {
        inStock: false,
        outOfStock: true,
        foundButtons: foundButtons,
        reason: "all_buttons_disabled"
      };
    }
    
    // If we get here, we didn't find clear indicators either way
    console.log("No clear stock indicators found - defaulting to out of stock to be safe");
    return {
      inStock: false,
      outOfStock: true,
      foundButtons: foundButtons,
      reason: "no_clear_indicators"
    };
    
  } catch (error) {
    console.error("Error in target button state detection:", error);
    return { 
      error: error.toString(), 
      inStock: false,
      foundButtons: [],
      reason: "error"
    };
  }
}

// Check button states in Best Buy pages
function checkButtonDisabledStateBestBuy() {
  try {
    // Look for Add to Cart buttons
    const addToCartSelectors = [
      'button.add-to-cart-button',
      'button[data-button-state="ADD_TO_CART"]',
      'button.c-button-primary',
      'button[data-sku-id]'
    ];
    
    let foundButtons = [];
    let hasEnabledAddToCartButton = false;
    
    // Check each selector
    for (const selector of addToCartSelectors) {
      const buttons = document.querySelectorAll(selector);
      for (const button of buttons) {
        if (button && button.offsetParent !== null) {
          const buttonText = button.textContent.trim();
          const isDisabled = 
            button.disabled || 
            button.classList.contains('disabled') || 
            button.getAttribute('disabled') === 'true' ||
            button.getAttribute('aria-disabled') === 'true' ||
            button.getAttribute('data-button-state') === 'SOLD_OUT' ||
            getComputedStyle(button).cursor === 'not-allowed';
          
          foundButtons.push({
            text: buttonText,
            disabled: isDisabled,
            selector: selector
          });
          
          if (!isDisabled && buttonText.toLowerCase().includes('add to cart')) {
            hasEnabledAddToCartButton = true;
          }
        }
      }
    }
    
    // Check for out of stock text on the page
    const pageText = document.body.innerText.toLowerCase();
    const hasOutOfStockText = [
      'sold out',
      'out of stock',
      'coming soon'
    ].some(text => pageText.includes(text));
    
    return {
      inStock: hasEnabledAddToCartButton && !hasOutOfStockText,
      foundButtons: foundButtons,
      hasOutOfStockText: hasOutOfStockText
    };
  } catch (error) {
    console.error("Error in Best Buy button check:", error);
    return { inStock: false, error: error.toString() };
  }
}

// Generic stock check for other retailers
async function checkGenericStock(product) {
  try {
    // Create a browser tab to check the actual button state (most reliable)
    try {
      const tab = await chrome.tabs.create({ 
        url: product.url, 
        active: false
      });
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: checkButtonDisabledStateGeneric
      });
      
      chrome.tabs.remove(tab.id);
      
      if (results && results[0] && results[0].result) {
        console.log("Generic site button check results:", results[0].result);
        return results[0].result.inStock;
      }
    } catch (tabError) {
      console.error("Generic site tab verification failed:", tabError);
    }
    
    // If browser check fails, fall back to HTML parsing
    const headers = getRandomizedHeaders();
    const response = await fetch(product.url, { 
      headers: headers,
      credentials: 'omit'
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
    
    return isInStock && !isOutOfStock;
  } catch (error) {
    console.error(`Error checking generic stock for ${product.url}:`, error);
    return false;
  }
}

// Check button states in generic retailer pages
function checkButtonDisabledStateGeneric() {
  try {
    // Common selectors for add to cart buttons
    const addToCartSelectors = [
      'button[id*="add-to-cart"]',
      'button[name*="add-to-cart"]',
      'button[class*="add-to-cart"]',
      'button.add_to_cart_button',
      'button.addToCart',
      'button.add_to_cart',
      'input[name*="add-to-cart"]',
      'a[href*="add-to-cart"]',
      'a.add_to_cart_button'
    ];
    
    let foundButtons = [];
    let hasEnabledAddToCartButton = false;
    
    // Check each selector
    for (const selector of addToCartSelectors) {
      const buttons = document.querySelectorAll(selector);
      for (const button of buttons) {
        if (button && button.offsetParent !== null) {
          const buttonText = button.textContent.trim();
          const isDisabled = 
            button.disabled || 
            button.classList.contains('disabled') || 
            button.getAttribute('disabled') === 'true' ||
            button.getAttribute('aria-disabled') === 'true' ||
            getComputedStyle(button).cursor === 'not-allowed';
          
          foundButtons.push({
            text: buttonText,
            disabled: isDisabled,
            selector: selector
          });
          
          if (!isDisabled && 
              (buttonText.toLowerCase().includes('add to cart') ||
               buttonText.toLowerCase().includes('add to bag'))) {
            hasEnabledAddToCartButton = true;
          }
        }
      }
    }
    
    // Also check all buttons for text
    if (!hasEnabledAddToCartButton) {
      const allButtons = document.querySelectorAll('button');
      for (const button of allButtons) {
        if (button && button.offsetParent !== null) {
          const buttonText = button.textContent.trim().toLowerCase();
          const isCart = ['add to cart', 'add to bag', 'buy now'].some(text => 
            buttonText.includes(text)
          );
          
          if (isCart && !button.disabled) {
            hasEnabledAddToCartButton = true;
            break;
          }
        }
      }
    }
    
    // Check for out of stock text on the page
    const pageText = document.body.innerText.toLowerCase();
    const hasOutOfStockText = [
      'sold out',
      'out of stock',
      'currently unavailable',
      'coming soon'
    ].some(text => pageText.includes(text));
    
    return {
      inStock: hasEnabledAddToCartButton && !hasOutOfStockText,
      foundButtons: foundButtons,
      hasOutOfStockText: hasOutOfStockText
    };
  } catch (error) {
    console.error("Error in generic button check:", error);
    return { inStock: false, error: error.toString() };
  }
}

// Helper functions for extracting product information
function extractBestBuySku(url) {
  let sku = '';
  
  // Extract SKU from URL
  if (url.includes('/skuId=')) {
    sku = url.split('/skuId=')[1].split('&')[0].split('/')[0];
  } else if (url.includes('/p/')) {
    // Format: /p/[some-text]/[SKU]
    const parts = url.split('/p/');
    if (parts.length > 1) {
      const afterP = parts[1].split('/');
      if (afterP.length > 1) {
        sku = afterP[1].split('?')[0].split('#')[0];
      }
    }
  }
  
  return sku;
}

// Generate randomized browser-like headers
function getRandomizedHeaders() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:98.0) Gecko/20100101 Firefox/98.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 12_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.3 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36 Edg/99.0.1150.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36'
  ];
  
  const referers = [
    'https://www.google.com/search?q=pokemon+trading+cards',
    'https://www.google.com/search?q=target+pokemon+cards',
    'https://www.bing.com/search?q=buy+pokemon+cards',
    'https://www.facebook.com/',
    'https://www.reddit.com/r/PokemonTCG/'
  ];
  
  return {
    'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
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
    'Referer': referers[Math.floor(Math.random() * referers.length)]
  };
}

// Cookie management to avoid tracking
async function manageCookies() {
  const retailerDomains = [
    'target.com', 'www.target.com', '.target.com',
    'bestbuy.com', 'www.bestbuy.com', '.bestbuy.com'
  ];
  
  // Get all cookies for these domains
  for (const domain of retailerDomains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      
      // Remove each cookie
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
  
  console.log('Cleared cookies for retailer domains to maintain anonymity');
}

// Randomize which products get checked each cycle
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
      
      // Step 2: Now click the actual Add to Cart button
      const addToCartSelectors = [
        'button[data-test="shippingButton"]',
        'button[data-test="addToCartButton"]',
        'button[id*="addToCartButtonOrTextIdFor"]',
        'button.styles_ndsButtonPrimary__tqtKH[type="button"]',
        'button[aria-label*="Add to cart for"]'
      ];
      
      let buttonClicked = false;
      
      // Try to click the Add to Cart button
      for (const selector of addToCartSelectors) {
        const buttons = document.querySelectorAll(selector);
        console.log(`Found ${buttons.length} add to cart buttons with selector: ${selector}`);
        
        for (const button of buttons) {
          if (button && !button.disabled && button.offsetParent !== null) {
            // Make sure it has the right text and is not disabled
            const buttonText = button.textContent.trim().toLowerCase();
            if (buttonText.includes('add to cart') || buttonText.includes('add for shipping')) {
              console.log(`Clicking Add to Cart button: ${buttonText}`);
              button.click();
              buttonClicked = true;
              break;
            } else {
              console.log(`Button text doesn't match expected Add to Cart: ${buttonText}`);
            }
          }
        }
        
        if (buttonClicked) break;
      }
      
      // Fallback to simpler text content matching if needed
      if (!buttonClicked) {
        const allButtons = document.querySelectorAll('button');
        for (const button of allButtons) {
          if (button && !button.disabled && button.offsetParent !== null) {
            const buttonText = button.textContent.trim().toLowerCase();
            if (buttonText === 'add to cart' || 
                buttonText === 'add for shipping' || 
                buttonText.includes('add to cart for')) {
              console.log(`Found Add to Cart button by text: ${buttonText}`);
              button.click();
              buttonClicked = true;
              break;
            }
          }
        }
      }
      
      if (!buttonClicked) {
        console.error('Could not find Add to Cart button on Target page');
        resolve({ success: false, error: 'Could not find Add to Cart button' });
        return;
      }
      
      // Wait for the cart update
      console.log("Add to Cart button clicked, waiting for cart update...");
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

// Attempt to add Best Buy product to cart
async function addToCartBestBuy(product, directCartUrl, purchaseCount) {
  try {
    // Try to extract SKU from URL or product page
    let sku = extractBestBuySku(product.url);
    
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
    await new Promise(resolve => setTimeout(resolve, 3000));
    
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
      await new Promise(resolve => setTimeout(resolve, 2000));
      
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
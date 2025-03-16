// Generic stock check for other retailers
async function checkGenericStock(product) {
  try {
    // Create a browser tab to check the actual button state (most reliable)
    const { results, error } = await createAndUseTab(
      product.url, 
      3000, 
      checkButtonDisabledStateGeneric
    );
    
    if (error) {
      console.error(`Tab creation/operation error: ${error.message}`);
    } else if (results && results[0] && results[0].result) {
      console.log("Generic site button check results:", results[0].result);
      return results[0].result.inStock;
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
    
    // First add to cart
    let cartResult;
    if (isTarget) {
      cartResult = await addToCartTarget(product, product.addToCartUrl, purchaseCount);
    } else if (isBestBuy) {
      cartResult = await addToCartBestBuy(product, product.addToCartUrl, purchaseCount);
    } else {
      cartResult = await addToCartGeneric(product, product.addToCartUrl, purchaseCount);
    }
    
    // If adding to cart was successful, proceed with checkout
    if (cartResult && cartResult.success) {
      console.log("Product added to cart successfully, starting checkout process");
      
      // Get the tab ID from the cart result (or create a new tab if needed)
      let tabId;
      if (cartResult.tabId) {
        tabId = cartResult.tabId;
      } else {
        // We need to create a new tab to the cart page
        const cartUrl = isTarget ? 'https://www.target.com/cart' :
                       isBestBuy ? 'https://www.bestbuy.com/cart' : null;
        
        if (!cartUrl) {
          console.error("Cannot determine cart URL for checkout");
          return false;
        }
        
        const tab = await chrome.tabs.create({ url: cartUrl, active: true });
        tabId = tab.id;
        
        // Wait for the cart page to load
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Now proceed with checkout by running the appropriate checkout function
      let checkoutResult;
      if (isTarget) {
        checkoutResult = await chrome.scripting.executeScript({
          target: { tabId },
          func: performTargetCheckout
        });
      } else if (isBestBuy) {
        checkoutResult = await chrome.scripting.executeScript({
          target: { tabId },
          func: performBestBuyCheckout
        });
      } else {
        checkoutResult = await chrome.scripting.executeScript({
          target: { tabId },
          func: performGenericCheckout
        });
      }
      
      // Process checkout result
      if (checkoutResult && checkoutResult[0] && checkoutResult[0].result && checkoutResult[0].result.success) {
        console.log("Checkout process initiated successfully:", checkoutResult[0].result);
        
        // Increment purchase count only if we successfully got to checkout
        await chrome.storage.sync.set({ purchaseCount: purchaseCount + 1 });
        
        // Show notification to user that checkout is ready for final confirmation
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'images/icon128.png',
          title: 'Checkout Process Started!',
          message: `${product.name} is in your cart and checkout process has been started. Please review and confirm your order.`,
          priority: 2
        });
        
        return true;
      } else {
        console.error("Checkout process failed:", checkoutResult?.[0]?.result?.error || "unknown error");
        return false;
      }
    } else {
      console.error("Failed to add product to cart:", cartResult?.error || "unknown error");
      return false;
    }
  } catch (error) {
    console.error('Checkout process failed:', error);
    return false;
  }
}

// Target add to cart function
async function addToCartTarget(product, directCartUrl, purchaseCount) {
  if (tabOperationInProgress) {
    console.log("Another tab operation in progress, deferring add to cart");
    return { success: false, error: "Another tab operation in progress" };
  }
  
  tabOperationInProgress = true;
  let tab = null;
  
  try {
    // First check if we have a direct cart URL
    if (directCartUrl && directCartUrl.length > 0) {
      try {
        // Create a new tab with the direct add to cart URL
        tab = await chrome.tabs.create({ url: directCartUrl, active: true });
        
        // Watch for navigation to cart page
        const cartPromise = new Promise((resolve) => {
          function cartListener(tabId, changeInfo) {
            if (tabId === tab.id && changeInfo.url && changeInfo.url.includes('target.com/cart')) {
              chrome.tabs.onUpdated.removeListener(cartListener);
              resolve(true);
            }
          }
          
          chrome.tabs.onUpdated.addListener(cartListener);
          
          // Set a timeout in case we never navigate to cart
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(cartListener);
            resolve(false);
          }, 10000);
        });
        
        const cartSuccess = await cartPromise;
        
        if (cartSuccess) {
          tabOperationInProgress = false;
          return { success: true, method: 'directUrl', tabId: tab.id };
        }
      } catch (error) {
        console.error('Direct URL failed for Target:', error);
      }
    }
    
    // Try to extract TCIN from product URL
    let tcin = '';
    if (product.url.includes('/A-')) {
      const parts = product.url.split('/A-');
      if (parts.length > 1) {
        tcin = parts[1].split('?')[0].split('#')[0];
      }
    }
    
    // Fallback to browser automation
    tab = await chrome.tabs.create({ url: product.url, active: true });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Execute the add to cart script specific to Target
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: performTargetAddToCart,
      args: [tcin]
    });
    
    return { 
      success: results[0]?.result?.success || false, 
      tabId: tab.id, 
      ...(results[0]?.result || {}) 
    };
  } catch (error) {
    console.error('Target add to cart failed:', error);
    return { success: false, error: error.message };
  } finally {
    tabOperationInProgress = false;
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

// Best Buy add to cart function
async function addToCartBestBuy(product, directCartUrl, purchaseCount) {
  if (tabOperationInProgress) {
    console.log("Another tab operation in progress, deferring add to cart");
    return { success: false, error: "Another tab operation in progress" };
  }
  
  tabOperationInProgress = true;
  let tab = null;
  
  try {
    // Try to extract SKU from URL or product page
    let sku = extractBestBuySku(product.url);
    
    // If we have a direct add to cart URL, use it
    if (directCartUrl && directCartUrl.length > 0) {
      // Create a new tab with the direct add to cart URL
      tab = await chrome.tabs.create({ url: directCartUrl, active: true });
      
      // Watch for navigation to cart page, then consider it a success
      const cartPromise = new Promise((resolve) => {
        function cartListener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.url && changeInfo.url.includes('bestbuy.com/cart')) {
            chrome.tabs.onUpdated.removeListener(cartListener);
            resolve(true);
          }
        }
        
                  chrome.tabs.onUpdated.addListener(cartListener);
        
        // Set a timeout in case we never navigate to cart
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(cartListener);
          resolve(false);
        }, 10000);
      });
      
      const cartSuccess = await cartPromise;
      
      if (cartSuccess) {
        return { success: true, method: 'directUrl', tabId: tab.id };
      }
    }
    
    // Otherwise try generic add to cart
    tab = await chrome.tabs.create({ url: product.url, active: true });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    // Execute the add to cart script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: performGenericAddToCart
    });
    
    return { 
      success: results[0]?.result?.success || false, 
      tabId: tab.id, 
      ...(results[0]?.result || {}) 
    };
  } catch (error) {
    console.error('Generic add to cart failed:', error);
    return { success: false, error: error.message };
  } finally {
    tabOperationInProgress = false;
  }
}removeListener(cartListener);
          resolve(false);
        }, 10000);
      });
      
      const cartSuccess = await cartPromise;
      
      if (cartSuccess) {
        return { success: true, method: 'directUrl', tabId: tab.id };
      }
    }
    
    // Otherwise use the regular product page
    // Create a new tab to perform the add to cart action
    tab = await chrome.tabs.create({ url: product.url, active: true });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Execute the add to cart script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: performBestBuyAddToCart,
      args: [sku]
    });
    
    return { 
      success: results[0]?.result?.success || false, 
      tabId: tab.id, 
      ...(results[0]?.result || {}) 
    };
  } catch (error) {
    console.error('Best Buy add to cart failed:', error);
    return { success: false, error: error.message };
  } finally {
    tabOperationInProgress = false;
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

// Generic add to cart function
async function addToCartGeneric(product, directCartUrl, purchaseCount) {
  if (tabOperationInProgress) {
    console.log("Another tab operation in progress, deferring add to cart");
    return { success: false, error: "Another tab operation in progress" };
  }
  
  tabOperationInProgress = true;
  let tab = null;
  
  try {
    // If we have a direct URL, use it
    if (directCartUrl && directCartUrl.length > 0) {
      tab = await chrome.tabs.create({ url: directCartUrl, active: true });
      
      // Watch for navigation to cart page
      const cartPromise = new Promise((resolve) => {
        function cartListener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.url && changeInfo.url.includes('cart')) {
            chrome.tabs.onUpdated.removeListener(cartListener);
            resolve(true);
          }
        }
        
        chrome.tabs.onUpdated.addListener(cartListener);
        
        // Set a timeout in case we never navigate to cart
        setTimeout(() => {
          chrome.tabs.onUpdated.// Global variables
let monitoredProducts = [];
let isMonitoring = false;
let checkoutInProgress = false;
let stockStatus = {}; // Track stock status for each product
let activeChecks = 0; // Track how many stock checks are currently running
const MAX_CONCURRENT_CHECKS = 3; // Limit concurrent tab operations
let checkQueue = []; // Queue for pending stock checks
let tabOperationInProgress = false; // Flag to prevent overlapping tab operations

// Add startup and install listeners to ensure the extension is ready
chrome.runtime.onStartup.addListener(() => {
  console.log("Extension started up");
});

// Initialize when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed/updated");
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
  
  // Reset queue and add new checks
  checkQueue = [];
  
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
  
  // Add all products to check queue with random delay to stagger them
  for (const product of productsToCheck) {
    // Skip some checks randomly (about 10% of the time)
    if (Math.random() < 0.1) {
      console.log(`Randomly skipping check for ${product.name} to appear more human-like`);
      continue;
    }
    
    // Calculate a staggered delay for this product
    const staggerDelay = Math.floor(Math.random() * 5000) + 2000; // 2-7 seconds between products
    
    // Add to queue with delay info
    checkQueue.push({
      product,
      delay: staggerDelay
    });
  }
  
  // Start processing the queue if not already processing
  processCheckQueue();
}

// Process the check queue with throttling
async function processCheckQueue() {
  // If no items in queue or already at max concurrent checks, do nothing
  if (checkQueue.length === 0 || activeChecks >= MAX_CONCURRENT_CHECKS) {
    return;
  }
  
  // Get the next item from the queue
  const checkItem = checkQueue.shift();
  activeChecks++;
  
  // Wait for the specified delay before checking
  await new Promise(resolve => setTimeout(resolve, checkItem.delay));
  
  try {
    // Check stock for this product
    const inStock = await checkProductStock(checkItem.product);
    
    // Update stock status
    const previousStatus = stockStatus[checkItem.product.url];
    stockStatus[checkItem.product.url] = {
      inStock: inStock,
      lastChecked: new Date().toLocaleString(),
      product: checkItem.product,
      // Track when it was last in stock
      lastInStock: inStock ? new Date().toLocaleString() : (previousStatus?.lastInStock || null)
    };
    
    // If status changed to in stock, notify
    if (inStock && (!previousStatus || !previousStatus.inStock)) {
      notifyStockAvailable(checkItem.product);
      
      if (checkItem.product.autoCheckout) {
        checkoutInProgress = true;
        await attemptCheckout(checkItem.product);
        checkoutInProgress = false;
      }
    }
  } catch (error) {
    console.error(`Error checking stock for ${checkItem.product.url}:`, error);
  } finally {
    // Decrement active checks counter
    activeChecks--;
    
    // Broadcast stock status update to popup if open
    try {
      chrome.runtime.sendMessage({
        action: 'stockStatusUpdate',
        stockStatus: stockStatus
      });
    } catch (e) {
      console.log("Error sending stockStatusUpdate message:", e);
    }
    
    // Continue processing the queue
    processCheckQueue();
  }
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

// Improved tab management function
async function createAndUseTab(url, timeoutMs = 4000, scriptFunc, scriptArgs = []) {
  // Wait if another tab operation is in progress
  if (tabOperationInProgress) {
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!tabOperationInProgress) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
    });
  }
  
  tabOperationInProgress = true;
  let tab = null;
  
  try {
    // Create a hidden tab
    tab = await chrome.tabs.create({ 
      url: url, 
      active: false // Keep it in background
    });
    
    // Wait for the page to load properly
    await new Promise(resolve => setTimeout(resolve, timeoutMs));
    
    // Run the script in the context of the page
    let results = null;
    if (scriptFunc) {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scriptFunc,
        args: scriptArgs
      });
    }
    
    return { tab, results };
  } catch (error) {
    console.error(`Error during tab operation: ${error.message}`);
    return { tab, results: null, error };
  } finally {
    // Clean up the tab
    if (tab) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (removeError) {
        console.error("Error removing tab:", removeError);
      }
    }
    
    // Release the lock
    tabOperationInProgress = false;
  }
}

// The most reliable way to check Target stock - look for specific visual elements
async function checkTargetStock(product) {
  try {
    console.log(`Checking stock for: ${product.url}`);
    
    // Use the shared tab management function
    const { results, error } = await createAndUseTab(
      product.url, 
      4000, 
      simpleTargetStockCheck
    );
    
    if (error) {
      console.error(`Tab creation/operation error: ${error.message}`);
      return false;
    }
    
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

// Complete checkout process for Target
function performTargetCheckout() {
  return new Promise(async (resolve) => {
    try {
      console.log("Starting Target checkout process");
      
      // First check if we're on the cart page, if not, navigate there
      if (!window.location.href.includes('target.com/cart')) {
        window.location.href = 'https://www.target.com/cart';
        // Wait for navigation
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // 1. Click the main checkout button from cart page
      const checkoutButtonSelectors = [
        'button[data-test="checkout-button"]',
        'button.styles__BaseButton-sc-1f2lsll-0',
        'button:contains("Check out")',
        'button:contains("Checkout")'
      ];
      
      let checkoutButtonClicked = false;
      
      for (const selector of checkoutButtonSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button && !button.disabled && button.offsetParent !== null && 
              (button.textContent.toLowerCase().includes('check out') || 
               button.textContent.toLowerCase().includes('checkout'))) {
            console.log("Clicking main checkout button");
            button.click();
            checkoutButtonClicked = true;
            break;
          }
        }
        if (checkoutButtonClicked) break;
      }
      
      if (!checkoutButtonClicked) {
        // Try a more general selector
        const allButtons = document.querySelectorAll('button');
        for (const button of allButtons) {
          if (button && !button.disabled && button.offsetParent !== null &&
              (button.textContent.toLowerCase().includes('check out') || 
               button.textContent.toLowerCase().includes('checkout'))) {
            console.log("Clicking checkout button (fallback method)");
            button.click();
            checkoutButtonClicked = true;
            break;
          }
        }
      }
      
      if (!checkoutButtonClicked) {
        console.error("Could not find checkout button");
        resolve({ success: false, error: "Could not find checkout button" });
        return;
      }
      
      // Wait for shipping page to load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // 2. Check if we need to handle guest checkout
      const guestCheckoutSelectors = [
        'button[data-test="guestCheckoutButton"]',
        'button:contains("Continue as guest")'
      ];
      
      let guestButtonClicked = false;
      
      for (const selector of guestCheckoutSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button && !button.disabled && button.offsetParent !== null) {
            console.log("Clicking guest checkout button");
            button.click();
            guestButtonClicked = true;
            break;
          }
        }
        if (guestButtonClicked) break;
      }
      
      // If we found and clicked the guest checkout button, wait for the next page
      if (guestButtonClicked) {
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
      
      // 3. Wait for shipping information page (browser autofill should kick in here)
      console.log("On shipping/payment page - browser autofill should activate");
      
      // Give browser time to autofill shipping/payment info
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // 4. Check for "Continue to payment" button if we're on the shipping page
      const continueToPaymentSelectors = [
        'button[data-test="fulfillmentContinueButton"]',
        'button:contains("Continue to payment")'
      ];
      
      let continueToPaymentClicked = false;
      
      for (const selector of continueToPaymentSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button && !button.disabled && button.offsetParent !== null) {
            console.log("Clicking continue to payment button");
            button.click();
            continueToPaymentClicked = true;
            break;
          }
        }
        if (continueToPaymentClicked) break;
      }
      
      // If we clicked continue to payment, wait for payment page
      if (continueToPaymentClicked) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // 5. Look for place order button (final step)
      const placeOrderSelectors = [
        'button[data-test="placeOrderButton"]',
        'button:contains("Place order")'
      ];
      
      // We won't auto-click the final place order button, just make it visible and ready
      let foundPlaceOrderButton = false;
      
      for (const selector of placeOrderSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button && button.offsetParent !== null) {
            console.log("Found place order button - ready for user confirmation");
            // Scroll to the button to make it visible
            button.scrollIntoView({ behavior: "smooth", block: "center" });
            foundPlaceOrderButton = true;
            break;
          }
        }
        if (foundPlaceOrderButton) break;
      }
      
      resolve({ 
        success: true, 
        completedCheckout: false, 
        message: "Checkout process advanced to payment/review. Final confirmation requires user action."
      });
      
    } catch (error) {
      console.error("Target checkout process failed:", error);
      resolve({ success: false, error: error.message });
    }
  });
}

// Improved Best Buy stock checking
async function checkBestBuyStock(product) {
  try {
    console.log(`Checking stock for Best Buy: ${product.url}`);
    
    // Use the shared tab management function
    const { results, error } = await createAndUseTab(
      product.url, 
      4000, 
      checkButtonDisabledStateBestBuy
    );
    
    if (error) {
      console.error(`Tab creation/operation error: ${error.message}`);
      return false;
    }
    
    if (results && results[0] && results[0].result) {
      console.log("Best Buy stock check results:", results[0].result);
      return results[0].result.inStock;
    }
    
    return false;
  } catch (error) {
    console.error(`Error checking Best Buy stock for ${product.url}:`, error);
    return false;
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

// Complete checkout process for Best Buy
function performBestBuyCheckout() {
  return new Promise(async (resolve) => {
    try {
      console.log("Starting Best Buy checkout process");
      
      // First check if we're on the cart page, if not, navigate there
      if (!window.location.href.includes('bestbuy.com/cart')) {
        window.location.href = 'https://www.bestbuy.com/cart';
        // Wait for navigation
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // 1. Look for and click the checkout button
      const checkoutButtonSelectors = [
        'button.checkout-buttons__checkout',
        'button[data-track="Checkout - Top"]',
        'a.btn-secondary[href*="checkout"]',
        'button:contains("Checkout")'
      ];
      
      let checkoutButtonClicked = false;
      
      for (const selector of checkoutButtonSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button && !button.disabled && button.offsetParent !== null) {
            console.log("Clicking checkout button");
            button.click();
            checkoutButtonClicked = true;
            break;
          }
        }
        if (checkoutButtonClicked) break;
      }
      
      if (!checkoutButtonClicked) {
        // Try looking for any button with "Checkout" text
        const allButtons = document.querySelectorAll('button');
        for (const button of allButtons) {
          if (button && !button.disabled && button.offsetParent !== null && 
              button.textContent.toLowerCase().includes('checkout')) {
            console.log("Clicking checkout button (fallback method)");
            button.click();
            checkoutButtonClicked = true;
            break;
          }
        }
      }
      
      if (!checkoutButtonClicked) {
        console.error("Could not find checkout button");
        resolve({ success: false, error: "Could not find checkout button" });
        return;
      }
      
      // 2. Wait for the next page to load (could be sign-in or continue as guest)
      await new Promise(resolve => setTimeout(resolve, 3500));
      
      // 3. Check for "Continue as Guest" button
      const guestCheckoutSelectors = [
        'button[data-track="Continue as Guest"]',
        'a.guest-button',
        'button:contains("Continue as Guest")'
      ];
      
      let guestButtonClicked = false;
      
      for (const selector of guestCheckoutSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button && !button.disabled && button.offsetParent !== null) {
            console.log("Clicking continue as guest button");
            button.click();
            guestButtonClicked = true;
            break;
          }
        }
        if (guestButtonClicked) break;
      }
      
      // If we clicked guest checkout, wait for the next page
      if (guestButtonClicked) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // 4. Wait for shipping/payment page (browser autofill should kick in)
      console.log("On shipping/payment page - browser autofill should activate");
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // 5. Look for continue buttons to advance through the checkout process
      const continueButtonSelectors = [
        'button.button__fast-track',
        'button[data-track="Shipping - Continue to Payment Information"]',
        'button[data-track="Continue to Payment Information"]',
        'button:contains("Continue")',
        'button:contains("Next")'
      ];
      
      // Try to click any available continue buttons to advance
      for (const selector of continueButtonSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button && !button.disabled && button.offsetParent !== null) {
            console.log(`Clicking continue button: ${button.textContent}`);
            button.click();
            // Wait after clicking continue
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      }
      
      // 6. Look for place order button (final step)
      const placeOrderSelectors = [
        'button[data-track="Place your Order"]',
        'button.button__place-order',
        'button:contains("Place Order")',
        'button:contains("Place your Order")'
      ];
      
      // We won't auto-click the final place order button, just make it visible
      let foundPlaceOrderButton = false;
      
      for (const selector of placeOrderSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button && button.offsetParent !== null) {
            console.log("Found place order button - ready for user confirmation");
            // Scroll to the button to make it visible
            button.scrollIntoView({ behavior: "smooth", block: "center" });
            foundPlaceOrderButton = true;
            break;
          }
        }
        if (foundPlaceOrderButton) break;
      }
      
      resolve({ 
        success: true, 
        completedCheckout: false, 
        message: "Checkout process advanced to payment/review. Final confirmation requires user action."
      });
      
    } catch (error) {
      console.error("Best Buy checkout process failed:", error);
      resolve({ success: false, error: error.message });
    }
  });
}

// Generic checkout process for other retailers
function performGenericCheckout() {
  return new Promise(async (resolve) => {
    try {
      console.log("Starting generic checkout process");
      
      // 1. Look for and click the checkout button
      const checkoutButtonSelectors = [
        'a[href*="checkout"]',
        'button:contains("Checkout")',
        'button:contains("Check out")',
        'button:contains("Proceed to Checkout")',
        'input[value*="Check"]',
        'button[class*="checkout"]'
      ];
      
      let checkoutButtonClicked = false;
      
      for (const selector of checkoutButtonSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (element && !element.disabled && element.offsetParent !== null) {
            console.log(`Clicking checkout button: ${element.textContent || element.value}`);
            element.click();
            checkoutButtonClicked = true;
            break;
          }
        }
        if (checkoutButtonClicked) break;
      }
      
      if (!checkoutButtonClicked) {
        // Try a more general approach - look for buttons/links with checkout-related text
        const allButtons = document.querySelectorAll('button, a.button, input[type="submit"]');
        const checkoutTexts = ['checkout', 'check out', 'proceed to', 'place order'];
        
        for (const button of allButtons) {
          const buttonText = (button.textContent || button.value || '').toLowerCase();
          if (button && !button.disabled && button.offsetParent !== null && 
              checkoutTexts.some(text => buttonText.includes(text))) {
            console.log(`Clicking checkout button (fallback): ${buttonText}`);
            button.click();
            checkoutButtonClicked = true;
            break;
          }
        }
      }
      
      if (!checkoutButtonClicked) {
        console.log("Could not find checkout button");
        resolve({ success: false, error: "Could not find checkout button" });
        return;
      }
      
      // 2. Wait for the next page to load
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      // 3. Look for guest checkout option if available
      const guestCheckoutSelectors = [
        'button:contains("Guest")',
        'a:contains("Guest Checkout")',
        'button:contains("Continue as Guest")',
        'a:contains("Continue as Guest")'
      ];
      
      let guestButtonClicked = false;
      
      for (const selector of guestCheckoutSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (element && !element.disabled && element.offsetParent !== null) {
            console.log(`Clicking guest checkout: ${element.textContent}`);
            element.click();
            guestButtonClicked = true;
            break;
          }
        }
        if (guestButtonClicked) break;
      }
      
      // If we clicked guest checkout, wait for the next page
      if (guestButtonClicked) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // 4. Wait for shipping/payment forms (browser autofill should kick in)
      console.log("On shipping/payment page - browser autofill should activate");
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // 5. Look for continue buttons to advance through the checkout flow
      const continueButtonSelectors = [
        'button:contains("Continue")',
        'button:contains("Next")',
        'button:contains("Proceed")',
        'input[value*="Continue"]',
        'input[value*="Next"]'
      ];
      
      // Try to click any available continue buttons to advance
      for (const selector of continueButtonSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (element && !element.disabled && element.offsetParent !== null) {
            console.log(`Clicking continue button: ${element.textContent || element.value}`);
            element.click();
            // Wait after clicking continue
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      }
      
      // 6. Look for place order button (final step)
      const placeOrderSelectors = [
        'button:contains("Place Order")',
        'button:contains("Complete Order")',
        'button:contains("Submit Order")',
        'input[value*="Place Order"]',
        'button[class*="place-order"]'
      ];
      
      // We won't auto-click the final place order button, just make it visible
      let foundPlaceOrderButton = false;
      
      for (const selector of placeOrderSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (element && element.offsetParent !== null) {
            console.log("Found place order button - ready for user confirmation");
            // Scroll to the button to make it visible
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            foundPlaceOrderButton = true;
            break;
          }
        }
        if (foundPlaceOrderButton) break;
      }
      
      resolve({ 
        success: true, 
        completedCheckout: false, 
        message: "Checkout process advanced as far as possible. Final confirmation requires user action."
      });
      
    } catch (error) {
      console.error("Generic checkout process failed:", error);
      resolve({ success: false, error: error.message });
    }
  });
}
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
    // Try to extract the TCIN (Target's product ID)
    let tcin = '';
    
    // Extract TCIN from URL
    if (product.url.includes('/A-')) {
      const parts = product.url.split('/A-');
      if (parts.length > 1) {
        tcin = parts[1].split('?')[0].split('#')[0];
      }
    }
    
    // If we found a TCIN, use the API directly (much faster)
    if (tcin && /^\d+$/.test(tcin)) {
      console.log(`Using Target API for TCIN: ${tcin}`);
      
      // Get store ID if we have it stored (for pickup availability)
      const storeInfo = await chrome.storage.sync.get(['targetStoreId']);
      const storeId = storeInfo.targetStoreId || '';
      
      // API endpoints to check
      const apis = [
        `https://www.target.com/api/web_platform/product_fulfillment/v1/${tcin}?key=feee1e2d7f9aabd4e1b9604359f7c52e&nearby=${storeId}&inventory_type=all&zip=`,
        `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=feee1e2d7f9aabd4e1b9604359f7c52e&tcin=${tcin}&pricing_store_id=${storeId}`
      ];
      
      // Try each API endpoint
      for (let i = 0; i < apis.length; i++) {
        try {
          const response = await fetch(apis[i], {
            headers: { 'Accept': 'application/json' }
          });
          
          if (response.ok) {
            const data = await response.json();
            
            // First API format (fulfillment)
            if (data.fulfillment) {
              // Check if shipping available
              const shipping = data.fulfillment.shipping;
              if (shipping && shipping.available) {
                return true;
              }
              
              // Check if store pickup available
              const pickup = data.fulfillment.store_options;
              if (pickup && pickup.length > 0 && pickup.some(store => store.in_store_only === false)) {
                return true;
              }
            }
            
            // Second API format (redsky)
            if (data.data && data.data.product) {
              const product = data.data.product;
              
              // Check for available_to_promise info
              if (product.fulfillment && product.fulfillment.shipping_options && 
                  product.fulfillment.shipping_options.available_to_promise && 
                  product.fulfillment.shipping_options.available_to_promise.availability !== "OUT_OF_STOCK") {
                return true;
              }
              
              // Check button state
              if (product.button_state && product.button_state !== "OUT_OF_STOCK" && 
                  product.button_state !== "SOLD_OUT") {
                return true;
              }
            }
          }
        } catch (apiError) {
          console.error(`Target API error for endpoint ${i}:`, apiError);
        }
      }
    }
    
    // Fallback to direct page check
    const response = await fetch(product.url, {
      headers: { 'Cache-Control': 'no-cache' }
    });
    
    if (!response.ok) return false;
    
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
      'data-test="oosDeliveryOption"'
    ];
    
    // Check if any in-stock indicators are present
    const isInStock = inStockIndicators.some(indicator => 
      text.toLowerCase().includes(indicator.toLowerCase()));
    
    // Check if any out-of-stock indicators are present
    const isOutOfStock = outOfStockIndicators.some(indicator => 
      text.toLowerCase().includes(indicator.toLowerCase()));
    
    // If in-stock indicators are present and out-of-stock indicators are not, consider it in stock
    return isInStock && !isOutOfStock;
  } catch (error) {
    console.error(`Error checking Target stock for ${product.url}:`, error);
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
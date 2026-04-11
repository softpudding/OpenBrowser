window.tracker = new AgentTracker("amazon.com", "hard");

(function () {
  const { createSeededStore, escapeHtml, formatCurrency } = window.HardMockSite;

  function createProduct(config) {
    return {
      id: config.id,
      title: config.title,
      queryTerms: config.queryTerms,
      brand: config.brand,
      sponsored: Boolean(config.sponsored),
      variants: config.variants || {},
      offers: config.offers || [],
      autoAccessoryId: config.autoAccessoryId || null,
      description: config.description,
      price: config.price,
    };
  }

  function buildSeedState() {
    const products = [
      createProduct({
        id: "product-aurora-trail-shell",
        title: "Aurora Trail Shell Jacket",
        queryTerms: ["trail shell", "rain shell", "aurora shell"],
        brand: "Aurora Ridge",
        sponsored: false,
        price: 189,
        description: "Lightweight weather shell with color and size variants.",
        autoAccessoryId: "acc-rain-care-kit",
        variants: {
          color: ["Canyon Red", "Glacier Blue", "Ink"],
          size: ["S", "M", "L"],
        },
        offers: [
          { id: "offer-aurora-default", seller: "Aurora Ridge", condition: "New", delivery: "Arrives tomorrow", price: 189 },
        ],
      }),
      createProduct({
        id: "product-aurora-trail-shell-sponsored",
        title: "Aurora Trail Shells Clearance Bundle",
        queryTerms: ["trail shell", "rain shell"],
        brand: "Aurora Outlet",
        sponsored: true,
        price: 164,
        description: "Sponsored decoy listing with bundle accessories.",
        variants: {
          color: ["Canyon Red"],
          size: ["M"],
        },
        offers: [
          { id: "offer-aurora-sponsored", seller: "Aurora Outlet", condition: "New", delivery: "Arrives next week", price: 164 },
        ],
      }),
      createProduct({
        id: "product-orbit-carry-on-spinner",
        title: "Orbit Carry-On Spinner 20",
        queryTerms: ["carry on spinner", "orbit luggage", "spinner"],
        brand: "Orbit Line",
        sponsored: false,
        price: 134,
        description: "Hard-shell carry-on with color variants.",
        autoAccessoryId: "acc-packing-cubes-mini",
        variants: {
          color: ["Graphite", "Clay", "Midnight"],
          size: ["20"],
        },
        offers: [
          { id: "offer-orbit-default", seller: "Orbit Line", condition: "New", delivery: "Arrives in 2 days", price: 134 },
        ],
      }),
      createProduct({
        id: "product-north-lake-monitor-16",
        title: "North Lake Portable Monitor 16",
        queryTerms: ["portable monitor", "north lake monitor", "monitor 16"],
        brand: "North Lake",
        sponsored: false,
        price: 259,
        description: "Portable monitor with multiple seller offers and delivery differences.",
        variants: {
          finish: ["Matte Black", "Silver"],
          size: ["16"],
        },
        offers: [
          { id: "offer-monitor-harbor-tech-new", seller: "Harbor Tech", condition: "New", delivery: "Arrives tomorrow to Office Loft", price: 259 },
          { id: "offer-monitor-harbor-tech-used", seller: "Harbor Tech", condition: "Used - Like New", delivery: "Arrives in 4 days", price: 219 },
          { id: "offer-monitor-lumen-direct", seller: "Lumen Direct", condition: "New", delivery: "Arrives in 5 days", price: 248 },
        ],
      }),
    ];

    for (let index = 1; index <= 28; index += 1) {
      products.push(
        createProduct({
          id: `product-seeded-${index}`,
          title: `Seeded Product ${index}`,
          queryTerms: ["outdoor", "daily use"],
          brand: index % 2 ? "Seeded Goods" : "Metro Supply",
          sponsored: index % 7 === 0,
          price: 39 + index,
          description: "Seeded result card for dense search pages.",
          variants: {
            style: ["Standard"],
          },
          offers: [
            { id: `offer-seeded-${index}`, seller: "Marketplace", condition: "New", delivery: "Arrives later this week", price: 39 + index },
          ],
        }),
      );
    }

    return {
      products,
      ui: {
        surface: "home",
        searchQuery: "",
      },
      filters: {
        brand: "",
        sponsoredOnly: false,
      },
      sort: "featured",
      selectedProductId: null,
      selectedVariant: {},
      selectedOfferId: "",
      offersOpen: false,
      cart: {
        items: [],
        saved: [],
        removedAccessoryIds: [],
      },
      checkout: {
        addressId: "",
        shippingOptionId: "",
        paymentId: "",
        checkoutPath: "",
      },
      confirmation: null,
    };
  }

  const store = createSeededStore({
    storageKey: "openbrowser.eval.amazon",
    seedState: buildSeedState(),
  });

  const ADDRESSES = [
    { id: "address-office-loft", label: "Office Loft", promise: "Next-day locker delivery" },
    { id: "address-warehouse-annex", label: "Warehouse Annex", promise: "Two-day dock delivery" },
  ];

  const PAYMENTS = [
    { id: "payment-visa-4242", label: "Visa ending 4242" },
    { id: "payment-amex-1100", label: "Amex ending 1100" },
  ];

  const ACCESSORIES = {
    "acc-rain-care-kit": "Rain Care Kit",
    "acc-packing-cubes-mini": "Packing Cubes Mini",
  };

  const app = document.getElementById("app");

  function getProduct(state, productId) {
    return state.products.find((product) => product.id === productId) || null;
  }

  function getCurrentProduct(state) {
    return getProduct(state, state.selectedProductId);
  }

  function getSearchResults(state) {
    return state.products
      .filter((product) => {
        const query = state.ui.searchQuery.trim().toLowerCase();
        if (!query) {
          return false;
        }
        const matchesQuery = `${product.title} ${product.queryTerms.join(" ")}`.toLowerCase().includes(query);
        if (!matchesQuery) {
          return false;
        }
        if (state.filters.brand && product.brand !== state.filters.brand) {
          return false;
        }
        if (state.filters.sponsoredOnly && !product.sponsored) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (state.sort === "price-asc") {
          return left.price - right.price;
        }
        return Number(right.sponsored) - Number(left.sponsored);
      });
  }

  function getSelectedVariantId(state, product) {
    if (!product) {
      return "";
    }
    const parts = [];
    Object.keys(product.variants).forEach((key) => {
      const value = state.selectedVariant[key];
      if (value) {
        parts.push(value.toLowerCase().replace(/\s+/g, "-"));
      }
    });
    return parts.join("__");
  }

  function renderTopbar(state) {
    return `
      <header class="mock-topbar">
        <div class="amazon-topbar">
          <div class="amazon-brand">
            <div class="amazon-brand-mark">A</div>
            <div>
              <div>Retail Mock</div>
              <div class="mock-subtle">Search noise, variant state, offers, cart recovery</div>
            </div>
          </div>
          <div class="mock-subtle">The correct product may be hidden behind sponsored cards, the default variant can be wrong, and the safest checkout path is not always the most obvious button.</div>
          <div style="display: flex; gap: 10px;">
            <span class="mock-pill">30+ products</span>
            <button class="mock-btn-secondary" data-action="open-cart">Cart (${state.cart.items.length})</button>
          </div>
        </div>
      </header>
    `;
  }

  function renderHome(state) {
    return `
      <section class="amazon-search-card mock-card">
        <div>
          <p class="mock-kicker">Search retail</p>
          <h1 class="mock-title">Dense retail search with offers, cart recovery, and checkout state.</h1>
        </div>
        <div class="amazon-search-row">
          <div>
            <label class="mock-kicker" for="amazon-search-input">Search</label>
            <input id="amazon-search-input" class="mock-input" value="${escapeHtml(state.ui.searchQuery)}" placeholder="Search products">
          </div>
          <button class="mock-btn-secondary" data-action="set-search-query" data-query="trail shell">Trail shell</button>
          <button class="mock-btn" data-action="search-submit">Search</button>
        </div>
      </section>
    `;
  }

  function renderResultCard(product) {
    return `
      <article class="amazon-result-card">
        <div class="amazon-result-head">
          <div>
            <div class="amazon-result-title">${escapeHtml(product.title)}</div>
            <div class="amazon-meta">
              ${product.sponsored ? '<span class="mock-badge">Sponsored</span>' : ""}
              <span class="mock-badge">${escapeHtml(product.brand)}</span>
              <span class="mock-badge">${formatCurrency(product.price, "$")}</span>
            </div>
            <div class="mock-subtle">${escapeHtml(product.description)}</div>
          </div>
          <div class="amazon-actions">
            <button class="mock-btn" data-action="open-product" data-product-id="${product.id}">Open product</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderResults(state) {
    const results = getSearchResults(state);
    return `
      <div class="amazon-layout">
        <aside class="amazon-sidebar mock-card mock-sticky-panel">
          <div>
            <p class="mock-kicker">Filters</p>
            <label class="mock-kicker" for="amazon-brand-filter">Brand</label>
            <select id="amazon-brand-filter" class="mock-select">
              <option value="">Any</option>
              <option value="Aurora Ridge" ${state.filters.brand === "Aurora Ridge" ? "selected" : ""}>Aurora Ridge</option>
              <option value="Orbit Line" ${state.filters.brand === "Orbit Line" ? "selected" : ""}>Orbit Line</option>
              <option value="North Lake" ${state.filters.brand === "North Lake" ? "selected" : ""}>North Lake</option>
            </select>
          </div>
          <label class="mock-pill" style="justify-content: flex-start;">
            <input type="checkbox" id="amazon-sponsored-filter" ${state.filters.sponsoredOnly ? "checked" : ""}>
            Sponsored only
          </label>
        </aside>
        <section class="amazon-results mock-card">
          <div class="amazon-actions" style="justify-content: space-between; margin-bottom: 14px;">
            <div>
              <p class="mock-kicker">Results</p>
              <h2 class="mock-title">${results.length} products</h2>
            </div>
            <div class="amazon-actions">
              <select id="amazon-sort" class="mock-select">
                <option value="featured" ${state.sort === "featured" ? "selected" : ""}>Featured</option>
                <option value="price-asc" ${state.sort === "price-asc" ? "selected" : ""}>Price: Low to High</option>
              </select>
            </div>
          </div>
          <div class="amazon-result-list">
            ${results.map((product) => renderResultCard(product)).join("")}
          </div>
        </section>
      </div>
    `;
  }

  function renderProduct(state) {
    const product = getCurrentProduct(state);
    if (!product) {
      return renderResults(state);
    }

    const hasExplicitOfferSelection = Boolean(state.selectedOfferId);
    const variantId = getSelectedVariantId(state, product);
    const selectedOffer = product.offers.find((offer) => offer.id === state.selectedOfferId) || product.offers[0];

    return `
      <section class="amazon-product mock-card">
        <div class="amazon-product-layout">
          <div class="amazon-product-card">
            <div class="amazon-product-title">${escapeHtml(product.title)}</div>
            <div class="amazon-meta">
              <span class="mock-badge">${escapeHtml(product.brand)}</span>
              <span class="mock-badge">${formatCurrency(product.price, "$")}</span>
            </div>
            <div class="mock-subtle">${escapeHtml(product.description)}</div>
            ${Object.entries(product.variants)
              .map(
                ([key, values]) => `
                  <div>
                    <p class="mock-kicker">${escapeHtml(key)}</p>
                    <div class="amazon-variant-grid">
                      ${values
                        .map(
                          (value) => `
                            <button class="mock-btn-secondary amazon-variant-button ${state.selectedVariant[key] === value ? "active" : ""}" data-action="select-variant" data-variant-key="${key}" data-variant-value="${value}">
                              ${escapeHtml(value)}
                            </button>
                          `,
                        )
                        .join("")}
                    </div>
                  </div>
                `,
              )
              .join("")}
            <div class="amazon-actions">
              <button class="mock-btn-secondary" data-action="open-offers">See all offers</button>
            </div>
            ${
              state.offersOpen
                ? `
                  <div class="amazon-offer-list">
                    ${product.offers
                      .map(
                        (offer) => {
                          const isSelected = state.selectedOfferId === offer.id;
                          return `
                          <article class="amazon-offer-card ${isSelected ? "selected" : ""}">
                            <div><strong>${escapeHtml(offer.seller)}</strong> · ${escapeHtml(offer.condition)}</div>
                            <div class="mock-subtle">${escapeHtml(offer.delivery)}</div>
                            ${isSelected ? '<div class="amazon-offer-selected">Selected offer</div>' : ""}
                            <div class="amazon-actions">
                              <button class="${isSelected ? "mock-btn" : "mock-btn-secondary"}" data-action="select-offer" data-offer-id="${offer.id}">${isSelected ? "Selected" : "Choose offer"}</button>
                            </div>
                          </article>
                        `;
                        },
                      )
                      .join("")}
                  </div>
                `
                : ""
            }
          </div>
          <aside class="amazon-buy-box">
            <div class="mock-kicker">Buy box</div>
            <div class="mock-title">${formatCurrency(selectedOffer.price, "$")}</div>
            <div class="amazon-buy-box-status">${hasExplicitOfferSelection ? "Selected from offers" : "Default listing preview"}</div>
            <div class="mock-subtle">${escapeHtml(selectedOffer.seller)} · ${escapeHtml(selectedOffer.condition)}</div>
            <div class="mock-subtle">${escapeHtml(selectedOffer.delivery)}</div>
            <div class="mock-subtle">Variant ID: ${escapeHtml(variantId || "default")}</div>
            <div class="amazon-actions">
              <button class="mock-btn" data-action="add-to-cart">Add to Cart</button>
              <button class="mock-btn-secondary" data-action="buy-now">Buy Now</button>
            </div>
          </aside>
        </div>
      </section>
    `;
  }

  function renderCart(state) {
    return `
      <section class="amazon-cart mock-card">
        <div class="amazon-actions" style="justify-content: space-between; margin-bottom: 14px;">
          <div>
            <p class="mock-kicker">Cart</p>
            <h2 class="mock-title">${state.cart.items.length} active item(s)</h2>
          </div>
          <button class="mock-btn-secondary" data-action="go-home">Keep shopping</button>
        </div>
        <div class="amazon-cart-list">
          ${state.cart.items
            .map(
              (item) => `
                <article class="amazon-cart-card">
                  <div><strong>${escapeHtml(item.title)}</strong></div>
                  <div class="mock-subtle">Variant: ${escapeHtml(item.variantId || "default")} · Offer: ${escapeHtml(item.offerId || "default")}</div>
                  <div class="amazon-actions">
                    <button class="mock-btn-secondary" data-action="qty-change" data-item-id="${item.itemId}" data-qty="${item.quantity - 1}">-</button>
                    <span class="mock-pill">Qty ${item.quantity}</span>
                    <button class="mock-btn-secondary" data-action="qty-change" data-item-id="${item.itemId}" data-qty="${item.quantity + 1}">+</button>
                    <button class="mock-btn-secondary" data-action="save-for-later" data-item-id="${item.itemId}">Save for later</button>
                  </div>
                </article>
              `,
            )
            .join("")}
          ${state.cart.items.filter((item) => item.accessory).map((item) => "").join("")}
        </div>
        <div style="margin-top: 18px;">
          <p class="mock-kicker">Saved for later</p>
          <div class="amazon-saved-list">
            ${state.cart.saved.length
              ? state.cart.saved
                  .map(
                    (item) => `
                      <article class="amazon-cart-card">
                        <div><strong>${escapeHtml(item.title)}</strong></div>
                        <div class="amazon-actions">
                          <button class="mock-btn" data-action="restore-item" data-item-id="${item.itemId}">Restore</button>
                        </div>
                      </article>
                    `,
                  )
                  .join("")
              : '<div class="mock-subtle">Nothing saved yet.</div>'}
          </div>
        </div>
        <div style="margin-top: 18px;">
          <p class="mock-kicker">Accessories</p>
          <div class="amazon-saved-list">
            ${state.cart.items
              .filter((item) => item.accessory)
              .map(
                (item) => `
                  <article class="amazon-cart-card">
                    <div><strong>${escapeHtml(item.title)}</strong></div>
                    <div class="amazon-actions">
                      <button class="mock-btn-danger" data-action="remove-accessory" data-item-id="${item.itemId}" data-accessory-id="${item.accessoryId}">Remove</button>
                    </div>
                  </article>
                `,
              )
              .join("") || '<div class="mock-subtle">No accessory items.</div>'}
          </div>
        </div>
        <div class="amazon-actions" style="margin-top: 18px;">
          <button class="mock-btn" data-action="start-checkout">Proceed to checkout</button>
        </div>
      </section>
    `;
  }

  function renderCheckout(state) {
    const selectedAddress = ADDRESSES.find((address) => address.id === state.checkout.addressId);
    const shippingOptions = selectedAddress?.id === "address-office-loft"
      ? [
          { id: "shipping-locker-next-day", label: "Next-day locker delivery" },
          { id: "shipping-standard-office", label: "Standard office delivery" },
        ]
      : [
          { id: "shipping-dock-two-day", label: "Two-day dock delivery" },
          { id: "shipping-ground-warehouse", label: "Ground warehouse delivery" },
        ];

    return `
      <section class="amazon-checkout mock-card">
        <p class="mock-kicker">Checkout</p>
        <h2 class="mock-title">Select address, shipping, and payment</h2>
        <div class="amazon-checkout-grid">
          <div class="amazon-step">
            <div class="mock-kicker">Address</div>
            ${ADDRESSES.map((address) => `
              <button class="mock-btn-secondary amazon-address-button ${state.checkout.addressId === address.id ? "active" : ""}" style="width: 100%; margin-top: 10px;" data-action="select-address" data-address-id="${address.id}">
                ${escapeHtml(address.label)}
              </button>
            `).join("")}
          </div>
          <div class="amazon-step">
            <div class="mock-kicker">Shipping</div>
            ${shippingOptions.map((option) => `
              <button class="mock-btn-secondary amazon-shipping-button ${state.checkout.shippingOptionId === option.id ? "active" : ""}" style="width: 100%; margin-top: 10px;" data-action="select-shipping" data-shipping-id="${option.id}">
                ${escapeHtml(option.label)}
              </button>
            `).join("")}
          </div>
          <div class="amazon-step">
            <div class="mock-kicker">Payment</div>
            ${PAYMENTS.map((payment) => `
              <button class="mock-btn-secondary amazon-payment-button ${state.checkout.paymentId === payment.id ? "active" : ""}" style="width: 100%; margin-top: 10px;" data-action="select-payment" data-payment-id="${payment.id}">
                ${escapeHtml(payment.label)}
              </button>
            `).join("")}
          </div>
        </div>
        <div class="amazon-actions" style="margin-top: 18px;">
          <button class="mock-btn" data-action="place-order">Place order</button>
        </div>
      </section>
    `;
  }

  function renderConfirmation(state) {
    return `
      <section class="amazon-confirmation mock-card">
        <p class="mock-kicker">Order placed</p>
        <h2 class="mock-title">${escapeHtml(state.confirmation?.title || "")}</h2>
        <div class="mock-subtle">Address: ${escapeHtml(state.confirmation?.addressId || "")}</div>
        <div class="mock-subtle">Shipping: ${escapeHtml(state.confirmation?.shippingOptionId || "")}</div>
        <div class="mock-subtle">Payment: ${escapeHtml(state.confirmation?.paymentId || "")}</div>
      </section>
    `;
  }

  function render() {
    const state = store.getState();
    let content = "";
    if (state.ui.surface === "home") {
      content = renderHome(state);
    } else if (state.ui.surface === "results") {
      content = renderResults(state);
    } else if (state.ui.surface === "product") {
      content = renderProduct(state);
    } else if (state.ui.surface === "cart") {
      content = renderCart(state);
    } else if (state.ui.surface === "checkout") {
      content = renderCheckout(state);
    } else {
      content = renderConfirmation(state);
    }

    app.innerHTML = `
      <div class="mock-page">
        ${renderTopbar(state)}
        <main class="amazon-shell">
          ${content}
        </main>
      </div>
    `;
  }

  function searchSubmit() {
    const state = store.getState();
    tracker.track("amazon_search_execute", {
      query: state.ui.searchQuery,
    });
    store.update((draft) => {
      draft.ui.surface = "results";
    });
    render();
  }

  function openProduct(productId) {
    const product = getProduct(store.getState(), productId);
    if (!product) {
      return;
    }
    store.update((state) => {
      state.selectedProductId = product.id;
      state.selectedOfferId = "";
      state.selectedVariant = {};
      state.offersOpen = false;
      state.ui.surface = "product";
    });
    tracker.track("product_open", {
      productId: product.id,
    });
    render();
  }

  function selectVariant(key, value) {
    const state = store.getState();
    const product = getCurrentProduct(state);
    if (!product) {
      return;
    }
    store.update((draft) => {
      draft.selectedVariant[key] = value;
    });
    tracker.track("variant_select", {
      productId: product.id,
      variantKey: key,
      variantValue: value,
    });
    render();
  }

  function openOffers() {
    const state = store.getState();
    const product = getCurrentProduct(state);
    if (!product) {
      return;
    }
    store.update((draft) => {
      draft.offersOpen = !draft.offersOpen;
    });
    tracker.track("offer_open", {
      productId: product.id,
    });
    render();
  }

  function selectOffer(offerId) {
    const state = store.getState();
    const product = getCurrentProduct(state);
    if (!product) {
      return;
    }
    store.update((draft) => {
      draft.selectedOfferId = offerId;
    });
    tracker.track("offer_select", {
      productId: product.id,
      offerId,
    });
    render();
  }

  function addToCart(path) {
    const state = store.getState();
    const product = getCurrentProduct(state);
    if (!product) {
      return;
    }

    const variantId = getSelectedVariantId(state, product) || "default";
    const offerId = state.selectedOfferId || product.offers[0]?.id || "";
    const itemId = `cart-${product.id}`;
    store.update((draft) => {
      draft.cart.items = draft.cart.items.filter((item) => item.itemId !== itemId && item.productId !== product.id);
      draft.cart.items.push({
        itemId,
        productId: product.id,
        title: product.title,
        variantId,
        offerId,
        quantity: 1,
      });
      if (product.autoAccessoryId) {
        draft.cart.items.push({
          itemId: `accessory-${product.autoAccessoryId}`,
          accessory: true,
          accessoryId: product.autoAccessoryId,
          title: ACCESSORIES[product.autoAccessoryId],
        });
      }
      draft.checkout.checkoutPath = path;
      draft.ui.surface = path === "buy_now" ? "checkout" : "cart";
    });

    tracker.track("cart_add", {
      productId: product.id,
      variantId,
      offerId,
      checkoutPath: path,
    });
    render();
  }

  function changeQuantity(itemId, quantity) {
    if (quantity < 1) {
      return;
    }
    const state = store.getState();
    const item = state.cart.items.find((entry) => entry.itemId === itemId && !entry.accessory);
    if (!item) {
      return;
    }
    store.update((draft) => {
      const target = draft.cart.items.find((entry) => entry.itemId === itemId);
      if (target) {
        target.quantity = quantity;
      }
    });
    tracker.track("cart_qty_change", {
      productId: item.productId,
      quantity,
    });
    render();
  }

  function saveForLater(itemId) {
    const state = store.getState();
    const item = state.cart.items.find((entry) => entry.itemId === itemId);
    if (!item) {
      return;
    }
    store.update((draft) => {
      draft.cart.items = draft.cart.items.filter((entry) => entry.itemId !== itemId);
      draft.cart.saved.push(item);
    });
    tracker.track("save_for_later", {
      productId: item.productId,
    });
    render();
  }

  function restoreItem(itemId) {
    const state = store.getState();
    const item = state.cart.saved.find((entry) => entry.itemId === itemId);
    if (!item) {
      return;
    }
    store.update((draft) => {
      draft.cart.saved = draft.cart.saved.filter((entry) => entry.itemId !== itemId);
      draft.cart.items.push(item);
      draft.ui.surface = "cart";
    });
    tracker.track("restore_from_saved", {
      productId: item.productId,
    });
    render();
  }

  function removeAccessory(itemId, accessoryId) {
    store.update((draft) => {
      draft.cart.items = draft.cart.items.filter((entry) => entry.itemId !== itemId);
      if (!draft.cart.removedAccessoryIds.includes(accessoryId)) {
        draft.cart.removedAccessoryIds.push(accessoryId);
      }
    });
    render();
  }

  function selectAddress(addressId) {
    store.update((draft) => {
      draft.checkout.addressId = addressId;
      draft.checkout.shippingOptionId = "";
    });
    tracker.track("address_select", {
      addressId,
    });
    render();
  }

  function selectShipping(shippingId) {
    store.update((draft) => {
      draft.checkout.shippingOptionId = shippingId;
    });
    tracker.track("shipping_option_select", {
      shippingOptionId: shippingId,
    });
    render();
  }

  function selectPayment(paymentId) {
    store.update((draft) => {
      draft.checkout.paymentId = paymentId;
    });
    tracker.track("payment_select", {
      paymentId,
    });
    render();
  }

  function placeOrder() {
    const state = store.getState();
    const mainItem = state.cart.items.find((item) => !item.accessory);
    if (!mainItem) {
      return;
    }

    tracker.track("place_order_click", {
      productId: mainItem.productId,
      variantId: mainItem.variantId,
      offerId: mainItem.offerId,
      quantity: mainItem.quantity,
      removedAccessoryIds: state.cart.removedAccessoryIds.slice(),
      addressId: state.checkout.addressId,
      shippingOptionId: state.checkout.shippingOptionId,
      paymentId: state.checkout.paymentId,
      checkoutPath: state.checkout.checkoutPath || "cart",
    });

    store.update((draft) => {
      draft.confirmation = {
        title: mainItem.title,
        addressId: draft.checkout.addressId,
        shippingOptionId: draft.checkout.shippingOptionId,
        paymentId: draft.checkout.paymentId,
      };
      draft.ui.surface = "confirmation";
    });
    render();
  }

  app.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }

    const action = target.dataset.action;

    if (action === "set-search-query") {
      store.update((state) => {
        state.ui.searchQuery = target.dataset.query;
      });
      render();
      return;
    }

    if (action === "search-submit") {
      searchSubmit();
      return;
    }

    if (action === "open-product") {
      openProduct(target.dataset.productId);
      return;
    }

    if (action === "select-variant") {
      selectVariant(target.dataset.variantKey, target.dataset.variantValue);
      return;
    }

    if (action === "open-offers") {
      openOffers();
      return;
    }

    if (action === "select-offer") {
      selectOffer(target.dataset.offerId);
      return;
    }

    if (action === "add-to-cart") {
      addToCart("cart");
      return;
    }

    if (action === "buy-now") {
      addToCart("buy_now");
      return;
    }

    if (action === "open-cart") {
      store.update((state) => {
        state.ui.surface = "cart";
      });
      render();
      return;
    }

    if (action === "qty-change") {
      changeQuantity(target.dataset.itemId, Number(target.dataset.qty));
      return;
    }

    if (action === "save-for-later") {
      saveForLater(target.dataset.itemId);
      return;
    }

    if (action === "restore-item") {
      restoreItem(target.dataset.itemId);
      return;
    }

    if (action === "remove-accessory") {
      removeAccessory(target.dataset.itemId, target.dataset.accessoryId);
      return;
    }

    if (action === "start-checkout") {
      store.update((state) => {
        state.ui.surface = "checkout";
        if (!state.checkout.checkoutPath) {
          state.checkout.checkoutPath = "cart";
        }
      });
      render();
      return;
    }

    if (action === "select-address") {
      selectAddress(target.dataset.addressId);
      return;
    }

    if (action === "select-shipping") {
      selectShipping(target.dataset.shippingId);
      return;
    }

    if (action === "select-payment") {
      selectPayment(target.dataset.paymentId);
      return;
    }

    if (action === "place-order") {
      placeOrder();
      return;
    }

    if (action === "go-home") {
      store.update((state) => {
        state.ui.surface = "home";
      });
      render();
    }
  });

  app.addEventListener("input", (event) => {
    if (event.target.id === "amazon-search-input") {
      store.update((state) => {
        state.ui.searchQuery = event.target.value;
      });
    }
  });

  app.addEventListener("change", (event) => {
    if (event.target.id === "amazon-brand-filter") {
      store.update((state) => {
        state.filters.brand = event.target.value;
      });
      tracker.track("facet_select", {
        facet: "brand",
        value: event.target.value,
      });
      render();
      return;
    }

    if (event.target.id === "amazon-sponsored-filter") {
      store.update((state) => {
        state.filters.sponsoredOnly = event.target.checked;
      });
      tracker.track("facet_select", {
        facet: "sponsored",
        value: String(event.target.checked),
      });
      render();
      return;
    }

    if (event.target.id === "amazon-sort") {
      store.update((state) => {
        state.sort = event.target.value;
      });
      tracker.track("results_sort_apply", {
        value: event.target.value,
      });
      render();
    }
  });

  render();
})();

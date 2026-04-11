window.tracker = new AgentTracker("booking.com", "hard");

(function () {
  const { createSeededStore, escapeHtml, formatCurrency, uniqueSorted } = window.HardMockSite;

  function createPlan(config) {
    return {
      id: config.id,
      name: config.name,
      breakfast: Boolean(config.breakfast),
      freeCancellation: Boolean(config.freeCancellation),
      occupancy: config.occupancy,
      roomType: config.roomType,
      price: config.price,
      payment: config.payment || "Pay at property",
      notes: config.notes || [],
    };
  }

  function createProperty(config) {
    return {
      id: config.id,
      name: config.name,
      neighborhood: config.neighborhood,
      reviewScore: config.reviewScore,
      reviewText: config.reviewText,
      description: config.description,
      roomPlans: config.roomPlans || [],
      badges: config.badges || [],
    };
  }

  function buildSeedProperties() {
    const properties = [
      createProperty({
        id: "property-castelo-river-house",
        name: "Castelo River House",
        neighborhood: "Baixa",
        reviewScore: 9.1,
        reviewText: "Exceptional",
        description: "Quiet townhouse off the riverfront with breakfast slots and flexible cancellations on premium rooms.",
        badges: ["River access", "Breakfast bar"],
        roomPlans: [
          createPlan({
            id: "plan-castelo-deluxe-breakfast-flex",
            name: "Deluxe Queen Balcony",
            breakfast: true,
            freeCancellation: true,
            occupancy: 2,
            roomType: "Queen",
            price: 244,
            notes: ["Breakfast included", "Free cancellation until Jun 12"],
          }),
          createPlan({
            id: "plan-castelo-deluxe-breakfast-prepay",
            name: "Deluxe Queen Balcony",
            breakfast: true,
            freeCancellation: false,
            occupancy: 2,
            roomType: "Queen",
            price: 212,
            notes: ["Breakfast included", "Non-refundable"],
          }),
        ],
      }),
      createProperty({
        id: "property-castelo-river-houses",
        name: "Castelo River Houses",
        neighborhood: "Baixa",
        reviewScore: 8.9,
        reviewText: "Fabulous",
        description: "Very similar branding, but only breakfast on prepaid rooms.",
        badges: ["Flexible late check-in"],
        roomPlans: [
          createPlan({
            id: "plan-castelo-houses-flex-no-breakfast",
            name: "Superior Double",
            breakfast: false,
            freeCancellation: true,
            occupancy: 2,
            roomType: "Double",
            price: 228,
            notes: ["Free cancellation", "Breakfast not included"],
          }),
        ],
      }),
      createProperty({
        id: "property-harborline-residence-chiado",
        name: "Harborline Residence Chiado",
        neighborhood: "Chiado",
        reviewScore: 9.0,
        reviewText: "Wonderful",
        description: "Modern business-facing residence with strong breakfast and cancellation combinations.",
        badges: ["Business lounge", "Walkable center"],
        roomPlans: [
          createPlan({
            id: "plan-harborline-chiado-premium-flex-breakfast",
            name: "Premium King with Courtyard View",
            breakfast: true,
            freeCancellation: true,
            occupancy: 2,
            roomType: "King",
            price: 276,
            notes: ["Breakfast included", "Free cancellation", "Pay at property"],
          }),
          createPlan({
            id: "plan-harborline-chiado-studio-prepay",
            name: "Compact Studio",
            breakfast: true,
            freeCancellation: false,
            occupancy: 2,
            roomType: "Studio",
            price: 219,
            notes: ["Breakfast included", "Prepay only"],
          }),
        ],
      }),
      createProperty({
        id: "property-harborline-residences-chiado",
        name: "Harborline Residences Chiado",
        neighborhood: "Chiado",
        reviewScore: 8.8,
        reviewText: "Fabulous",
        description: "Nearly identical name, but its flexible room lacks breakfast.",
        badges: ["Shared lounge"],
        roomPlans: [
          createPlan({
            id: "plan-harborline-residences-flex",
            name: "Executive Double",
            breakfast: false,
            freeCancellation: true,
            occupancy: 2,
            roomType: "Double",
            price: 241,
            notes: ["Free cancellation", "Breakfast not included"],
          }),
        ],
      }),
      createProperty({
        id: "property-miradouro-lane-hotel",
        name: "Miradouro Lane Hotel",
        neighborhood: "Alfama",
        reviewScore: 9.2,
        reviewText: "Exceptional",
        description: "Family-friendly hilltop hotel with multi-room combinations and breakfast on the target offers.",
        badges: ["Family stay", "Breakfast included"],
        roomPlans: [
          createPlan({
            id: "plan-miradouro-family-loft-flex-breakfast",
            name: "Family Loft with Terrace",
            breakfast: true,
            freeCancellation: true,
            occupancy: 4,
            roomType: "Family Loft",
            price: 328,
            notes: ["Breakfast included", "Free cancellation", "Best for 2 adults + 2 children"],
          }),
          createPlan({
            id: "plan-miradouro-standard-twin-flex-breakfast",
            name: "Standard Twin City View",
            breakfast: true,
            freeCancellation: true,
            occupancy: 2,
            roomType: "Twin",
            price: 214,
            notes: ["Breakfast included", "Free cancellation"],
          }),
          createPlan({
            id: "plan-miradouro-family-loft-no-breakfast",
            name: "Family Loft with Terrace",
            breakfast: false,
            freeCancellation: true,
            occupancy: 4,
            roomType: "Family Loft",
            price: 299,
            notes: ["Free cancellation", "Breakfast not included"],
          }),
        ],
      }),
      createProperty({
        id: "property-miradouro-lane-house",
        name: "Miradouro Lane House",
        neighborhood: "Alfama",
        reviewScore: 9.0,
        reviewText: "Wonderful",
        description: "Similar neighborhood and branding but fewer room combinations.",
        badges: ["Adults preferred"],
        roomPlans: [
          createPlan({
            id: "plan-miradouro-house-double",
            name: "Double Room",
            breakfast: true,
            freeCancellation: true,
            occupancy: 2,
            roomType: "Double",
            price: 221,
            notes: ["Breakfast included", "Free cancellation"],
          }),
        ],
      }),
    ];

    const fillerNeighborhoods = ["Chiado", "Baixa", "Alfama", "Avenida", "Bairro Alto"];
    for (let index = 1; index <= 14; index += 1) {
      properties.push(
        createProperty({
          id: `property-filler-${index}`,
          name: `Lisbon Stayhouse ${index}`,
          neighborhood: fillerNeighborhoods[index % fillerNeighborhoods.length],
          reviewScore: 8.1 + (index % 8) * 0.1,
          reviewText: "Very good",
          description: "Seeded hotel used for dense result pages and decoy availability.",
          badges: index % 2 === 0 ? ["Late check-in"] : ["Breakfast optional"],
          roomPlans: [
            createPlan({
              id: `plan-filler-${index}-1`,
              name: "Standard Room",
              breakfast: index % 2 === 0,
              freeCancellation: index % 3 !== 0,
              occupancy: 2,
              roomType: "Standard",
              price: 165 + index,
              notes: ["Seeded room plan"],
            }),
          ],
        }),
      );
    }

    return properties;
  }

  function buildSeedState() {
    return {
      properties: buildSeedProperties(),
      ui: {
        surface: "search",
        modal: null,
      },
      search: {
        destinationId: null,
        destinationLabel: "",
        checkIn: "",
        checkOut: "",
        guests: {
          adults: 2,
          children: 0,
          rooms: 1,
        },
        filters: {
          minReview: "",
          freeCancellation: false,
          neighborhood: "",
          meal: "",
        },
        sort: "recommended",
      },
      shortlist: [],
      selectedPropertyId: null,
      selectedRoomPlanIds: [],
      checkout: {
        guestNames: ["", ""],
        email: "",
        specialRequest: "",
      },
      confirmation: null,
    };
  }

  const store = createSeededStore({
    storageKey: "openbrowser.eval.booking",
    seedState: buildSeedState(),
  });

  const DESTINATIONS = [
    { id: "lisbon-portugal", label: "Lisbon, Portugal" },
    { id: "lisbon-old-town", label: "Lisbon Old Town, Portugal" },
    { id: "porto-portugal", label: "Porto, Portugal" },
  ];

  const CALENDAR_MONTHS = [
    { id: "2026-06", label: "June 2026", days: [14, 15, 16, 17, 18, 19, 20, 21] },
    { id: "2026-07", label: "July 2026", days: [4, 5, 6, 7, 8, 9, 10, 11] },
  ];

  const app = document.getElementById("app");

  function getPropertyById(state, propertyId) {
    return state.properties.find((property) => property.id === propertyId) || null;
  }

  function getSelectedProperty(state) {
    return getPropertyById(state, state.selectedPropertyId);
  }

  function getFilteredProperties(state) {
    const { minReview, freeCancellation, neighborhood, meal } = state.search.filters;
    return state.properties
      .filter((property) => {
        if (state.search.destinationId && state.search.destinationId.indexOf("lisbon") === -1) {
          return false;
        }
        if (minReview && property.reviewScore < Number(minReview)) {
          return false;
        }
        if (neighborhood && property.neighborhood !== neighborhood) {
          return false;
        }
        if (freeCancellation && !property.roomPlans.some((plan) => plan.freeCancellation)) {
          return false;
        }
        if (meal === "breakfast" && !property.roomPlans.some((plan) => plan.breakfast)) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (state.search.sort === "score-desc") {
          return right.reviewScore - left.reviewScore;
        }
        if (state.search.sort === "price-asc") {
          return Math.min(...left.roomPlans.map((plan) => plan.price)) - Math.min(...right.roomPlans.map((plan) => plan.price));
        }
        return right.reviewScore - left.reviewScore;
      });
  }

  function renderTopbar() {
    return `
      <header class="mock-topbar">
        <div class="booking-topbar">
          <div class="booking-brand">
            <div class="booking-brand-mark">B</div>
            <div>
              <div>Booking Mock</div>
              <div class="mock-subtle">Hotels, filters, compare, room plans, checkout</div>
            </div>
          </div>
          <div class="mock-subtle">Dense decision-making with near-duplicate hotels and repeated room actions.</div>
          <div style="display: flex; gap: 10px;">
            <span class="mock-pill">18+ properties</span>
            <span class="mock-pill">Multi-room edge cases</span>
          </div>
        </div>
      </header>
    `;
  }

  function renderSearchSurface(state) {
    return `
      <section class="booking-hero mock-card">
        <div>
          <p class="mock-kicker">Search stays</p>
          <h1 class="mock-title">Search through dense Lisbon listings with repeated names and subtle policy differences.</h1>
        </div>
        <div class="booking-search-grid">
          <div>
            <label class="mock-kicker" for="destination-input">Destination</label>
            <input id="destination-input" class="mock-input" value="${escapeHtml(state.search.destinationLabel)}" placeholder="Where are you going?">
          </div>
          <div>
            <label class="mock-kicker">Dates</label>
            <button class="mock-btn-secondary" data-action="open-dates">${state.search.checkIn && state.search.checkOut ? `${state.search.checkIn} → ${state.search.checkOut}` : "Choose dates"}</button>
          </div>
          <div>
            <label class="mock-kicker">Guests</label>
            <button class="mock-btn-secondary" data-action="open-guests">${state.search.guests.adults} adults · ${state.search.guests.children} children · ${state.search.guests.rooms} room(s)</button>
          </div>
          <div>
            <label class="mock-kicker">Hints</label>
            <div class="mock-pill">Use the autocomplete choice, not free text only</div>
          </div>
          <button class="mock-btn" data-action="search-submit">Search stays</button>
        </div>
      </section>
    `;
  }

  function renderPropertyCard(state, property) {
    return `
      <article class="booking-property-card">
        <div class="booking-property-top">
          <div>
            <div class="booking-property-name">${escapeHtml(property.name)}</div>
            <div class="mock-subtle">${escapeHtml(property.neighborhood)} · ${escapeHtml(property.description)}</div>
          </div>
          <div class="booking-score">
            <span class="booking-score-box">${property.reviewScore.toFixed(1)}</span>
            <span class="mock-subtle">${escapeHtml(property.reviewText)}</span>
          </div>
        </div>
        <div class="booking-property-meta">
          ${property.badges.map((badge) => `<span class="mock-badge">${escapeHtml(badge)}</span>`).join("")}
          <span class="mock-badge">${property.roomPlans.length} room plans</span>
        </div>
        <div class="booking-actions">
          <button class="mock-btn-secondary" data-action="toggle-shortlist" data-property-id="${property.id}">
            ${state.shortlist.includes(property.id) ? "Shortlisted" : "Save"}
          </button>
          <button class="mock-btn" data-action="open-property" data-property-id="${property.id}">See availability</button>
        </div>
      </article>
    `;
  }

  function renderResultsSurface(state) {
    const results = getFilteredProperties(state);
    return `
      <div class="booking-layout">
        <aside class="booking-filters mock-card mock-sticky-panel">
          <div>
            <p class="mock-kicker">Refine search</p>
            <h2 class="mock-title">Filters</h2>
          </div>
          <div>
            <label class="mock-kicker" for="filter-review">Review score</label>
            <select id="filter-review" class="mock-select" data-filter-key="minReview">
              <option value="">Any</option>
              <option value="8.8" ${state.search.filters.minReview === "8.8" ? "selected" : ""}>8.8+</option>
              <option value="9.0" ${state.search.filters.minReview === "9.0" ? "selected" : ""}>9.0+</option>
            </select>
          </div>
          <div>
            <label class="mock-kicker" for="filter-neighborhood">Neighborhood</label>
            <select id="filter-neighborhood" class="mock-select" data-filter-key="neighborhood">
              <option value="">Any</option>
              <option value="Baixa" ${state.search.filters.neighborhood === "Baixa" ? "selected" : ""}>Baixa</option>
              <option value="Chiado" ${state.search.filters.neighborhood === "Chiado" ? "selected" : ""}>Chiado</option>
              <option value="Alfama" ${state.search.filters.neighborhood === "Alfama" ? "selected" : ""}>Alfama</option>
            </select>
          </div>
          <div>
            <label class="mock-kicker" for="filter-meal">Meals</label>
            <select id="filter-meal" class="mock-select" data-filter-key="meal">
              <option value="">Any</option>
              <option value="breakfast" ${state.search.filters.meal === "breakfast" ? "selected" : ""}>Breakfast included</option>
            </select>
          </div>
          <label class="mock-pill" style="justify-content: flex-start;">
            <input type="checkbox" data-filter-key="freeCancellation" ${state.search.filters.freeCancellation ? "checked" : ""}>
            Free cancellation
          </label>
        </aside>
        <section class="booking-results mock-card">
          <div class="booking-actions" style="justify-content: space-between; margin-bottom: 14px;">
            <div>
              <p class="mock-kicker">Results</p>
              <h2 class="mock-title">${results.length} Lisbon stays</h2>
            </div>
            <div class="booking-actions">
              <select class="mock-select" id="booking-sort" style="min-width: 180px;">
                <option value="recommended" ${state.search.sort === "recommended" ? "selected" : ""}>Recommended</option>
                <option value="score-desc" ${state.search.sort === "score-desc" ? "selected" : ""}>Top reviewed</option>
                <option value="price-asc" ${state.search.sort === "price-asc" ? "selected" : ""}>Lowest price</option>
              </select>
              <button class="mock-btn-secondary" data-action="open-compare" ${state.shortlist.length === 2 ? "" : "disabled"}>Compare saved stays</button>
            </div>
          </div>
          <div class="booking-results-list">
            ${results.map((property) => renderPropertyCard(state, property)).join("")}
          </div>
        </section>
      </div>
    `;
  }

  function renderPropertySurface(state) {
    const property = getSelectedProperty(state);
    if (!property) {
      return renderResultsSurface(state);
    }

    const selectedPlans = state.selectedRoomPlanIds;
    const nextRoomSlot = selectedPlans.length + 1;

    return `
      <section class="booking-property mock-card">
        <div class="booking-property-layout">
          <div>
            <div class="booking-actions" style="justify-content: space-between; margin-bottom: 14px;">
              <div>
                <p class="mock-kicker">Property detail</p>
                <h2 class="mock-title">${escapeHtml(property.name)}</h2>
                <p class="mock-subtle">${escapeHtml(property.neighborhood)} · ${escapeHtml(property.description)}</p>
              </div>
              <button class="mock-btn-secondary" data-action="back-to-results">Back to results</button>
            </div>
            <div class="booking-room-list">
              ${property.roomPlans
                .map(
                  (plan) => `
                    <article class="booking-room-card">
                      <div class="booking-room-grid">
                        <div>
                          <div class="booking-property-name" style="font-size: 18px;">${escapeHtml(plan.name)}</div>
                          <div class="booking-room-meta">
                            <span class="mock-badge">${escapeHtml(plan.roomType)}</span>
                            <span class="mock-badge">${plan.breakfast ? "Breakfast included" : "No breakfast"}</span>
                            <span class="mock-badge">${plan.freeCancellation ? "Free cancellation" : "Non-refundable"}</span>
                            <span class="mock-badge">Fits ${plan.occupancy}</span>
                          </div>
                          <div class="mock-subtle">${escapeHtml(plan.notes.join(" · "))}</div>
                        </div>
                        <div>
                          <div class="mock-kicker">Price</div>
                          <div class="mock-title">${formatCurrency(plan.price, "$")}</div>
                          <div class="mock-subtle">${escapeHtml(plan.payment)}</div>
                        </div>
                        <div>
                          <div class="booking-room-slot">Room slot ${Math.min(nextRoomSlot, state.search.guests.rooms)}</div>
                          <button class="mock-btn" data-action="select-plan" data-plan-id="${plan.id}">Select</button>
                        </div>
                      </div>
                    </article>
                  `,
                )
                .join("")}
            </div>
          </div>
          <aside class="booking-summary-side mock-card">
            <div>
              <p class="mock-kicker">Selection summary</p>
              <h3 class="mock-title">Guests and room rules</h3>
            </div>
            <div class="mock-subtle">${state.search.guests.adults} adults · ${state.search.guests.children} children · ${state.search.guests.rooms} room(s)</div>
            <div class="mock-subtle">Selected room plans: ${selectedPlans.length || 0}</div>
            <div class="booking-property-meta">
              ${selectedPlans.map((planId) => `<span class="mock-badge">${escapeHtml(planId)}</span>`).join("") || '<span class="mock-subtle">Nothing selected yet.</span>'}
            </div>
            <button class="mock-btn" data-action="continue-checkout" ${selectedPlans.length === state.search.guests.rooms ? "" : "disabled"}>Continue to traveler details</button>
          </aside>
        </div>
      </section>
    `;
  }

  function renderCheckoutSurface(state) {
    const property = getSelectedProperty(state);
    return `
      <section class="booking-checkout mock-card">
        <div class="booking-actions" style="justify-content: space-between; margin-bottom: 14px;">
          <div>
            <p class="mock-kicker">Traveler details</p>
            <h2 class="mock-title">${escapeHtml(property ? property.name : "")}</h2>
          </div>
          <button class="mock-btn-secondary" data-action="back-to-property">Back to rooms</button>
        </div>
        <div class="booking-form-grid">
          <div>
            <label class="mock-kicker" for="guest-name-1">Primary traveler</label>
            <input id="guest-name-1" class="mock-input" data-checkout-field="guest-0" value="${escapeHtml(state.checkout.guestNames[0] || "")}">
          </div>
          <div>
            <label class="mock-kicker" for="guest-name-2">Second traveler / room lead</label>
            <input id="guest-name-2" class="mock-input" data-checkout-field="guest-1" value="${escapeHtml(state.checkout.guestNames[1] || "")}">
          </div>
          <div>
            <label class="mock-kicker" for="checkout-email">Email</label>
            <input id="checkout-email" class="mock-input" data-checkout-field="email" value="${escapeHtml(state.checkout.email)}">
          </div>
          <div>
            <label class="mock-kicker" for="special-request">Special request</label>
            <textarea id="special-request" class="mock-textarea" rows="4" data-checkout-field="specialRequest">${escapeHtml(state.checkout.specialRequest)}</textarea>
          </div>
        </div>
        <div class="booking-actions" style="margin-top: 16px;">
          <button class="mock-btn-secondary" data-action="submit-traveler-form">Save traveler details</button>
          <button class="mock-btn" data-action="submit-reservation">Confirm reservation</button>
        </div>
      </section>
    `;
  }

  function renderCompareSurface(state) {
    const properties = state.shortlist.map((propertyId) => getPropertyById(state, propertyId)).filter(Boolean);
    return `
      <section class="booking-compare mock-card">
        <div class="booking-actions" style="justify-content: space-between; margin-bottom: 14px;">
          <div>
            <p class="mock-kicker">Compare</p>
            <h2 class="mock-title">Saved stays</h2>
          </div>
          <button class="mock-btn-secondary" data-action="back-to-results">Back to results</button>
        </div>
        <div class="booking-compare-grid">
          ${properties
            .map(
              (property) => `
                <article class="booking-compare-card">
                  <div class="booking-property-name">${escapeHtml(property.name)}</div>
                  <div class="mock-subtle">${escapeHtml(property.neighborhood)} · Score ${property.reviewScore.toFixed(1)}</div>
                  <div class="booking-property-meta">
                    ${property.badges.map((badge) => `<span class="mock-badge">${escapeHtml(badge)}</span>`).join("")}
                  </div>
                  <button class="mock-btn" data-action="open-property" data-property-id="${property.id}">Reopen property</button>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderConfirmationSurface(state) {
    const confirmation = state.confirmation;
    if (!confirmation) {
      return renderResultsSurface(state);
    }

    return `
      <section class="booking-confirmation mock-card">
        <p class="mock-kicker">Reservation complete</p>
        <h2 class="mock-title">${escapeHtml(confirmation.propertyName)}</h2>
        <div class="mock-subtle">Reservation path: ${escapeHtml(confirmation.roomPlanIds.join(", "))}</div>
        <div class="booking-property-meta">
          <span class="mock-badge">${escapeHtml(confirmation.email)}</span>
          ${confirmation.guestNames.filter(Boolean).map((name) => `<span class="mock-badge">${escapeHtml(name)}</span>`).join("")}
        </div>
        ${confirmation.specialRequest ? `<div class="mock-subtle">Special request: ${escapeHtml(confirmation.specialRequest)}</div>` : ""}
        <button class="mock-btn-secondary" data-action="back-to-results">Book another stay</button>
      </section>
    `;
  }

  function renderModal(state) {
    const modal = state.ui.modal;
    if (!modal) {
      return "";
    }

    if (modal.type === "destination") {
      return `
        <div class="mock-modal-backdrop">
          <div class="mock-modal">
            <div class="mock-modal-header">
              <div>
                <p class="mock-kicker">Destination autocomplete</p>
                <h3 class="mock-title">Choose the destination</h3>
              </div>
              <button class="mock-btn-ghost" data-action="close-modal">Close</button>
            </div>
            <div class="mock-modal-body">
              ${DESTINATIONS.map((destination) => `
                <button class="drive-upload-option" data-action="choose-destination" data-destination-id="${destination.id}">
                  <span>${escapeHtml(destination.label)}</span>
                  <span class="mock-subtle">${destination.id.includes("lisbon") ? "Portugal" : "Alternative city"}</span>
                </button>
              `).join("")}
            </div>
          </div>
        </div>
      `;
    }

    if (modal.type === "dates") {
      return `
        <div class="mock-modal-backdrop">
          <div class="mock-modal">
            <div class="mock-modal-header">
              <div>
                <p class="mock-kicker">Dual-month picker</p>
                <h3 class="mock-title">Select check-in and check-out</h3>
              </div>
              <button class="mock-btn-ghost" data-action="close-modal">Close</button>
            </div>
            <div class="mock-modal-body">
              <div class="booking-modal-calendar">
                ${CALENDAR_MONTHS.map((month) => `
                  <section class="booking-month">
                    <p class="mock-kicker">${escapeHtml(month.label)}</p>
                    <div class="booking-day-grid">
                      ${month.days
                        .map((day) => {
                          const value = `${month.id}-${String(day).padStart(2, "0")}`;
                          const active = [state.search.checkIn, state.search.checkOut].includes(value);
                          return `<button class="booking-day ${active ? "active" : ""}" data-action="pick-date" data-date="${value}">${day}</button>`;
                        })
                        .join("")}
                    </div>
                  </section>
                `).join("")}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    if (modal.type === "guests") {
      const guests = state.search.guests;
      return `
        <div class="mock-modal-backdrop">
          <div class="mock-modal">
            <div class="mock-modal-header">
              <div>
                <p class="mock-kicker">Guest picker</p>
                <h3 class="mock-title">Adjust guests and rooms</h3>
              </div>
              <button class="mock-btn-ghost" data-action="close-modal">Close</button>
            </div>
            <div class="mock-modal-body">
              ${[
                ["adults", "Adults"],
                ["children", "Children"],
                ["rooms", "Rooms"],
              ]
                .map(
                  ([key, label]) => `
                    <div class="booking-counter-row">
                      <span>${label}</span>
                      <button class="mock-btn-secondary" data-action="guest-adjust" data-key="${key}" data-delta="-1">-</button>
                      <span>${guests[key]}</span>
                      <button class="mock-btn-secondary" data-action="guest-adjust" data-key="${key}" data-delta="1">+</button>
                    </div>
                  `,
                )
                .join("")}
            </div>
            <div class="mock-modal-footer">
              <span class="mock-subtle">Traveler validation later depends on this room allocation.</span>
              <button class="mock-btn" data-action="close-modal">Done</button>
            </div>
          </div>
        </div>
      `;
    }

    return "";
  }

  function render() {
    const state = store.getState();
    let content = "";
    if (state.ui.surface === "search") {
      content = renderSearchSurface(state);
    } else if (state.ui.surface === "results") {
      content = renderResultsSurface(state);
    } else if (state.ui.surface === "property") {
      content = renderPropertySurface(state);
    } else if (state.ui.surface === "checkout") {
      content = renderCheckoutSurface(state);
    } else if (state.ui.surface === "compare") {
      content = renderCompareSurface(state);
    } else {
      content = renderConfirmationSurface(state);
    }

    app.innerHTML = `
      <div class="mock-page">
        ${renderTopbar()}
        <main class="booking-shell">
          ${content}
        </main>
        ${renderModal(state)}
      </div>
    `;
  }

  function setDestination(destinationId) {
    const destination = DESTINATIONS.find((item) => item.id === destinationId);
    if (!destination) {
      return;
    }

    store.update((state) => {
      state.search.destinationId = destination.id;
      state.search.destinationLabel = destination.label;
      state.ui.modal = null;
    });
    tracker.track("destination_select", {
      destinationId: destination.id,
      destinationLabel: destination.label,
    });
    render();
  }

  function pickDate(value) {
    const nextState = store.update((state) => {
      if (!state.search.checkIn || (state.search.checkIn && state.search.checkOut)) {
        state.search.checkIn = value;
        state.search.checkOut = "";
      } else {
        state.search.checkOut = value;
        if (state.search.checkOut < state.search.checkIn) {
          const temp = state.search.checkIn;
          state.search.checkIn = state.search.checkOut;
          state.search.checkOut = temp;
        }
      }
    });

    if (nextState.search.checkIn && nextState.search.checkOut) {
      tracker.track("date_range_select", {
        checkIn: nextState.search.checkIn,
        checkOut: nextState.search.checkOut,
      });
    }
    render();
  }

  function adjustGuest(key, delta) {
    const nextState = store.update((state) => {
      const minValues = { adults: 1, children: 0, rooms: 1 };
      state.search.guests[key] = Math.max(minValues[key], state.search.guests[key] + delta);
    });
    tracker.track("guest_count_change", {
      adults: nextState.search.guests.adults,
      children: nextState.search.guests.children,
      rooms: nextState.search.guests.rooms,
    });
    render();
  }

  function submitSearch() {
    const state = store.getState();
    store.update((draft) => {
      draft.ui.surface = "results";
      draft.selectedPropertyId = null;
      draft.selectedRoomPlanIds = [];
    });
    tracker.track("search_submit", {
      destinationId: state.search.destinationId,
      checkIn: state.search.checkIn,
      checkOut: state.search.checkOut,
      adults: state.search.guests.adults,
      children: state.search.guests.children,
      rooms: state.search.guests.rooms,
    });
    render();
  }

  function applyFilter(key, value) {
    const normalizedValue = key === "freeCancellation" ? value : value;
    const nextState = store.update((state) => {
      state.search.filters[key] = normalizedValue;
    });
    tracker.track("filter_apply", {
      filterKey: key,
      value: String(nextState.search.filters[key]),
    });
    render();
  }

  function applySort(value) {
    store.update((state) => {
      state.search.sort = value;
    });
    tracker.track("sort_apply", {
      value,
    });
    render();
  }

  function toggleShortlist(propertyId) {
    const nextState = store.update((state) => {
      const shortlist = new Set(state.shortlist);
      if (shortlist.has(propertyId)) {
        shortlist.delete(propertyId);
      } else if (shortlist.size < 2) {
        shortlist.add(propertyId);
      }
      state.shortlist = Array.from(shortlist);
    });
    tracker.track("shortlist_toggle", {
      propertyId,
      shortlisted: nextState.shortlist.includes(propertyId),
    });
    render();
  }

  function openProperty(propertyId) {
    const property = getPropertyById(store.getState(), propertyId);
    if (!property) {
      return;
    }

    store.update((state) => {
      state.selectedPropertyId = property.id;
      state.selectedRoomPlanIds = [];
      state.ui.surface = "property";
    });
    tracker.track("property_open", {
      propertyId: property.id,
    });
    render();
  }

  function selectPlan(planId) {
    const state = store.getState();
    const property = getSelectedProperty(state);
    if (!property) {
      return;
    }

    const plan = property.roomPlans.find((item) => item.id === planId);
    if (!plan) {
      return;
    }

    const roomSlot = Math.min(state.selectedRoomPlanIds.length + 1, state.search.guests.rooms);
    store.update((draft) => {
      if (draft.selectedRoomPlanIds.length < draft.search.guests.rooms) {
        draft.selectedRoomPlanIds.push(planId);
      }
    });
    tracker.track("rate_plan_select", {
      propertyId: property.id,
      roomPlanId: plan.id,
      roomSlot,
    });
    render();
  }

  function continueCheckout() {
    const state = store.getState();
    store.update((state) => {
      state.ui.surface = "checkout";
    });
    tracker.track("booking_continue", {
      propertyId: state.selectedPropertyId,
      roomPlanIds: state.selectedRoomPlanIds.slice(),
      stage: "traveler_details",
    });
    render();
  }

  function submitTravelerForm() {
    const state = store.getState();
    tracker.track("traveler_form_submit", {
      propertyId: state.selectedPropertyId,
      guestNames: state.checkout.guestNames.filter(Boolean),
      email: state.checkout.email,
    });
  }

  function submitReservation() {
    const state = store.getState();
    const property = getSelectedProperty(state);
    if (!property) {
      return;
    }

    const payload = {
      propertyId: property.id,
      roomPlanIds: state.selectedRoomPlanIds.slice(),
      guestNames: state.checkout.guestNames.filter(Boolean),
      email: state.checkout.email,
      specialRequest: state.checkout.specialRequest,
    };

    tracker.track("reservation_submit", payload);
    store.update((draft) => {
      draft.confirmation = {
        propertyName: property.name,
        roomPlanIds: draft.selectedRoomPlanIds.slice(),
        guestNames: draft.checkout.guestNames.filter(Boolean),
        email: draft.checkout.email,
        specialRequest: draft.checkout.specialRequest,
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

    if (action === "open-dates") {
      store.update((state) => {
        state.ui.modal = { type: "dates" };
      });
      render();
      return;
    }

    if (action === "open-guests") {
      store.update((state) => {
        state.ui.modal = { type: "guests" };
      });
      render();
      return;
    }

    if (action === "search-submit") {
      submitSearch();
      return;
    }

    if (action === "choose-destination") {
      setDestination(target.dataset.destinationId);
      return;
    }

    if (action === "pick-date") {
      pickDate(target.dataset.date);
      return;
    }

    if (action === "guest-adjust") {
      adjustGuest(target.dataset.key, Number(target.dataset.delta));
      return;
    }

    if (action === "toggle-shortlist") {
      toggleShortlist(target.dataset.propertyId);
      return;
    }

    if (action === "open-property") {
      openProperty(target.dataset.propertyId);
      return;
    }

    if (action === "back-to-results") {
      store.update((state) => {
        state.ui.surface = "results";
      });
      render();
      return;
    }

    if (action === "select-plan") {
      selectPlan(target.dataset.planId);
      return;
    }

    if (action === "continue-checkout") {
      continueCheckout();
      return;
    }

    if (action === "submit-traveler-form") {
      submitTravelerForm();
      return;
    }

    if (action === "submit-reservation") {
      submitReservation();
      return;
    }

    if (action === "back-to-property") {
      store.update((state) => {
        state.ui.surface = "property";
      });
      render();
      return;
    }

    if (action === "open-compare") {
      const state = store.getState();
      store.update((state) => {
        state.ui.surface = "compare";
      });
      tracker.track("compare_open", {
        propertyIds: state.shortlist.slice(),
      });
      render();
      return;
    }

    if (action === "close-modal") {
      store.update((state) => {
        state.ui.modal = null;
      });
      render();
    }
  });

  app.addEventListener("change", (event) => {
    if (event.target.id === "booking-sort") {
      applySort(event.target.value);
      return;
    }

    const filterKey = event.target.dataset.filterKey;
    if (filterKey) {
      const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
      applyFilter(filterKey, value);
    }
  });

  app.addEventListener("input", (event) => {
    if (event.target.id === "destination-input") {
      const value = event.target.value;
      store.update((state) => {
        state.search.destinationLabel = value;
      });

      if (value.trim()) {
        store.update((state) => {
          state.ui.modal = { type: "destination" };
        });
        render();
      }
      return;
    }

    const checkoutField = event.target.dataset.checkoutField;
    if (checkoutField) {
      store.update((state) => {
        if (checkoutField.startsWith("guest-")) {
          const index = Number(checkoutField.split("-")[1]);
          state.checkout.guestNames[index] = event.target.value;
        } else {
          state.checkout[checkoutField] = event.target.value;
        }
      });
    }
  });

  render();
})();

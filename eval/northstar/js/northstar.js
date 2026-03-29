window.tracker = new AgentTracker("northstaroutfitters.com", "hard");

document.addEventListener("DOMContentLoaded", () => {
  const state = {
    selectedSize: null,
    purchaseRailTracked: false,
    reviewsGeometryTracked: false,
    fitGuideGeometryTracked: false,
  };

  const purchaseRail = document.getElementById("purchase-rail");
  const addToBagBtn = document.getElementById("add-to-bag");
  const purchaseFeedback = document.getElementById("purchase-feedback");
  const sizeButtons = Array.from(document.querySelectorAll(".size-option"));
  const reviewsOverlay = document.getElementById("reviews-overlay");
  const reviewsFeedback = document.getElementById("reviews-feedback");
  const reviewsScroll = document.getElementById("reviews-scroll");
  const fitGuideOverlay = document.getElementById("fit-guide-overlay");
  const fitGuideScroll = document.getElementById("fit-guide-scroll");
  const targetReview = document.querySelector('[data-review-id="review-trail-commute"]')?.closest(".review-card");
  const careSection = document.getElementById("care-wash-section");
  const fitGuideFeedback = document.getElementById("fit-guide-feedback");
  const saveFitGuideBtn = document.getElementById("save-fit-guide");
  const fitGuideRefreshBtn = document.getElementById("fit-guide-refresh");

  function showFeedback(node, message) {
    if (!node) {
      return;
    }

    node.textContent = message;
    node.classList.add("visible");
  }

  function resetAddToBagState() {
    addToBagBtn.textContent = "Add to bag";
    addToBagBtn.classList.remove("is-complete");
    addToBagBtn.disabled = state.selectedSize === null;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function hideFitGuideRefreshBlocker() {
    if (!fitGuideRefreshBtn) {
      return;
    }

    fitGuideRefreshBtn.classList.remove("is-visible");
    fitGuideRefreshBtn.style.removeProperty("--fit-guide-refresh-left");
    fitGuideRefreshBtn.style.removeProperty("--fit-guide-refresh-top");
  }

  function placeFitGuideRefreshBlocker() {
    if (!fitGuideRefreshBtn || !saveFitGuideBtn || fitGuideOverlay.classList.contains("hidden")) {
      hideFitGuideRefreshBlocker();
      return;
    }

    const drawer = fitGuideOverlay.querySelector(".drawer");
    const saveRect = saveFitGuideBtn.getBoundingClientRect();
    const drawerRect = drawer?.getBoundingClientRect();
    const blockerWidth = fitGuideRefreshBtn.offsetWidth || 82;
    const blockerHeight = fitGuideRefreshBtn.offsetHeight || 82;
    let left = saveRect.left + saveRect.width / 2 - blockerWidth / 2;
    let top = saveRect.top + saveRect.height / 2 - blockerHeight / 2;

    if (drawerRect) {
      const minLeft = drawerRect.left + 16;
      const maxLeft = drawerRect.right - blockerWidth - 16;
      const minTop = drawerRect.top + 96;
      const maxTop = drawerRect.bottom - blockerHeight - 16;

      left = clamp(left, minLeft, Math.max(minLeft, maxLeft));
      top = clamp(top, minTop, Math.max(minTop, maxTop));
    }

    fitGuideRefreshBtn.style.setProperty("--fit-guide-refresh-left", `${Math.round(left)}px`);
    fitGuideRefreshBtn.style.setProperty("--fit-guide-refresh-top", `${Math.round(top)}px`);
    fitGuideRefreshBtn.classList.add("is-visible");
  }

  function queueFitGuideRefreshPlacement() {
    requestAnimationFrame(() => {
      requestAnimationFrame(placeFitGuideRefreshBlocker);
    });
  }

  function trackGeometryReadyOnce() {
    if (!purchaseRail || state.purchaseRailTracked) {
      return;
    }

    const rect = purchaseRail.getBoundingClientRect();
    const topSafe = 130;
    const bottomSafe = window.innerHeight - 180;
    const centeredEnough = rect.top >= topSafe && rect.bottom <= bottomSafe;

    if (!centeredEnough) {
      return;
    }

    state.purchaseRailTracked = true;
    tracker.track("purchase_rail_geometry_ready", {
      section: "purchase-rail",
      scrollY: Math.round(window.scrollY),
    });
  }

  function isCenteredInContainer(target, container) {
    if (!target || !container) {
      return false;
    }

    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const targetCenter = targetRect.top + targetRect.height / 2;
    const containerCenter = containerRect.top + containerRect.height / 2;
    const tolerance = Math.max(60, containerRect.height * 0.18);

    return (
      targetRect.top >= containerRect.top + 24 &&
      targetRect.bottom <= containerRect.bottom - 110 &&
      Math.abs(targetCenter - containerCenter) <= tolerance
    );
  }

  function overlapsBlocker(target, blocker) {
    if (!target || !blocker) {
      return false;
    }

    const targetRect = target.getBoundingClientRect();
    const blockerRect = blocker.getBoundingClientRect();

    const horizontalOverlap =
      Math.min(targetRect.right, blockerRect.right) -
      Math.max(targetRect.left, blockerRect.left);
    const verticalOverlap =
      Math.min(targetRect.bottom, blockerRect.bottom) -
      Math.max(targetRect.top, blockerRect.top);

    return horizontalOverlap > 8 && verticalOverlap > 8;
  }

  function trackReviewsGeometry() {
    if (state.reviewsGeometryTracked || reviewsOverlay.classList.contains("hidden")) {
      return;
    }

    if (!isCenteredInContainer(targetReview, reviewsScroll)) {
      return;
    }

    state.reviewsGeometryTracked = true;
    tracker.track("reviews_drawer_geometry_ready", {
      reviewId: "review-trail-commute",
      scrollTop: Math.round(reviewsScroll.scrollTop),
    });
  }

  function trackFitGuideGeometry() {
    if (state.fitGuideGeometryTracked || fitGuideOverlay.classList.contains("hidden")) {
      return;
    }

    if (!isCenteredInContainer(careSection, fitGuideScroll)) {
      return;
    }

    if (overlapsBlocker(saveFitGuideBtn, fitGuideRefreshBtn)) {
      return;
    }

    state.fitGuideGeometryTracked = true;
    tracker.track("fit_guide_geometry_ready", {
      section: "care-wash",
      scrollTop: Math.round(fitGuideScroll.scrollTop),
    });
  }

  window.addEventListener("scroll", trackGeometryReadyOnce, { passive: true });
  window.addEventListener("resize", () => {
    trackGeometryReadyOnce();

    if (!fitGuideOverlay.classList.contains("hidden")) {
      queueFitGuideRefreshPlacement();
    }
  });

  sizeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      sizeButtons.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.selectedSize = button.dataset.size || null;
      resetAddToBagState();
      showFeedback(
        purchaseFeedback,
        `Size ${state.selectedSize} selected. Ready to add the shell to bag.`,
      );
      tracker.track("product_size_select", {
        productId: "commuter-shell",
        size: state.selectedSize,
      });
    });
  });

  addToBagBtn.addEventListener("click", () => {
    if (!state.selectedSize) {
      return;
    }

    tracker.track("product_add_to_bag", {
      productId: "commuter-shell",
      size: state.selectedSize,
    });

    addToBagBtn.textContent = "Added to bag";
    addToBagBtn.classList.add("is-complete");
    addToBagBtn.disabled = true;
    purchaseRail.classList.add("is-complete");
    showFeedback(
      purchaseFeedback,
      `Commuter Shell in size ${state.selectedSize} added to your bag.`,
    );
  });

  document.getElementById("open-reviews")?.addEventListener("click", () => {
    state.reviewsGeometryTracked = false;
    reviewsOverlay.classList.remove("hidden");
    reviewsScroll.scrollTop = 0;
    showFeedback(
      reviewsFeedback,
      "Reviews drawer opened. Scroll inside this panel to reach the target review.",
    );
    tracker.track("reviews_drawer_open", {
      drawer: "reviews",
    });
  });

  document.getElementById("open-fit-guide")?.addEventListener("click", () => {
    state.fitGuideGeometryTracked = false;
    fitGuideOverlay.classList.remove("hidden");
    fitGuideScroll.scrollTop = 0;
    queueFitGuideRefreshPlacement();
    showFeedback(
      fitGuideFeedback,
      "Fit guide opened. Scroll this panel until Care & Wash is centered.",
    );
    tracker.track("fit_guide_open", {
      drawer: "fit-guide",
    });
  });

  document.querySelectorAll(".drawer-close").forEach((button) => {
    button.addEventListener("click", () => {
      const overlayId = button.dataset.close;
      if (!overlayId) {
        return;
      }

      document.getElementById(overlayId)?.classList.add("hidden");
      if (overlayId === "fit-guide-overlay") {
        hideFitGuideRefreshBlocker();
      }
      tracker.track("drawer_close", {
        drawer: overlayId,
      });
    });
  });

  reviewsOverlay.addEventListener("click", (event) => {
    if (event.target === reviewsOverlay) {
      reviewsOverlay.classList.add("hidden");
      tracker.track("drawer_close", {
        drawer: "reviews-overlay",
        method: "overlay",
      });
    }
  });

  fitGuideOverlay.addEventListener("click", (event) => {
    if (event.target === fitGuideOverlay) {
      fitGuideOverlay.classList.add("hidden");
      hideFitGuideRefreshBlocker();
      tracker.track("drawer_close", {
        drawer: "fit-guide-overlay",
        method: "overlay",
      });
    }
  });

  fitGuideRefreshBtn?.addEventListener("click", () => {
    window.location.reload();
  });

  reviewsScroll.addEventListener(
    "scroll",
    () => {
      tracker.track("reviews_panel_scroll", {
        scrollTop: Math.round(reviewsScroll.scrollTop),
      });
      trackReviewsGeometry();
    },
    { passive: true },
  );

  fitGuideScroll.addEventListener(
    "scroll",
    () => {
      tracker.track("fit_guide_scroll", {
        scrollTop: Math.round(fitGuideScroll.scrollTop),
      });
      trackFitGuideGeometry();
    },
    { passive: true },
  );

  document.querySelectorAll(".review-action").forEach((button) => {
    button.addEventListener("click", () => {
      const reviewId = button.dataset.reviewId;
      const card = button.closest(".review-card");
      const title = card?.querySelector("h3")?.textContent?.trim() || "";

      tracker.track("review_helpful", {
        reviewId,
        title,
        helpful: true,
      });

      button.textContent = "Helpful saved";
      button.classList.add("is-complete");
      button.disabled = true;
      card?.classList.add("is-complete");
      showFeedback(reviewsFeedback, `Saved "${title}" as Helpful.`);
    });
  });

  saveFitGuideBtn?.addEventListener("click", () => {
    tracker.track("fit_guide_save", {
      section: "care-wash",
    });

    saveFitGuideBtn.textContent = "Guide saved";
    saveFitGuideBtn.classList.add("is-complete");
    saveFitGuideBtn.disabled = true;
    careSection?.classList.add("is-complete");
    showFeedback(
      fitGuideFeedback,
      "Care & Wash saved. This section is now marked as complete.",
    );
  });

  trackGeometryReadyOnce();
});

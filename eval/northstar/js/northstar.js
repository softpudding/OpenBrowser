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
  const sizeButtons = Array.from(document.querySelectorAll(".size-option"));
  const reviewsOverlay = document.getElementById("reviews-overlay");
  const reviewsScroll = document.getElementById("reviews-scroll");
  const fitGuideOverlay = document.getElementById("fit-guide-overlay");
  const fitGuideScroll = document.getElementById("fit-guide-scroll");
  const targetReview = document.querySelector('[data-review-id="review-trail-commute"]')?.closest(".review-card");
  const careSection = document.getElementById("care-wash-section");

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

    state.fitGuideGeometryTracked = true;
    tracker.track("fit_guide_geometry_ready", {
      section: "care-wash",
      scrollTop: Math.round(fitGuideScroll.scrollTop),
    });
  }

  window.addEventListener("scroll", trackGeometryReadyOnce, { passive: true });
  window.addEventListener("resize", trackGeometryReadyOnce);

  sizeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      sizeButtons.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.selectedSize = button.dataset.size || null;
      addToBagBtn.disabled = state.selectedSize === null;
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
  });

  document.getElementById("open-reviews")?.addEventListener("click", () => {
    state.reviewsGeometryTracked = false;
    reviewsOverlay.classList.remove("hidden");
    reviewsScroll.scrollTop = 0;
    tracker.track("reviews_drawer_open", {
      drawer: "reviews",
    });
  });

  document.getElementById("open-fit-guide")?.addEventListener("click", () => {
    state.fitGuideGeometryTracked = false;
    fitGuideOverlay.classList.remove("hidden");
    fitGuideScroll.scrollTop = 0;
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
      tracker.track("drawer_close", {
        drawer: "fit-guide-overlay",
        method: "overlay",
      });
    }
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
    });
  });

  document.getElementById("save-fit-guide")?.addEventListener("click", () => {
    tracker.track("fit_guide_save", {
      section: "care-wash",
    });
  });

  trackGeometryReadyOnce();
});
